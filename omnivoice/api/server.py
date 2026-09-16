import os
import sys
import uuid
import time
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import soundfile as sf
import numpy as np
import torch

from omnivoice import OmniVoice, OmniVoiceGenerationConfig
from omnivoice.utils.common import get_best_device
from omnivoice.utils.lang_map import LANG_NAMES, lang_display_name
from omnivoice.cli.demo import _CATEGORIES, _ATTR_INFO
from omnivoice.api.voice_store import VoiceStore
from omnivoice.api.db import (
    init_db,
    create_task,
    create_batch_tasks,
    create_long_form_master_task,
    get_sub_tasks,
    get_task,
    list_tasks,
    update_task_status,
    retry_task,
    cancel_task,
    delete_task,
    clear_completed_tasks,
    get_task_stats,
    get_tasks_by_ids,
    get_tasks_by_batch_id,
    save_merged_batch,
    get_merged_batch,
    list_merged_batches,
    delete_chunk_files,
    cleanup_merged_chunk_files,
    cleanup_expired_history,
)
from omnivoice.api.task_worker import OmniVoiceTaskWorker
from omnivoice.api.audio_ops import split_text_by_sentence_chunks, merge_audio_files
from omnivoice.api.forced_alignment_srt import (
    generate_srt_from_audio_and_text_sync,
    export_voice_with_srt,
    get_ffmpeg_path,
    merge_srt_files,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("omnivoice.api")

app = FastAPI(title="OmniVoice Studio API", version="1.1.0")

# CORS config
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Storage directories
VOICES_DIR = Path("voices")
OUTPUTS_DIR = Path("outputs")
VOICES_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

voice_store = VoiceStore(VOICES_DIR)

# Global model holder
model_state = {
    "model": None,
    "device": None,
    "is_loading": False,
    "checkpoint": "k2-fsa/OmniVoice",
}


def get_model():
    if model_state["model"] is None:
        if not model_state["is_loading"]:
            load_model()
        else:
            for _ in range(60):
                if not model_state["is_loading"] or model_state["model"] is not None:
                    break
                time.sleep(0.5)
    return model_state["model"]


def load_model():
    model_state["is_loading"] = True
    try:
        device = get_best_device()
        checkpoint = model_state["checkpoint"]
        logger.info(f"Loading OmniVoice from {checkpoint} on {device}...")
        
        dtype = torch.float16 if str(device).startswith("cuda") or str(device) == "xpu" else torch.float32
        model = OmniVoice.from_pretrained(
            checkpoint,
            device_map=device,
            dtype=dtype,
            load_asr=True,
        )
        model_state["model"] = model
        model_state["device"] = str(device)
        logger.info(f"OmniVoice successfully loaded on {device}!")
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        raise e
    finally:
        model_state["is_loading"] = False


# Background worker instance
task_worker = OmniVoiceTaskWorker(get_model, voice_store)


@app.on_event("startup")
def startup_event():
    # Initialize SQLite database
    init_db()
    logger.info("SQLite database initialized.")

    # Start background task processor
    task_worker.start()

    # Load model asynchronously in background thread so server & UI appear immediately!
    import threading
    def _async_load():
        try:
            load_model()
            logger.info("OmniVoice model loaded successfully in background.")
        except Exception as e:
            logger.warning(f"Could not load model on startup: {e}. Will retry on demand.")
    threading.Thread(target=_async_load, daemon=True, name="ModelLoaderThread").start()


@app.on_event("shutdown")
def shutdown_event():
    task_worker.stop()
    logger.info("Task worker stopped.")


# ---------------------------------------------------------------------------
# Health & Meta Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health_check():
    gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    return {
        "status": "online",
        "model_loaded": model_state["model"] is not None,
        "is_loading": model_state["is_loading"],
        "device": model_state["device"] or "pending",
        "gpu_name": gpu_name,
        "sampling_rate": model_state["model"].sampling_rate if model_state["model"] else 24000,
        "current_task_id": task_worker.current_task_id,
    }


@app.get("/api/languages")
def get_languages():
    languages = [{"code": "Auto", "name": "Auto Detect"}]
    for code in sorted(LANG_NAMES):
        languages.append({
            "code": code,
            "name": lang_display_name(code)
        })
    return languages


@app.get("/api/design-options")
def get_design_options():
    return {
        "categories": _CATEGORIES,
        "info": _ATTR_INFO,
    }


# ---------------------------------------------------------------------------
# Voice Library Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/voices")
def list_voices():
    return voice_store.list_voices()


@app.post("/api/voices")
async def create_voice(
    name: str = Form(...),
    gender: str = Form("Unspecified"),
    language: str = Form("Auto"),
    description: str = Form(""),
    ref_text: Optional[str] = Form(None),
    file: UploadFile = File(...),
):
    model = get_model()
    audio_bytes = await file.read()
    
    new_voice = voice_store.add_voice(
        name=name.strip(),
        audio_data=audio_bytes,
        filename=file.filename or "voice.mp3",
        gender=gender,
        language=language,
        description=description.strip(),
        ref_text=ref_text.strip() if ref_text else None,
        model=model,
    )
    return new_voice


@app.delete("/api/voices/{voice_id}")
def delete_voice_endpoint(voice_id: str):
    success = voice_store.delete_voice(voice_id)
    if not success:
        raise HTTPException(status_code=404, detail="Voice not found")
    return {"status": "deleted", "id": voice_id}


# ---------------------------------------------------------------------------
# SQLite Task & Queue Endpoints (For Bulk and Single Voiceover Generation)
# ---------------------------------------------------------------------------

class CreateTaskRequest(BaseModel):
    task_type: str = "clone"  # 'clone' or 'design'
    text: Optional[str] = None
    transcript: Optional[str] = None  # Alias for text
    voice_id: Optional[str] = None
    voice_name: Optional[str] = None
    language: Optional[str] = "Auto"
    instruct: Optional[str] = None
    speed: Optional[float] = 1.0
    duration: Optional[float] = None
    num_step: Optional[int] = 32
    guidance_scale: Optional[float] = 2.0
    denoise: Optional[bool] = True
    preprocess_prompt: Optional[bool] = True
    postprocess_output: Optional[bool] = True
    ref_text: Optional[str] = None
    gap_sec: Optional[float] = 0.8
    chunk_size: Optional[int] = 1000


class BatchItem(BaseModel):
    text: str
    task_type: Optional[str] = None
    instruct: Optional[str] = None
    language: Optional[str] = None
    voice_id: Optional[str] = None
    voice_name: Optional[str] = None
    params: Optional[Dict[str, Any]] = None


class CreateBatchTasksRequest(BaseModel):
    items: List[BatchItem]
    common_type: str = "clone"
    common_voice_id: Optional[str] = None
    common_voice_name: Optional[str] = None
    common_language: str = "Auto"
    common_instruct: Optional[str] = None
    common_params: Optional[Dict[str, Any]] = None
    batch_id: Optional[str] = None
    auto_merge: bool = False
    gap_sec: float = 0.8


@app.post("/api/tasks")
def create_single_task(req: CreateTaskRequest):
    input_text = (req.transcript or req.text or "").strip()
    if not input_text:
        raise HTTPException(status_code=400, detail="Transcript / text cannot be empty.")

    if req.task_type == "clone" and not req.voice_id:
        raise HTTPException(status_code=400, detail="voice_id is required for clone tasks.")
    if req.task_type == "design" and not req.instruct:
        raise HTTPException(status_code=400, detail="instruct is required for design tasks.")

    # Find voice name if not passed
    voice_name = req.voice_name
    if req.voice_id and not voice_name:
        v = voice_store.get_voice(req.voice_id)
        if v:
            voice_name = v.get("name")

    params = {
        "speed": req.speed,
        "duration": req.duration,
        "num_step": req.num_step,
        "guidance_scale": req.guidance_scale,
        "denoise": req.denoise,
        "preprocess_prompt": req.preprocess_prompt,
        "postprocess_output": req.postprocess_output,
        "ref_text": req.ref_text,
        "gap_sec": req.gap_sec or 0.8,
    }

    # Automatically chunk long transcripts into a master task with auto-merged audio and SRT!
    if len(input_text) > 800:
        try:
            master_task = create_long_form_master_task(
                text=input_text,
                voice_id=req.voice_id or "",
                voice_name=voice_name,
                language=req.language or "Auto",
                instruct=req.instruct,
                params=params,
                chunk_size=req.chunk_size or 1000,
                gap_sec=req.gap_sec or 0.8,
                task_type=req.task_type,
            )
            task_worker.trigger()
            return master_task
        except Exception as e:
            logger.error(f"Failed to create chunked master task: {e}")
            raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    try:
        task = create_task(
            task_type=req.task_type,
            text=input_text,
            voice_id=req.voice_id,
            voice_name=voice_name,
            language=req.language or "Auto",
            instruct=req.instruct,
            params=params,
        )
        task_worker.trigger()
        return task
    except Exception as e:
        logger.error(f"Failed to create task: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.post("/api/tasks/clone")
def create_clone_task(req: CreateTaskRequest):
    """Convenience endpoint: create a voice clone task with transcript (auto-chunks if long, outputs MP3/WAV + SRT)."""
    req.task_type = "clone"
    return create_single_task(req)


@app.post("/api/tasks/design")
def create_design_task(req: CreateTaskRequest):
    """Convenience endpoint: create a voice design task from text and instruct prompt (auto-chunks if long, outputs MP3/WAV + SRT)."""
    req.task_type = "design"
    return create_single_task(req)


@app.post("/api/tasks/batch")
def create_batch(req: CreateBatchTasksRequest):
    if not req.items or len(req.items) == 0:
        raise HTTPException(status_code=400, detail="Items list cannot be empty.")

    # Populate voice name if not provided
    common_voice_name = req.common_voice_name
    if req.common_voice_id and not common_voice_name:
        v = voice_store.get_voice(req.common_voice_id)
        if v:
            common_voice_name = v.get("name")

    try:
        assigned_batch_id = req.batch_id or f"batch_{uuid.uuid4().hex[:10]}"
        common_params = dict(req.common_params or {})
        common_params["auto_merge"] = req.auto_merge
        common_params["gap_sec"] = req.gap_sec
        common_params["batch_id"] = assigned_batch_id

        items_data = [item.dict() for item in req.items]
        created = create_batch_tasks(
            items=items_data,
            common_type=req.common_type,
            common_voice_id=req.common_voice_id,
            common_voice_name=common_voice_name,
            common_language=req.common_language,
            common_instruct=req.common_instruct,
            common_params=common_params,
            batch_id=assigned_batch_id,
        )
        task_worker.trigger()
        return {
            "status": "success",
            "batch_id": assigned_batch_id,
            "count": len(created),
            "tasks": created,
        }
    except Exception as e:
        logger.error(f"Failed to create batch tasks: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


class LongFormTaskRequest(BaseModel):
    text: str
    voice_id: str
    voice_name: Optional[str] = None
    language: str = "Auto"
    instruct: Optional[str] = None
    speed: float = 1.0
    chunk_size: int = 1000
    gap_sec: float = 0.8
    num_step: Optional[int] = 16
    guidance_scale: Optional[float] = 2.0
    denoise: Optional[bool] = True
    params: Optional[Dict[str, Any]] = None


@app.post("/api/tasks/long-form")
def create_long_form_task_endpoint(req: LongFormTaskRequest):
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")
    if not req.voice_id:
        raise HTTPException(status_code=400, detail="voice_id is required.")

    voice_name = req.voice_name
    if not voice_name:
        v = voice_store.get_voice(req.voice_id)
        if v:
            voice_name = v.get("name")

    task_params = dict(req.params or {})
    task_params["speed"] = req.speed
    task_params["num_step"] = req.num_step if req.num_step is not None else task_params.get("num_step", 16)
    if req.guidance_scale is not None:
        task_params["guidance_scale"] = req.guidance_scale
    if req.denoise is not None:
        task_params["denoise"] = req.denoise

    try:
        master_task = create_long_form_master_task(
            text=req.text,
            voice_id=req.voice_id,
            voice_name=voice_name,
            language=req.language,
            instruct=req.instruct,
            params=task_params,
            chunk_size=req.chunk_size,
            gap_sec=req.gap_sec,
        )
        task_worker.trigger()
        return {
            "status": "success",
            "task_id": master_task["id"],
            "order_num": master_task["order_num"],
            "total_chunks": master_task["total_chunks"],
            "progress": master_task["progress"],
            "status_url": f"/api/tasks/{master_task['id']}",
            "message": f"Task đã được tiếp nhận và chia thành {master_task['total_chunks']} đoạn (~{req.chunk_size} ký tự/đoạn, {task_params['num_step']} steps).",
        }
    except Exception as e:
        logger.error(f"Failed to create long form task: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.post("/api/tasks/long-form/upload")
async def create_long_form_upload_endpoint(
    file: UploadFile = File(...),
    voice_id: str = Form(...),
    instruct: Optional[str] = Form(None),
    language: str = Form("Auto"),
    speed: float = Form(1.0),
    chunk_size: int = Form(1000),
    gap_sec: float = Form(0.8),
    num_step: int = Form(16),
):
    try:
        content_bytes = await file.read()
        text = content_bytes.decode("utf-8")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid text file. Must be UTF-8 encoded text.")

    if not text.strip():
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    voice_name = None
    v = voice_store.get_voice(voice_id)
    if v:
        voice_name = v.get("name")

    try:
        master_task = create_long_form_master_task(
            text=text,
            voice_id=voice_id,
            voice_name=voice_name,
            language=language,
            instruct=instruct,
            params={"speed": speed, "num_step": num_step},
            chunk_size=chunk_size,
            gap_sec=gap_sec,
        )
        task_worker.trigger()
        return {
            "status": "success",
            "task_id": master_task["id"],
            "order_num": master_task["order_num"],
            "total_chunks": master_task["total_chunks"],
            "progress": master_task["progress"],
            "filename": file.filename,
            "status_url": f"/api/tasks/{master_task['id']}",
            "message": f"File '{file.filename}' đã được chia thành {master_task['total_chunks']} đoạn (~{chunk_size} ký tự/đoạn).",
        }
    except Exception as e:
        logger.error(f"Failed to create long form task from upload: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.get("/api/tasks")
def list_tasks_endpoint(
    status: Optional[str] = Query(None, description="all, pending, processing, completed, failed, cancelled"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    master_only: bool = Query(True, description="Only show master tasks in queue history"),
):
    tasks = list_tasks(status=status, limit=limit, offset=offset, master_only=master_only)
    return tasks


@app.get("/api/tasks/stats")
def get_stats_endpoint(master_only: bool = Query(True)):
    return get_task_stats(master_only=master_only)


@app.get("/api/tasks/{task_id}/chunks")
def get_task_chunks_endpoint(task_id: str):
    chunks = get_sub_tasks(task_id)
    return chunks


@app.get("/api/tasks/{task_id}")
def get_task_endpoint(task_id: str):
    t = get_task(task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    return t


@app.post("/api/tasks/{task_id}/retry")
def retry_task_endpoint(task_id: str):
    t = retry_task(task_id)
    if not t:
        raise HTTPException(status_code=400, detail="Cannot retry task. It must be in failed or cancelled status.")
    task_worker.trigger()
    return t


@app.post("/api/tasks/{task_id}/cancel")
def cancel_task_endpoint(task_id: str):
    success = cancel_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot cancel task. Only pending tasks can be cancelled.")
    return {"status": "cancelled", "id": task_id}


@app.delete("/api/tasks/{task_id}")
def delete_task_endpoint(task_id: str):
    t = get_task(task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")

    # Optionally delete generated audio file if exists
    if t.get("filename"):
        audio_file = OUTPUTS_DIR / t["filename"]
        if audio_file.exists():
            try:
                audio_file.unlink(missing_ok=True)
            except Exception:
                pass

    delete_task(task_id)
    return {"status": "deleted", "id": task_id}


@app.delete("/api/tasks")
def clear_tasks_endpoint():
    count = clear_completed_tasks()
    return {"status": "cleared", "deleted_count": count}


# ---------------------------------------------------------------------------
# Smart Text Splitting & Audio Merging Endpoints
# ---------------------------------------------------------------------------

class SplitTextRequest(BaseModel):
    text: str
    target_chars: int = 1000


class MergeTasksRequest(BaseModel):
    task_ids: List[str]
    gap_sec: float = 0.8
    output_filename: Optional[str] = None


@app.post("/api/tools/split-text")
def split_text_endpoint(req: SplitTextRequest):
    if not req.text or not req.text.strip():
        return {"chunks": [], "total_chunks": 0, "total_chars": 0}

    chunks = split_text_by_sentence_chunks(req.text, target_chars=max(100, req.target_chars))
    return {
        "chunks": chunks,
        "total_chunks": len(chunks),
        "total_chars": sum(len(c) for c in chunks),
    }


@app.post("/api/tasks/merge")
def merge_tasks_endpoint(req: MergeTasksRequest):
    if not req.task_ids:
        raise HTTPException(status_code=400, detail="No task IDs provided.")

    tasks = get_tasks_by_ids(req.task_ids)
    if not tasks:
        raise HTTPException(status_code=404, detail="No matching tasks found.")

    completed_tasks = [t for t in tasks if t.get("status") == "completed" and t.get("filename")]
    if not completed_tasks:
        raise HTTPException(status_code=400, detail="None of the specified tasks have completed audio.")

    file_paths = []
    for t in completed_tasks:
        fp = OUTPUTS_DIR / t["filename"]
        if fp.exists():
            file_paths.append(fp)

    if not file_paths:
        raise HTTPException(status_code=404, detail="Audio files not found on disk.")

    out_name = req.output_filename or f"merged_{uuid.uuid4().hex[:10]}.wav"
    if not out_name.endswith(".wav"):
        out_name += ".wav"
    out_path = OUTPUTS_DIR / out_name

    try:
        duration_sec, sr = merge_audio_files(file_paths, out_path, gap_sec=req.gap_sec)
        audio_url = f"/api/audio/output_{out_name}"

        # Merge SRT files if available
        srt_paths = []
        chunk_durs = []
        for t in completed_tasks:
            s_fn = t.get("srt_filename") or (t["filename"].rsplit(".", 1)[0] + ".srt" if t.get("filename") else None)
            if s_fn:
                s_fp = OUTPUTS_DIR / s_fn
                if s_fp.exists():
                    srt_paths.append(str(s_fp))
                    chunk_durs.append(float(t.get("duration_sec") or 0.0))

        out_srt_name = out_name.rsplit(".", 1)[0] + ".srt"
        out_srt_path = OUTPUTS_DIR / out_srt_name
        merged_srt_ok = False
        if srt_paths and len(srt_paths) == len(chunk_durs):
            try:
                res_srt = merge_srt_files(srt_paths, chunk_durs, str(out_srt_path), gap_sec=req.gap_sec)
                if res_srt:
                    merged_srt_ok = True
            except Exception as srt_e:
                logger.warning(f"Failed to merge SRTs in merge endpoint: {srt_e}")

        # Save record in SQLite
        batch_id = completed_tasks[0].get("batch_id") or f"custom_{uuid.uuid4().hex[:8]}"
        save_merged_batch(
            batch_id=batch_id,
            title=f"Gộp {len(file_paths)} file ({duration_sec:.1f}s, gap {req.gap_sec}s)",
            audio_url=audio_url,
            filename=out_name,
            duration_sec=duration_sec,
            chunks_count=len(file_paths),
            gap_sec=req.gap_sec,
        )

        # Delete chunk audio and chunk SRT files
        keep_list = [out_name]
        if merged_srt_ok:
            keep_list.append(out_srt_name)
        del_count = delete_chunk_files(completed_tasks, keep_files=keep_list)
        logger.info(f"Cleaned up {del_count} chunk files after manual merge.")

        return {
            "status": "success",
            "audio_url": audio_url,
            "filename": out_name,
            "duration_sec": round(duration_sec, 2),
            "chunks_count": len(file_paths),
            "gap_sec": req.gap_sec,
            "sampling_rate": sr,
            "srt_url": f"/api/audio/output_{out_srt_name}" if merged_srt_ok else None,
            "deleted_chunks": del_count,
        }
    except Exception as e:
        logger.error(f"Failed to merge audio files: {e}")
        raise HTTPException(status_code=500, detail=f"Merge error: {str(e)}")


@app.post("/api/tasks/cleanup")
def cleanup_history_endpoint(hours: float = Query(48.0, ge=1.0, le=720.0)):
    """Triggers cleanup of history older than 48 hours and any leftover chunk files."""
    del_chunks = cleanup_merged_chunk_files()
    hist_stats = cleanup_expired_history(retention_hours=hours)
    hist_stats["deleted_chunk_files"] = del_chunks
    return {"status": "success", **hist_stats}


@app.get("/api/batches/merged")
def list_merged_endpoint(limit: int = Query(50, ge=1, le=200)):
    return list_merged_batches(limit=limit)


@app.get("/api/batches/{batch_id}/merged")
def get_batch_merged_endpoint(batch_id: str):
    res = get_merged_batch(batch_id)
    if not res:
        raise HTTPException(status_code=404, detail="Merged batch not found")
    return res


# ---------------------------------------------------------------------------
# Synchronous Endpoints (Updated to preserve history in SQLite)
# ---------------------------------------------------------------------------

class CloneRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None
    language: Optional[str] = "Auto"
    instruct: Optional[str] = None
    ref_text: Optional[str] = None
    speed: float = 1.0
    duration: Optional[float] = None
    num_step: int = 32
    guidance_scale: float = 2.0
    denoise: bool = True
    preprocess_prompt: bool = True
    postprocess_output: bool = True


class DesignRequest(BaseModel):
    text: str
    instruct: str
    language: Optional[str] = "Auto"
    speed: float = 1.0
    duration: Optional[float] = None
    num_step: int = 32
    guidance_scale: float = 2.0
    denoise: bool = True
    preprocess_prompt: bool = True
    postprocess_output: bool = True


@app.post("/api/generate/clone")
def generate_clone(req: CloneRequest):
    model = get_model()
    if model is None:
        raise HTTPException(status_code=503, detail="Model is still loading, please wait.")

    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    voice_name = None
    if req.voice_id:
        v = voice_store.get_voice(req.voice_id)
        if v:
            voice_name = v.get("name")

    # Record task in SQLite as pending
    task = create_task(
        task_type="clone",
        text=req.text.strip(),
        voice_id=req.voice_id,
        voice_name=voice_name,
        language=req.language or "Auto",
        instruct=req.instruct,
        params={
            "speed": req.speed,
            "duration": req.duration,
            "num_step": req.num_step,
            "guidance_scale": req.guidance_scale,
            "denoise": req.denoise,
            "preprocess_prompt": req.preprocess_prompt,
            "postprocess_output": req.postprocess_output,
            "ref_text": req.ref_text,
        },
        status="processing",
    )
    task_id = task["id"]
    update_task_status(task_id, status="processing", started=True)

    gen_config = OmniVoiceGenerationConfig(
        num_step=int(req.num_step or 32),
        guidance_scale=float(req.guidance_scale or 2.0),
        denoise=bool(req.denoise),
        preprocess_prompt=bool(req.preprocess_prompt),
        postprocess_output=bool(req.postprocess_output),
    )

    lang = req.language if (req.language and req.language != "Auto") else None

    kw: Dict[str, Any] = {
        "text": req.text.strip(),
        "language": lang,
        "generation_config": gen_config,
    }

    if req.speed is not None and float(req.speed) != 1.0:
        kw["speed"] = float(req.speed)
    if req.duration is not None and float(req.duration) > 0:
        kw["duration"] = float(req.duration)
    if req.instruct and req.instruct.strip():
        kw["instruct"] = req.instruct.strip()

    if req.voice_id:
        prompt, audio_path, store_ref_text = voice_store.get_prompt_or_audio(req.voice_id, model=model)
        if prompt is not None:
            kw["voice_clone_prompt"] = prompt
        elif audio_path is not None:
            kw["ref_audio"] = audio_path
            kw["ref_text"] = req.ref_text or store_ref_text or None
        else:
            update_task_status(task_id, status="failed", error_message="Voice file not found", completed=True)
            raise HTTPException(status_code=404, detail="Voice file not found")
    else:
        update_task_status(task_id, status="failed", error_message="voice_id must be provided", completed=True)
        raise HTTPException(status_code=400, detail="voice_id must be provided.")

    start_time = time.time()
    try:
        audio = model.generate(**kw)
    except Exception as e:
        logger.error(f"Generation error: {e}")
        update_task_status(task_id, status="failed", error_message=str(e), completed=True)
        raise HTTPException(status_code=500, detail=str(e))
    
    elapsed = time.time() - start_time
    output_filename = f"out_{uuid.uuid4().hex[:10]}.wav"
    output_path = OUTPUTS_DIR / output_filename

    sf.write(str(output_path), audio[0], model.sampling_rate)
    duration_sec = len(audio[0]) / model.sampling_rate

    # Generate SRT via Forced Alignment
    srt_filename = output_filename.rsplit(".", 1)[0] + ".srt"
    srt_path = OUTPUTS_DIR / srt_filename
    srt_url = None
    try:
        audio_tensor = torch.from_numpy(audio[0]).float()
        generate_srt_from_audio_and_text_sync(
            audio_tensor=audio_tensor,
            sample_rate=model.sampling_rate,
            text=req.text,
            language=lang,
            output_srt_path=str(srt_path),
        )
        if srt_path.exists():
            srt_url = f"/api/audio/output_{srt_filename}"
    except Exception as srt_e:
        logger.warning(f"Failed to generate SRT for clone task {task_id}: {srt_e}")

    # Update SQLite task record as completed
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

    return {
        "status": "success",
        "task_id": task_id,
        "order_num": task.get("order_num"),
        "audio_url": f"/api/audio/output_{output_filename}",
        "filename": output_filename,
        "srt_url": srt_url,
        "duration_sec": round(duration_sec, 2),
        "generation_time_sec": round(elapsed, 2),
        "text": req.text,
        "sampling_rate": model.sampling_rate,
    }


@app.post("/api/generate/design")
def generate_design(req: DesignRequest):
    model = get_model()
    if model is None:
        raise HTTPException(status_code=503, detail="Model is still loading, please wait.")

    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    if not req.instruct or not req.instruct.strip():
        raise HTTPException(status_code=400, detail="Instruct cannot be empty for Voice Design.")

    # Record task in SQLite
    task = create_task(
        task_type="design",
        text=req.text.strip(),
        language=req.language or "Auto",
        instruct=req.instruct.strip(),
        params={
            "speed": req.speed,
            "duration": req.duration,
            "num_step": req.num_step,
            "guidance_scale": req.guidance_scale,
            "denoise": req.denoise,
            "preprocess_prompt": req.preprocess_prompt,
            "postprocess_output": req.postprocess_output,
        },
        status="processing",
    )
    task_id = task["id"]
    update_task_status(task_id, status="processing", started=True)

    gen_config = OmniVoiceGenerationConfig(
        num_step=int(req.num_step or 32),
        guidance_scale=float(req.guidance_scale or 2.0),
        denoise=bool(req.denoise),
        preprocess_prompt=bool(req.preprocess_prompt),
        postprocess_output=bool(req.postprocess_output),
    )

    lang = req.language if (req.language and req.language != "Auto") else None

    kw: Dict[str, Any] = {
        "text": req.text.strip(),
        "language": lang,
        "instruct": req.instruct.strip(),
        "generation_config": gen_config,
    }

    if req.speed is not None and float(req.speed) != 1.0:
        kw["speed"] = float(req.speed)
    if req.duration is not None and float(req.duration) > 0:
        kw["duration"] = float(req.duration)

    start_time = time.time()
    try:
        audio = model.generate(**kw)
    except Exception as e:
        logger.error(f"Generation error: {e}")
        update_task_status(task_id, status="failed", error_message=str(e), completed=True)
        raise HTTPException(status_code=500, detail=str(e))
    
    elapsed = time.time() - start_time
    output_filename = f"out_design_{uuid.uuid4().hex[:10]}.wav"
    output_path = OUTPUTS_DIR / output_filename

    sf.write(str(output_path), audio[0], model.sampling_rate)
    duration_sec = len(audio[0]) / model.sampling_rate

    # Generate SRT via Forced Alignment
    srt_filename = output_filename.rsplit(".", 1)[0] + ".srt"
    srt_path = OUTPUTS_DIR / srt_filename
    srt_url = None
    try:
        audio_tensor = torch.from_numpy(audio[0]).float()
        generate_srt_from_audio_and_text_sync(
            audio_tensor=audio_tensor,
            sample_rate=model.sampling_rate,
            text=req.text,
            language=lang,
            output_srt_path=str(srt_path),
        )
        if srt_path.exists():
            srt_url = f"/api/audio/output_{srt_filename}"
    except Exception as srt_e:
        logger.warning(f"Failed to generate SRT for design task {task_id}: {srt_e}")

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

    return {
        "status": "success",
        "task_id": task_id,
        "order_num": task.get("order_num"),
        "audio_url": f"/api/audio/output_{output_filename}",
        "filename": output_filename,
        "srt_url": srt_url,
        "duration_sec": round(duration_sec, 2),
        "generation_time_sec": round(elapsed, 2),
        "text": req.text,
        "instruct": req.instruct,
        "sampling_rate": model.sampling_rate,
    }


class TTSWithSubtitlesRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None
    language: str = "vi"
    instruct: Optional[str] = None
    speed: Optional[float] = 1.0
    num_step: int = 16
    guidance_scale: float = 2.0


@app.post("/api/tts/generate-with-subtitles")
def generate_with_subtitles(req: TTSWithSubtitlesRequest):
    """Generate speech along with synchronized SRT subtitles and optional MP3."""
    model = get_model()
    if model is None:
        raise HTTPException(status_code=503, detail="Model is still loading, please wait.")

    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    take_id = f"sub_{uuid.uuid4().hex[:10]}"
    gen_config = OmniVoiceGenerationConfig(
        num_step=int(req.num_step or 16),
        guidance_scale=float(req.guidance_scale or 2.0),
    )

    lang = req.language if (req.language and req.language != "Auto") else None

    kw: Dict[str, Any] = {
        "text": req.text.strip(),
        "language": lang,
        "generation_config": gen_config,
    }

    if req.speed is not None and float(req.speed) != 1.0:
        kw["speed"] = float(req.speed)
    if req.instruct and req.instruct.strip():
        kw["instruct"] = req.instruct.strip()

    if req.voice_id:
        prompt, audio_path, store_ref_text = voice_store.get_prompt_or_audio(req.voice_id, model=model)
        if prompt is not None:
            kw["voice_clone_prompt"] = prompt
        elif audio_path is not None:
            kw["ref_audio"] = audio_path
            kw["ref_text"] = store_ref_text or None
        else:
            raise HTTPException(status_code=404, detail="Voice file not found")
    elif not kw.get("instruct"):
        kw["instruct"] = "Clear natural voice"

    try:
        audio = model.generate(**kw)
    except Exception as e:
        logger.error(f"Generation error in generate_with_subtitles: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    audio_tensor = torch.from_numpy(audio[0]).float()
    export_res = export_voice_with_srt(
        audio_tensor=audio_tensor,
        sample_rate=model.sampling_rate,
        text=req.text.strip(),
        output_dir=str(OUTPUTS_DIR),
        base_name=take_id,
        language=lang,
    )

    audio_file = f"{take_id}.mp3" if export_res["mp3_path"] else f"{take_id}.wav"
    return {
        "id": take_id,
        "status": "success",
        "audio_url": f"/api/audio/output_{audio_file}",
        "srt_url": f"/api/audio/output_{take_id}.srt",
        "has_mp3": export_res["mp3_path"] is not None,
        "srt_content": export_res.get("srt_content", ""),
    }


@app.post("/api/tasks/{task_id}/generate-srt")
def generate_task_srt(task_id: str):
    """Generate or re-generate SRT subtitle file for an existing task."""
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    filename = task.get("filename")
    if not filename:
        raise HTTPException(status_code=400, detail="Task has no audio file yet")
    audio_path = OUTPUTS_DIR / filename
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found on disk")

    text = task.get("text", "")
    lang = task.get("language")
    if not lang or lang == "Auto":
        lang = None

    try:
        audio_data, sr = sf.read(str(audio_path))
        if audio_data.ndim > 1:
            audio_data = audio_data[:, 0]
        audio_tensor = torch.from_numpy(audio_data).float()

        srt_filename = filename.rsplit(".", 1)[0] + ".srt"
        srt_path = OUTPUTS_DIR / srt_filename
        srt_content = generate_srt_from_audio_and_text_sync(
            audio_tensor=audio_tensor,
            sample_rate=sr,
            text=text,
            language=lang,
            output_srt_path=str(srt_path),
        )
        srt_url = f"/api/audio/output_{srt_filename}"
        update_task_status(task_id, status=task["status"], srt_url=srt_url, srt_filename=srt_filename)
        return {
            "status": "success",
            "task_id": task_id,
            "srt_url": srt_url,
            "srt_filename": srt_filename,
            "srt_content": srt_content,
        }
    except Exception as e:
        logger.error(f"Failed to generate SRT for task {task_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/audio/{filename}")
def serve_audio(filename: str):
    if filename.startswith("voice_"):
        voice_id = filename.replace("voice_", "")
        voice = voice_store.get_voice(voice_id)
        if voice:
            audio_name = voice.get("audio_filename")
            if audio_name:
                target_path = VOICES_DIR / audio_name
                if target_path.exists():
                    media_type = "audio/mpeg" if target_path.suffix.lower() == ".mp3" else "audio/wav"
                    return FileResponse(str(target_path), media_type=media_type)
    elif filename.startswith("output_"):
        actual_name = filename.replace("output_", "")
        target_path = OUTPUTS_DIR / actual_name
        if target_path.exists():
            suffix = target_path.suffix.lower()
            if suffix == ".srt":
                return FileResponse(
                    str(target_path),
                    media_type="text/plain; charset=utf-8",
                    filename=actual_name,
                    headers={"Content-Disposition": f'attachment; filename="{actual_name}"'},
                )
            elif suffix == ".mp3":
                return FileResponse(str(target_path), media_type="audio/mpeg", filename=actual_name)
            return FileResponse(str(target_path), media_type="audio/wav")

    raise HTTPException(status_code=404, detail="Audio file not found")


# Mount static web UI (look in web/out or web_dist)
web_candidates = [
    Path(__file__).resolve().parent.parent.parent / "web" / "out",
    Path(__file__).resolve().parent / "web_dist",
    Path("web/out"),
    Path("web_dist"),
]
for candidate in web_candidates:
    if candidate.exists() and (candidate / "index.html").exists():
        logger.info(f"Serving Static Web UI from: {candidate.resolve()}")
        app.mount("/", StaticFiles(directory=str(candidate), html=True), name="web_ui")
        break


def main():
    import uvicorn
    uvicorn.run("omnivoice.api.server:app", host="0.0.0.0", port=8000, reload=False)


if __name__ == "__main__":
    main()
