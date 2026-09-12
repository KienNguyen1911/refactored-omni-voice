import sys
import os
import torch
import soundfile as sf
import whisperx
from omnivoice.api.forced_alignment_srt import _prepare_audio_16k_mono, format_srt_timestamp

wav_path = "outputs/out_clone_80bd675d70.wav"
audio, sr = sf.read(wav_path)
a16 = _prepare_audio_16k_mono(torch.from_numpy(audio).float(), sr)
total_dur = len(audio) / sr

# Text gốc hoàn toàn của đoạn này
text = (
    "Hai năm sau thì ông này mở rộng những ý tưởng này thành cuốn sách Parkinson's Law The Pursue of Progress. "
    "Trong đó thì có một câu rất là nổi tiếng là công việc luôn tự mở rộng để lấp đầy khoảng thời gian được ấn định cho nó. "
    "Để minh họa thì Bing Sơn kể về một bà lão nhàn dỗi dành gần như là cả ngày để chỉ viết thư và gửi một tấm ưu thiếp cho cháu gái. "
    "Vì thế nên là bà mất một tiếng để tìm ưu thiếp này, 1 giờ để tìm kính này, nửa tiếng để tìm địa chỉ này, "
    "hơn một tiếng để nghĩ xem là nên viết cái gì, rồi thêm 20 phút chỉ để phân vân xem là có nên mang ô ra ngoài khi mà gửi thứ hay không."
)

# 1. Output dạng câu nguyên bản (Raw Sentence-level) của người dùng chưa qua thuật toán cắt nhỏ
raw_sentences = [
    "Hai năm sau thì ông này mở rộng những ý tưởng này thành cuốn sách Parkinson's Law The Pursue of Progress.",
    "Trong đó thì có một câu rất là nổi tiếng là công việc luôn tự mở rộng để lấp đầy khoảng thời gian được ấn định cho nó.",
    "Để minh họa thì Bing Sơn kể về một bà lão nhàn dỗi dành gần như là cả ngày để chỉ viết thư và gửi một tấm ưu thiếp cho cháu gái.",
    "Vì thế nên là bà mất một tiếng để tìm ưu thiếp này, 1 giờ để tìm kính này, nửa tiếng để tìm địa chỉ này, hơn một tiếng để nghĩ xem là nên viết cái gì, rồi thêm 20 phút chỉ để phân vân xem là có nên mang ô ra ngoài khi mà gửi thứ hay không."
]

# Nạp model WhisperX alignment
device = "cuda" if torch.cuda.is_available() else "cpu"
model_a, metadata = whisperx.load_align_model(language_code="vi", device=device)

# Chạy align trên raw sentences
coarse_segs = []
cur = 0.0
for s in raw_sentences:
    d = (len(s) / len(text)) * total_dur
    coarse_segs.append({"start": cur, "end": cur + d, "text": s})
    cur += d

res = whisperx.align(coarse_segs, model_a, metadata, a16, device)

# Xuất 1: Raw Sentence Level SRT (nguyên câu gốc từ WhisperX)
with open("outputs/raw_whisperx_sentences.srt", "w", encoding="utf-8") as f:
    for idx, seg in enumerate(res.get("segments", []), 1):
        s_ts = format_srt_timestamp(seg.get("start", 0.0))
        e_ts = format_srt_timestamp(seg.get("end", 0.0))
        txt = seg.get("text", "").strip()
        f.write(f"{idx}\n{s_ts} --> {e_ts}\n{txt}\n\n")

# Xuất 2: Raw Word Level SRT (từng từ một theo mốc WhisperX)
words = res.get("word_segments", [])
with open("outputs/raw_whisperx_words.srt", "w", encoding="utf-8") as f:
    for idx, w in enumerate(words, 1):
        s_val = w.get("start")
        e_val = w.get("end")
        if s_val is None:
            s_val = 0.0
        if e_val is None:
            e_val = s_val + 0.1
        s_ts = format_srt_timestamp(float(s_val))
        e_ts = format_srt_timestamp(float(e_val))
        f.write(f"{idx}\n{s_ts} --> {e_ts}\n{w.get('word', '')}\n\n")

print("Generated raw_whisperx_sentences.srt and raw_whisperx_words.srt successfully!")
