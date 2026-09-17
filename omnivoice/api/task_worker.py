import os
import sys
import time
import uuid
import logging
import threading
from pathlib import Path
from typing import Optional, Dict, Any, List

import soundfile as sf
import numpy as np
import torch

from omnivoice import OmniVoiceGenerationConfig
from omnivoice.api.forced_alignment_srt import generate_srt_from_audio_and_text_sync, merge_srt_files
from omnivoice.api.db import (
    claim_next_pending_task,
    get_next_pending_task,
    update_task_status,
    get_tasks_by_batch_id,
    save_merged_batch,
    get_merged_batch,
    update_master_task_progress,
    delete_chunk_files,
    cleanup_expired_history,
    cleanup_merged_chunk_files,
)
from omnivoice.api.audio_ops import merge_audio_files

logger = logging.getLogger("omnivoice.worker")

OUTPUTS_DIR = Path("outputs")
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

_batch_merge_lock = threading.Lock()


class OmniVoiceTaskWorker:
    def __init__(self, get_model_func, voice_store_instance, max_workers: int = 1):
        self.get_model = get_model_func
        self.voice_store = voice_store_instance
        self.max_workers = max(1, min(5, int(max_workers)))
        self.running = False
        self._lock = threading.Lock()
        self.cv = threading.Condition(self._lock)
        self.threads: Dict[int, threading.Thread] = {}
        self.active_tasks: Dict[int, Optional[str]] = {}
        self.last_cleanup_time = 0.0

    @property
    def current_task_id(self) -> Optional[str]:
        """Returns the first active task id, or None (for backward compatibility)."""
        with self._lock:
            for tid in self.active_tasks.values():
                if tid:
                    return tid
            return None

    @property
    def active_workers_count(self) -> int:
        """Returns the number of currently active task executions."""
        with self._lock:
            return sum(1 for tid in self.active_tasks.values() if tid)

    def start(self):
        with self._lock:
            if self.running:
                return
            self.running = True
            for i in range(1, self.max_workers + 1):
                t = threading.Thread(
                    target=self._worker_loop,
                    args=(i,),
                    daemon=True,
                    name=f"OmniVoiceWorker-{i}",
                )
                self.threads[i] = t
                t.start()
            logger.info(f"OmniVoice Task Worker pool started with {self.max_workers} thread(s).")

    def stop(self):
        with self._lock:
            self.running = False
            self.cv.notify_all()
        threads = list(self.threads.values())
        for t in threads:
            if t.is_alive():
                t.join(timeout=2.0)
        self.threads.clear()
        self.active_tasks.clear()
        logger.info("OmniVoice Task Workers stopped.")

    def trigger(self):
        """Wakes up all waiting idle workers immediately when a new task is inserted"""
        with self.cv:
            self.cv.notify_all()

    def set_concurrency(self, new_count: int) -> int:
        """Dynamically adjusts the number of concurrent worker threads (1-5)."""
        new_count = max(1, min(5, int(new_count)))
        with self._lock:
            old_count = self.max_workers
            self.max_workers = new_count
            logger.info(f"Task worker concurrency updated: {old_count} -> {new_count}")

            if self.running:
                # If increasing, spawn workers for new slots
                for i in range(1, new_count + 1):
                    t = self.threads.get(i)
                    if t is None or not t.is_alive():
                        t = threading.Thread(
                            target=self._worker_loop,
                            args=(i,),
                            daemon=True,
                            name=f"OmniVoiceWorker-{i}",
                        )
                        self.threads[i] = t
                        t.start()

        # Wake up workers (new ones to start claiming tasks, or excess ones to retire)
        with self.cv:
            self.cv.notify_all()
        return self.max_workers

    def _worker_loop(self, worker_id: int):
        logger.info(f"Worker thread #{worker_id} started.")
        while self.running:
            # Check if concurrency was reduced and this worker slot should retire
            with self._lock:
                if worker_id > self.max_workers:
                    logger.info(f"Worker thread #{worker_id} gracefully retiring (concurrency={self.max_workers}).")
                    self.active_tasks.pop(worker_id, None)
                    self.threads.pop(worker_id, None)
                    break

            try:
                # Periodic 48h history and chunk cleanup (handled by worker 1 only)
                if worker_id == 1:
                    now_t = time.time()
                    if now_t - self.last_cleanup_time > 1800:
                        self.last_cleanup_time = now_t
                        try:
                            cleanup_expired_history(48.0)
                            cleanup_merged_chunk_files()
                        except Exception as clean_err:
                            logger.warning(f"Periodic history cleanup warning: {clean_err}")

                # Atomically claim the next pending task
                task = claim_next_pending_task()
                if not task:
                    with self.cv:
                        # Wait for next task trigger or 1.5s timeout
                        self.cv.wait(timeout=1.5)
                    continue

                task_id = task["id"]
                with self._lock:
                    self.active_tasks[worker_id] = task_id

                self._process_task(task, worker_id=worker_id)

            except Exception as e:
                logger.error(f"Worker #{worker_id} loop uncaught error: {e}", exc_info=True)
                time.sleep(1.0)
            finally:
                with self._lock:
                    self.active_tasks[worker_id] = None

    def _process_task(self, task: Dict[str, Any], worker_id: int = 1):
        task_id = task["id"]
        order_num = task.get("order_num", 0)
        task_type = task["task_type"]
        text = task["text"]
        params = task.get("params", {}) or {}

        logger.info(f"[Worker #{worker_id}] Executing Order #{order_num} ({task_id}) [{task_type}]: '{text[:40]}...'")
        update_task_status(task_id, status="processing", progress=10, started=True)

        parent_id = task.get("parent_id")
        if parent_id:
            update_master_task_progress(parent_id)

        try:
            retries = 0
            model = self.get_model()
            while model is None and retries < 30 and self.running:
                logger.info("OmniVoice model is still loading. Worker waiting 2s...")
                time.sleep(2.0)
                retries += 1
                model = self.get_model()

            if model is None:
                raise RuntimeError("OmniVoice model is not loaded yet or failed to load.")

            # Build generation config
            num_step = int(params.get("num_step", 16) or 16)
            guidance_scale = float(params.get("guidance_scale", 2.0) or 2.0)
            denoise = bool(params.get("denoise", True))
            preprocess_prompt = bool(params.get("preprocess_prompt", True))
            postprocess_output = bool(params.get("postprocess_output", True))

            gen_config = OmniVoiceGenerationConfig(
                num_step=num_step,
                guidance_scale=guidance_scale,
                denoise=denoise,
                preprocess_prompt=preprocess_prompt,
                postprocess_output=postprocess_output,
            )

            lang = task.get("language")
            if not lang or lang == "Auto":
                lang = None

            kw: Dict[str, Any] = {
                "text": text.strip(),
                "language": lang,
                "generation_config": gen_config,
            }

            speed = params.get("speed")
            if speed is not None and float(speed) != 1.0:
                kw["speed"] = float(speed)

            duration = params.get("duration")
            if duration is not None and float(duration) > 0:
                kw["duration"] = float(duration)

            instruct = task.get("instruct") or params.get("instruct")
            if instruct and instruct.strip():
                kw["instruct"] = instruct.strip()

            if task_type == "clone":
                voice_id = task.get("voice_id")
                if not voice_id:
                    raise ValueError("voice_id is required for voice clone tasks.")

                prompt, audio_path, store_ref_text = self.voice_store.get_prompt_or_audio(
                    voice_id, model=model
                )
                if prompt is not None:
                    kw["voice_clone_prompt"] = prompt
                elif audio_path is not None:
                    kw["ref_audio"] = audio_path
                    kw["ref_text"] = params.get("ref_text") or store_ref_text or None
                else:
                    raise FileNotFoundError(f"Voice {voice_id} prompt or audio file not found.")

            elif task_type == "design":
                if not kw.get("instruct"):
                    raise ValueError("Instruct description is required for Voice Design tasks.")
            else:
                raise ValueError(f"Unsupported task type: {task_type}")

            # Generate audio on GPU
            start_time = time.time()

            def on_chunk_generated(curr_c: int, tot_c: int):
                pct = min(95, 10 + int((curr_c / tot_c) * 80))
                update_task_status(task_id, progress=pct)
                if parent_id:
                    update_master_task_progress(parent_id)
                logger.info(f"Order #{order_num} ({task_id}): Chunk {curr_c}/{tot_c} generated ({pct}%)")

            kw["chunk_callback"] = on_chunk_generated
            audio = model.generate(**kw)
            elapsed = time.time() - start_time

            output_prefix = "out_clone" if task_type == "clone" else "out_design"
            output_filename = f"{output_prefix}_{uuid.uuid4().hex[:10]}.wav"
            output_path = OUTPUTS_DIR / output_filename

            sf.write(str(output_path), audio[0], model.sampling_rate)
            duration_sec = len(audio[0]) / model.sampling_rate

            # Generate synchronized SRT subtitle via Forced Alignment
            srt_filename = output_filename.rsplit(".", 1)[0] + ".srt"
            srt_path = OUTPUTS_DIR / srt_filename
            srt_url = None
            try:
                audio_tensor = torch.from_numpy(audio[0]).float()
                generate_srt_from_audio_and_text_sync(
                    audio_tensor=audio_tensor,
                    sample_rate=model.sampling_rate,
                    text=text,
                    language=lang,
                    output_srt_path=str(srt_path),
                )
                if srt_path.exists():
                    srt_url = f"/api/audio/output_{srt_filename}"
            except Exception as srt_err:
                logger.warning(f"Failed to generate SRT for Order #{order_num} ({task_id}): {srt_err}")

            update_task_status(
                task_id,
                status="completed",
                progress=100,
                audio_url=f"/api/audio/output_{output_filename}",
                filename=output_filename,
                duration_sec=duration_sec,
                generation_time_sec=elapsed,
                srt_url=srt_url,
                srt_filename=srt_filename if srt_url else None,
                completed=True,
            )
            logger.info(
                f"Successfully completed Order #{order_num} ({task_id}) in {elapsed:.2f}s, audio duration: {duration_sec:.2f}s"
            )

            # Trigger master task progress update if this is a sub-chunk
            parent_id = task.get("parent_id")
            if parent_id:
                master = update_master_task_progress(parent_id)
                if master:
                    logger.info(
                        f"[Master Task Progress] Order #{master.get('order_num')} ({parent_id}): "
                        f"{master.get('completed_chunks')}/{master.get('total_chunks')} đoạn "
                        f"({master.get('progress')}%) - Trạng thái: {master.get('status')}"
                    )

            # Trigger auto-merge check if part of a batch
            batch_id = task.get("batch_id")
            if batch_id:
                self._check_batch_completion(batch_id, params)

        except Exception as e:
            logger.error(f"Failed Order #{order_num} ({task_id}): {e}", exc_info=True)
            update_task_status(
                task_id,
                status="failed",
                progress=0,
                error_message=str(e),
                completed=True,
            )
            # Notify master task if failed
            parent_id = task.get("parent_id")
            if parent_id:
                update_master_task_progress(parent_id)

    def _check_batch_completion(self, batch_id: str, params: Dict[str, Any]):
        """Checks if all tasks in the batch are finished, and auto-merges them if requested"""
        with _batch_merge_lock:
            try:
                auto_merge = params.get("auto_merge", True)
                if not auto_merge:
                    return

                existing = get_merged_batch(batch_id)
                if existing:
                    return

                tasks = get_tasks_by_batch_id(batch_id)
                if not tasks:
                    return

                all_done = all(t["status"] in ("completed", "failed", "cancelled") for t in tasks)
                if not all_done:
                    return

                completed_tasks = [t for t in tasks if t["status"] == "completed" and t.get("filename")]
                if not completed_tasks:
                    return

                gap_sec = float(params.get("gap_sec", 0.8) or 0.8)
                file_paths = [OUTPUTS_DIR / t["filename"] for t in completed_tasks]
                output_filename = f"merged_{batch_id}.wav"
                output_path = OUTPUTS_DIR / output_filename

                logger.info(
                    f"[Auto-Merge] Batch {batch_id} finished! Merging {len(completed_tasks)} tasks with gap {gap_sec}s..."
                )
                duration_sec, _ = merge_audio_files(file_paths, output_path, gap_sec=gap_sec)

                audio_url = f"/api/audio/output_{output_filename}"
                title = f"Gộp Batch ({len(completed_tasks)} đoạn, {duration_sec:.1f}s, gap {gap_sec}s)"

                # Merge SRT for the entire batch
                batch_srt_paths = []
                batch_durs = []
                for t in completed_tasks:
                    s_fn = t.get("srt_filename") or (t["filename"].rsplit(".", 1)[0] + ".srt")
                    s_fp = OUTPUTS_DIR / s_fn
                    if s_fp.exists():
                        batch_srt_paths.append(str(s_fp))
                        batch_durs.append(float(t.get("duration_sec") or 0.0))

                if batch_srt_paths and len(batch_srt_paths) == len(batch_durs):
                    try:
                        batch_srt_filename = f"merged_{batch_id}.srt"
                        batch_srt_path = OUTPUTS_DIR / batch_srt_filename
                        merge_srt_files(batch_srt_paths, batch_durs, str(batch_srt_path), gap_sec=gap_sec)
                    except Exception as srt_e:
                        logger.warning(f"Failed to merge batch SRT for {batch_id}: {srt_e}")

                save_merged_batch(
                    batch_id=batch_id,
                    title=title,
                    audio_url=audio_url,
                    filename=output_filename,
                    duration_sec=duration_sec,
                    chunks_count=len(completed_tasks),
                    gap_sec=gap_sec,
                )
                logger.info(
                    f"[Auto-Merge] Batch {batch_id} successfully merged -> {output_filename} (duration: {duration_sec:.2f}s)"
                )

                # Delete chunk audio and SRT files once batch merge is complete
                keep_list = [output_filename]
                if batch_srt_paths and len(batch_srt_paths) == len(batch_durs):
                    keep_list.append(batch_srt_filename)
                del_count = delete_chunk_files(completed_tasks, keep_files=keep_list)
                logger.info(
                    f"[Auto-Merge] Cleaned up {del_count} chunk files for Batch {batch_id}."
                )
            except Exception as e:
                logger.error(f"Error checking/performing auto-merge for Batch {batch_id}: {e}", exc_info=True)
