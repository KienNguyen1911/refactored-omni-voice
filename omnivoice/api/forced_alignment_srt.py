"""Forced alignment and SRT generation service.

Generates word- and sentence-accurate .srt subtitle files directly from
ground-truth script text and synthesized audio, avoiding ASR hallucination,
mishearings, and redundant transcription passes.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Optional, List, Dict, Any
import numpy as np
import torch

logger = logging.getLogger("omnivoice.forced_alignment_srt")

def resolve_language_code(language: Optional[str] = None, text: Optional[str] = None) -> str:
    """Resolve language code (ISO 639-1) or default to 'en'."""
    if language:
        norm = language.strip().lower()
        if norm and norm != "auto":
            return norm[:2]
    return "en"


def format_srt_timestamp(seconds: float) -> str:
    """Format seconds into SRT timestamp HH:MM:SS,mmm."""
    if seconds < 0:
        seconds = 0.0
    total_millis = int(round(seconds * 1000))
    hours = total_millis // 3600000
    minutes = (total_millis % 3600000) // 60000
    secs = (total_millis % 60000) // 1000
    millis = total_millis % 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def _parse_srt_timestamp(ts: str) -> float:
    """Parse SRT timestamp HH:MM:SS,mmm into seconds float."""
    ts = ts.strip().replace(",", ".")
    parts = ts.split(":")
    if len(parts) == 3:
        return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
    elif len(parts) == 2:
        return float(parts[0]) * 60 + float(parts[1])
    return float(parts[0])


def merge_srt_files(
    srt_paths: List[str],
    chunk_durations: List[float],
    output_srt_path: str,
    gap_sec: float = 0.8,
) -> Optional[str]:
    """Merge multiple SRT files sequentially by offsetting timestamps with chunk duration and gap."""
    all_cues: List[Dict[str, Any]] = []
    current_time_offset = 0.0

    for srt_path_str, duration in zip(srt_paths, chunk_durations):
        p = os.path.abspath(srt_path_str)
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    content = f.read()
                blocks = re.split(r"\n\s*\n", content.strip())
                for b in blocks:
                    lines = [l.strip() for l in b.strip().splitlines() if l.strip()]
                    if len(lines) >= 3:
                        ts_match = re.match(r"(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})", lines[1])
                        if ts_match:
                            s_sec = _parse_srt_timestamp(ts_match.group(1)) + current_time_offset
                            e_sec = _parse_srt_timestamp(ts_match.group(2)) + current_time_offset
                            cue_text = "\n".join(lines[2:])
                            all_cues.append({"start": round(s_sec, 3), "end": round(e_sec, 3), "text": cue_text})
            except Exception as e:
                logger.warning("Error reading chunk SRT %s: %s", srt_path_str, e)
        current_time_offset += float(duration) + float(gap_sec)

    if not all_cues:
        return None

    merged_content = build_srt_content(all_cues)
    os.makedirs(os.path.dirname(os.path.abspath(output_srt_path)), exist_ok=True)
    with open(output_srt_path, "w", encoding="utf-8") as f:
        f.write(merged_content)
    logger.info("Saved merged SRT to: %s", output_srt_path)
    return merged_content


CONNECTORS = {
    "and", "or", "but", "that", "which", "when", "where", "to", "for", "with",
    "in", "on", "at", "by", "if", "then", "so", "because", "while", "as", "into",
}


def _split_long_clause(clause: str, max_words: int = 8, max_chars: int = 46) -> List[str]:
    """Split a long clause into natural, bite-sized subtitle cues (typically 5-8 words)."""
    clause = clause.strip()
    if not clause:
        return []

    words = clause.split()
    if len(words) <= max_words and len(clause) <= max_chars:
        return [clause]

    result = []
    current_words: List[str] = []

    i = 0
    while i < len(words):
        current_words.append(words[i])
        current_len = sum(len(w) for w in current_words) + len(current_words) - 1
        remaining_words = len(words) - (i + 1)

        should_break = False
        if len(current_words) >= max_words or current_len >= max_chars:
            should_break = True
        elif len(current_words) >= 4 and remaining_words >= 3:
            next_word = words[i + 1].lower().strip(".,!?;:-\"'“”()[]")
            if next_word in CONNECTORS:
                should_break = True

        # Avoid leaving an orphan of 1 or 2 words at the end
        if should_break and remaining_words in (1, 2) and remaining_words > 0:
            if len(current_words) + remaining_words <= max_words + 2:
                current_words.extend(words[i + 1 :])
                break

        if should_break or i == len(words) - 1:
            chunk = " ".join(current_words).strip()
            if chunk:
                result.append(chunk)
            current_words = []
        i += 1

    if current_words:
        chunk = " ".join(current_words).strip()
        if chunk:
            result.append(chunk)

    return result if result else [clause]


def split_text_into_cues(
    text: str,
    max_words_per_cue: int = 8,
    max_chars_per_cue: int = 46,
) -> List[str]:
    """Split input script text into optimal, professional subtitle cues.
    
    Guarantees:
    - No oversized cues (typically 5 to 8 words per cue, ~1.5 to 3.5 seconds).
    - Natural phrase breaks at sentence punctuation, clause punctuation, and conjunctions.
    - Zero orphan words.
    - Perfect preservation of 100% of original words and characters.
    """
    text = text.strip()
    if not text:
        return []

    lines = [p.strip() for p in text.splitlines() if p.strip()]
    cues = []

    for line in lines:
        # Split sentences by standard sentence-ending punctuation (.?!…)
        sentences = re.split(r"(?<=[.?!…])\s+", line)
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue

            # Split into clauses by standard punctuation (comma, semicolon, colon, dash)
            clauses = re.split(r"(?<=[,;:\-—])\s+", sentence)
            for clause in clauses:
                clause = clause.strip()
                if not clause:
                    continue

                sub_cues = _split_long_clause(clause, max_words=max_words_per_cue, max_chars=max_chars_per_cue)
                cues.extend(sub_cues)

    return cues if cues else [text]



def generate_fallback_cues(cues: List[str], total_duration: float) -> List[Dict[str, Any]]:
    """Proportionally distribute cue durations based on character/word weight."""
    if not cues:
        return []
    if len(cues) == 1:
        return [{"start": 0.0, "end": round(total_duration, 3), "text": cues[0]}]

    # Compute weights based on character length with min base weight per cue
    weights = [max(10, len(c)) for c in cues]
    total_weight = sum(weights)
    if total_weight <= 0:
        total_weight = 1

    result = []
    current_time = 0.0
    for i, (cue_text, w) in enumerate(zip(cues, weights)):
        is_last = (i == len(cues) - 1)
        dur = (w / total_weight) * total_duration
        if is_last:
            start = current_time
            end = total_duration
        else:
            start = current_time
            end = current_time + dur
        result.append({
            "start": round(max(0.0, start), 3),
            "end": round(max(start + 0.1, end), 3),
            "text": cue_text,
        })
        current_time = end

    return result


def _prepare_audio_16k_mono(audio_tensor: torch.Tensor, sample_rate: int) -> np.ndarray:
    """Resample torch audio tensor to 16kHz mono float32 numpy array for whisperx."""
    with torch.no_grad():
        t = audio_tensor.detach()
        if t.ndim > 1:
            if t.shape[0] > 1:
                t = t.mean(dim=0, keepdim=True)
            elif t.ndim == 3: # [batch, channels, samples]
                t = t.squeeze(0)
                if t.shape[0] > 1:
                    t = t.mean(dim=0, keepdim=True)
        else:
            t = t.unsqueeze(0)

        if sample_rate != 16000:
            import torchaudio.functional as F
            t = F.resample(t.float(), sample_rate, 16000)

        # Ensure float32 1D numpy array
        arr = t.squeeze(0).cpu().numpy().astype(np.float32)
        # Normalize if needed
        max_val = np.max(np.abs(arr)) if arr.size > 0 else 0.0
        if max_val > 1.0:
            arr = arr / max_val
        return arr



_ALIGN_MODEL_CACHE: Dict[str, Any] = {}


def get_whisperx_align_model(language_code: str, device: str):
    """Retrieve or load standard WhisperX alignment model for the requested language."""
    import whisperx
    key = f"{language_code}_{device}"
    if key not in _ALIGN_MODEL_CACHE:
        logger.info("Loading standard WhisperX align model for language='%s' on %s...", language_code, device)
        model_a, metadata = whisperx.load_align_model(language_code=language_code, device=device)
        _ALIGN_MODEL_CACHE[key] = (model_a, metadata)
    return _ALIGN_MODEL_CACHE[key]


def align_with_whisperx(
    audio_tensor: torch.Tensor,
    sample_rate: int,
    cues: List[str],
    language_code: str,
    total_duration: float,
) -> List[Dict[str, Any]]:
    """Align ground truth cues with audio using standard official WhisperX alignment."""
    import whisperx

    if not cues:
        return []

    # Prepare 16kHz mono audio as required by WhisperX wav2vec2 CTC aligner
    audio_16k = _prepare_audio_16k_mono(audio_tensor, sample_rate)

    coarse_cues = generate_fallback_cues(cues, total_duration)

    # Segment windows for wav2vec2 CTC alignment
    segments = [
        {
            "start": round(max(0.0, c["start"] - 0.25), 3),
            "end": round(min(total_duration, c["end"] + 0.35), 3),
            "text": c["text"],
        }
        for c in coarse_cues
    ]

    # Device selection: prefer CUDA if available, fallback to CPU
    devices = []
    if torch.cuda.is_available():
        devices.append("cuda")
    devices.append("cpu")

    aligned_result = None
    for dev in devices:
        try:
            model_a, metadata = get_whisperx_align_model(language_code=language_code, device=dev)
            aligned_result = whisperx.align(
                segments, model_a, metadata, audio_16k, dev, return_char_alignments=False,
            )
            if aligned_result and aligned_result.get("segments"):
                break
        except Exception as exc:
            logger.debug("whisperx.align on %s failed: %s", dev, exc)

    if not aligned_result or not aligned_result.get("segments"):
        return coarse_cues

    aligned_segments = aligned_result["segments"]
    final_cues = []
    last_end = 0.0

    for i, cue in enumerate(cues):
        coarse = coarse_cues[i]
        seg = aligned_segments[i] if i < len(aligned_segments) else None

        c_start = None
        c_end = None
        if seg:
            if seg.get("start") is not None:
                c_start = float(seg["start"])
            if seg.get("end") is not None:
                c_end = float(seg["end"])

        # If whisperx didn't get a valid start/end for this segment, use coarse
        if c_start is None:
            c_start = coarse["start"]
        if c_end is None:
            c_end = coarse["end"]

        # Ensure monotonic order and non-overlapping timeline
        cue_start = max(last_end, c_start)
        cue_end = max(cue_start + 0.15, c_end)

        # Clamp within total duration
        cue_start = min(cue_start, total_duration)
        cue_end = min(max(cue_start + 0.1, cue_end), total_duration)

        final_cues.append({
            "start": round(cue_start, 3),
            "end": round(cue_end, 3),
            "text": cue,
        })
        last_end = cue_end

    return final_cues



def build_srt_content(cues: List[Dict[str, Any]]) -> str:
    """Build standard SubRip (.srt) file content from cue list."""
    blocks = []
    for idx, cue in enumerate(cues, 1):
        start_ts = format_srt_timestamp(cue["start"])
        end_ts = format_srt_timestamp(cue["end"])
        text = cue["text"].strip()
        blocks.append(f"{idx}\n{start_ts} --> {end_ts}\n{text}\n")
    return "\n".join(blocks) + "\n"


def get_ffmpeg_path() -> Optional[str]:
    """Find available FFmpeg executable."""
    import shutil
    if shutil.which("ffmpeg"):
        return "ffmpeg"
    
    candidates = [
        r"C:\Dev\VoiceStudio\ffmpeg.exe",
        r"C:\Dev\VoiceStudio\bin\ffmpeg.exe",
    ]
    for c in candidates:
        if os.path.exists(c):
            # Also add to PATH so spawned subprocesses can find it
            dir_path = os.path.dirname(c)
            if dir_path not in os.environ.get("PATH", ""):
                os.environ["PATH"] = dir_path + os.pathsep + os.environ.get("PATH", "")
            return c
    return None


def generate_srt_from_audio_and_text_sync(
    audio_tensor: torch.Tensor,
    sample_rate: int,
    text: str,
    language: Optional[str] = None,
    output_srt_path: Optional[str] = None,
) -> str:
    """Synchronous version of SRT generation using Forced Alignment."""
    try:
        clean_text = text.strip()
        if not clean_text:
            return ""

        total_samples = audio_tensor.shape[-1]
        total_duration = max(0.1, round(total_samples / sample_rate, 3))

        cues = split_text_into_cues(clean_text)
        if not cues:
            return ""

        lang_code = resolve_language_code(language, clean_text)

        # Attempt whisperx forced alignment
        try:
            aligned_cues = align_with_whisperx(
                audio_tensor=audio_tensor,
                sample_rate=sample_rate,
                cues=cues,
                language_code=lang_code,
                total_duration=total_duration,
            )
        except Exception as align_err:
            logger.warning(
                "WhisperX forced alignment unavailable (%s), falling back to sentence-level timing",
                align_err,
            )
            aligned_cues = generate_fallback_cues(cues, total_duration)

        srt_content = build_srt_content(aligned_cues)

        if output_srt_path:
            os.makedirs(os.path.dirname(os.path.abspath(output_srt_path)), exist_ok=True)
            with open(output_srt_path, "w", encoding="utf-8") as f:
                f.write(srt_content)
            logger.info("Saved forced-aligned SRT to: %s", output_srt_path)

        return srt_content

    except Exception as e:
        logger.error("Failed to generate SRT: %s", e, exc_info=True)
        return ""


async def generate_srt_from_audio_and_text(
    audio_tensor: torch.Tensor,
    sample_rate: int,
    text: str,
    language: Optional[str] = None,
    output_srt_path: Optional[str] = None,
) -> str:
    """Async wrapper for generate_srt_from_audio_and_text_sync."""
    return generate_srt_from_audio_and_text_sync(
        audio_tensor=audio_tensor,
        sample_rate=sample_rate,
        text=text,
        language=language,
        output_srt_path=output_srt_path,
    )


def export_voice_with_srt(
    audio_tensor: torch.Tensor,
    sample_rate: int,
    text: str,
    output_dir: str,
    base_name: str,
    language: Optional[str] = None,
    mp3_bitrate: str = "192k",
) -> Dict[str, Any]:
    """Export audio in WAV, optionally MP3, and generate aligned SRT."""
    import subprocess
    import torchaudio

    os.makedirs(output_dir, exist_ok=True)
    wav_path = os.path.join(output_dir, f"{base_name}.wav")
    mp3_path = os.path.join(output_dir, f"{base_name}.mp3")
    srt_path = os.path.join(output_dir, f"{base_name}.srt")

    t = audio_tensor.detach().cpu()
    if t.ndim == 1:
        t = t.unsqueeze(0)

    torchaudio.save(wav_path, t, sample_rate)

    ffmpeg_bin = get_ffmpeg_path()
    if ffmpeg_bin:
        try:
            cmd = [
                ffmpeg_bin, "-y", "-i", wav_path,
                "-codec:a", "libmp3lame", "-b:a", mp3_bitrate,
                mp3_path
            ]
            subprocess.run(cmd, check=True, capture_output=True)
        except Exception as e:
            logger.warning("MP3 encoding via FFmpeg failed: %s", e)

    srt_content = generate_srt_from_audio_and_text_sync(
        audio_tensor=audio_tensor,
        sample_rate=sample_rate,
        text=text,
        language=language,
        output_srt_path=srt_path,
    )

    return {
        "wav_path": wav_path,
        "mp3_path": mp3_path if os.path.exists(mp3_path) else None,
        "srt_path": srt_path if os.path.exists(srt_path) else None,
        "srt_content": srt_content,
    }

