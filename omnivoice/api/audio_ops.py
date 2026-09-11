import os
import re
import uuid
import logging
from pathlib import Path
from typing import List, Tuple, Optional

import numpy as np
import soundfile as sf

logger = logging.getLogger("omnivoice.audio_ops")

COMMON_ABBREVIATIONS = {
    "ts.", "ths.", "pgs.", "gs.", "tp.", "dr.", "mr.", "mrs.", "ms.",
    "v.v.", "etc.", "st.", "prof.", "co.", "ltd.", "inc.", "corp.", "approx.", "vs."
}


def split_sentences(text: str) -> List[str]:
    """
    Splits text into complete sentences.
    Preserves all sentence-terminating punctuation (. ? ! …) and quotation marks.
    Does not break on decimals (e.g. 3.14, 5.0%) or common abbreviations (e.g. TS., Dr.).
    """
    text = text.strip()
    if not text:
        return []

    # Pattern for sentence-terminating punctuation (. ! ? …)
    # optionally followed by quotes/parentheses, then whitespace or newline or EOF
    sentence_pattern = re.compile(r'(?<=[.?!…])[\'\"”’\)\]]*(?:\s+|\n+|$)')

    matches = list(sentence_pattern.finditer(text))
    sentences = []
    start = 0

    for m in matches:
        end = m.end()
        candidate = text[start:end].strip()
        if not candidate:
            continue

        # Check if candidate ends with an abbreviation or decimal number
        words = candidate.split()
        last_word = words[-1].lower() if words else ""
        if last_word in COMMON_ABBREVIATIONS:
            continue
        if re.search(r'\d+\.$', candidate):
            continue

        sentences.append(candidate)
        start = end

    if start < len(text):
        remaining = text[start:].strip()
        if remaining:
            if sentences:
                sentences[-1] += " " + remaining
            else:
                sentences.append(remaining)

    return sentences


def split_text_by_sentence_chunks(text: str, target_chars: int = 1000) -> List[str]:
    """
    Splits text into chunks of roughly `target_chars` (default ~1000 characters).
    MANDATORY RULE:
    Each chunk MUST terminate on a complete sentence boundary.
    If the target_chars count falls in the middle of a sentence, extend until the complete end of that sentence.
    """
    sentences = split_sentences(text)
    if not sentences:
        return []

    chunks = []
    current_chunk = []
    current_len = 0

    for s in sentences:
        current_chunk.append(s)
        current_len += len(s) + 1  # count separation space
        if current_len >= target_chars:
            chunk_str = " ".join(current_chunk).strip()
            if chunk_str:
                chunks.append(chunk_str)
            current_chunk = []
            current_len = 0

    if current_chunk:
        chunk_str = " ".join(current_chunk).strip()
        if chunk_str:
            chunks.append(chunk_str)

    return chunks


def merge_audio_files(
    file_paths: List[Path],
    output_path: Path,
    gap_sec: float = 0.8,
) -> Tuple[float, int]:
    """
    Merges multiple audio files into a single WAV file with a silence gap between them.
    
    Args:
        file_paths: List of Paths to input audio files.
        output_path: Path where the merged WAV file will be written.
        gap_sec: Silence duration in seconds between consecutive audio segments (default 0.8s).
        
    Returns:
        (total_duration_sec, sampling_rate)
    """
    if not file_paths:
        raise ValueError("No audio files provided to merge.")

    valid_paths = [p for p in file_paths if p.exists() and p.is_file()]
    if not valid_paths:
        raise FileNotFoundError(f"None of the provided audio files exist: {file_paths}")

    audio_segments = []
    target_sr = None

    for p in valid_paths:
        try:
            data, sr = sf.read(str(p), dtype="float32")
            # If multi-channel, convert to mono
            if data.ndim > 1:
                data = data.mean(axis=1)

            if target_sr is None:
                target_sr = sr
            elif sr != target_sr:
                # If sample rate differs, simple resample or log warning (all OmniVoice files are 24000Hz)
                import scipy.signal
                num_samples = int(round(len(data) * float(target_sr) / sr))
                data = scipy.signal.resample(data, num_samples).astype(np.float32)

            audio_segments.append(data)
        except Exception as e:
            logger.error(f"Error reading audio file {p}: {e}")
            raise e

    if target_sr is None:
        target_sr = 24000

    gap_samples = int(round(target_sr * max(0.0, gap_sec)))
    silence = np.zeros(gap_samples, dtype=np.float32) if gap_samples > 0 else np.array([], dtype=np.float32)

    concatenated_parts = []
    for i, segment in enumerate(audio_segments):
        if i > 0 and len(silence) > 0:
            concatenated_parts.append(silence)
        concatenated_parts.append(segment)

    final_audio = np.concatenate(concatenated_parts, axis=0)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_path), final_audio, target_sr)

    total_duration = len(final_audio) / target_sr
    logger.info(
        f"Merged {len(valid_paths)} audio files into {output_path.name} "
        f"(duration: {total_duration:.2f}s, gap: {gap_sec}s, sr: {target_sr}Hz)"
    )

    return total_duration, target_sr
