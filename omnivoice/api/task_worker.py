import os
import sys
import time
import uuid
import logging
import threading
from pathlib import Path
from typing import Optional, Dict, Any

import soundfile as sf
import numpy as np

from omnivoice import OmniVoiceGenerationConfig
from omnivoice.api.db import (
    get_next_pending_task,
    update_task_status,
    get_tasks_by_batch_id,
    save_merged_batch,
    get_merged_batch,
    update_master_task_progress,
)
from omnivoice.api.audio_ops import merge_audio_files

logger = logging.getLogger("omnivoice.worker")

OUTPUTS_DIR = Path("outputs")
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)


class OmniVoiceTaskWorker:
    def __init__(self, get_model_func, voice_store_instance):
        self.get_model = get_model_func
        self.voice_store = voice_store_instance
        self.wake_event = threading.Event()
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.current_task_id: Optional[str] = None
        self._lock = threading.Lock()

    def start(self):
        with self._lock:
            if self.running:
                return
            self.running = True
            self.thread = threading.Thread(target=self._worker_loop, daemon=True, name="OmniVoiceWorker")
            self.thread.start()
            logger.info("OmniVoice SQLite Task Worker thread started.")

    def stop(self):
        with self._lock:
            self.running = False
            self.wake_event.set()
        if self.thread:
            self.thread.join(timeout=3.0)

    def trigger(self):
        """Wakes up the worker immediately when a new task is inserted"""
        self.wake_event.set()

    def _worker_loop(self):
        while self.running:
            try:
                task = get_next_pending_task()
                if not task:
                    # Wait for next task or 1.5s timeout
                    self.wake_event.wait(timeout=1.5)
                    self.wake_event.clear()
                    continue

                task_id = task["id"]
                self.current_task_id = task_id
                self._process_task(task)
            except Exception as e:
                logger.error(f"Worker loop uncaught error: {e}", exc_info=True)
                time.sleep(1.0)
            finally:
                self.current_task_id = None

    def _process_task(self, task: Dict[str, Any]):
        task_id = task["id"]
        order_num = task.get("order_num", 0)
        task_type = task["task_type"]
        text = task["text"]
        params = task.get("params", {}) or {}

        logger.info(f"Starting execution for Order #{order_num} ({task_id}) [{task_type}]: '{text[:40]}...'")
        update_task_status(task_id, status="processing", progress=10, started=True)

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
            audio = model.generate(**kw)
            elapsed = time.time() - start_time

            output_prefix = "out_clone" if task_type == "clone" else "out_design"
            output_filename = f"{output_prefix}_{uuid.uuid4().hex[:10]}.wav"
            output_path = OUTPUTS_DIR / output_filename

            sf.write(str(output_path), audio[0], model.sampling_rate)
            duration_sec = len(audio[0]) / model.sampling_rate

            update_task_status(
                task_id,
                status="completed",
                progress=100,
                audio_url=f"/api/audio/output_{output_filename}",
                filename=output_filename,
                duration_sec=duration_sec,
                generation_time_sec=elapsed,
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
        except Exception as e:
            logger.error(f"Error checking/performing auto-merge for Batch {batch_id}: {e}", exc_info=True)
