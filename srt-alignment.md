Viewed forced_alignment_srt.py:100-250

Dưới đây là tài liệu hướng dẫn triển khai module **Forced Alignment & SRT Generation** (kèm xuất audio MP3) tích hợp vào **Omni Studio**.

---

# TÀI LIỆU TRIỂN KHAI: SRT FORCED ALIGNMENT & AUDIO MP3

## 1. Kiến trúc & Nguyên lý hoạt động

Thay vì dùng ASR (Speech-to-Text) chạy lại từ đầu để lấy timestamp (dễ bị nhận diện sai/ảo giác chữ - hallucination), giải pháp trong [forced_alignment_srt.py](file:///c:/Dev/VoiceStudio/backend/services/forced_alignment_srt.py) sử dụng **Forced Alignment**:
* **Input**: Văn bản gốc (Ground-truth script) + Audio tensor (kết quả sinh từ TTS/Clone).
* **Xử lý**: Sử dụng mô hình CTC/wav2vec2 (qua thư viện `whisperx`) để dóng hàng âm vị/từ vựng trực tiếp lên sóng âm thanh mà không làm thay đổi ký tự script gốc.
* **Cơ chế dự phòng (Fallback)**: Nếu môi trường không có GPU hoặc chưa tải mô hình whisperx, thuật toán sẽ tự động phân bổ timestamp theo trọng số độ dài câu (`generate_fallback_cues`) mà **không bao giờ gây crash luồng sinh audio**.

```
[User Text] ──> [TTS Engine] ──> [Audio Tensor]
      │                                │
      │          ┌─────────────────────┘
      ▼          ▼
[forced_alignment_srt] ──(whisperx / fallback)──> [.srt File]
      │
[FFmpeg / LAME] ─────────────────────────────────> [.mp3 File]
```

---

## 2. Yêu cầu môi trường & Cài đặt thư viện

### 2.1. System Requirements
* Python 3.10+
* **FFmpeg** (đã thêm vào PATH hệ thống để mã hóa MP3).
* CUDA Toolkit (nếu sử dụng GPU để căn chỉnh sub mili-giây, CPU vẫn chạy được).

### 2.2. Dependencies
Cài đặt các gói phụ thuộc vào môi trường ảo:

```bash
# PyTorch & Torchaudio
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121

# Thư viện Forced Alignment (WhisperX)
pip install whisperx

# Xử lý âm thanh
pip install numpy
```

---

## 3. Cấu trúc Module Tích Hợp

Đưa file [forced_alignment_srt.py](file:///c:/Dev/VoiceStudio/backend/services/forced_alignment_srt.py) vào thư mục `services/` của dự án.

### Các hàm cốt lõi:
| Hàm | Nhiệm vụ |
| :--- | :--- |
| `split_text_into_cues(text)` | Phân tách script văn bản thành từng dòng phụ đề hợp lý (theo dấu câu, ngắt câu quá 18 từ hoặc >100 ký tự). |
| `align_with_whisperx(...)` | Dóng hàng sóng âm với từng từ, trả về `start` và `end` time chính xác. |
| `generate_fallback_cues(...)` | Dự phòng phân bổ timeline tỷ lệ thuận theo độ dài câu khi chưa có model alignment. |
| `format_srt_timestamp(seconds)` | Định dạng giây sang chuẩn SRT: `HH:MM:SS,mmm`. |
| `generate_srt_from_audio_and_text(...)` | Hàm facade nhận audio tensor + text, xuất ra file `.srt`. |

---

## 4. Code Mẫu: Tích hợp Tạo Cặp MP3 + SRT

Tạo một helper service (ví dụ: `services/audio_export_service.py`) để xuất song song cả file `.mp3` và `.srt`:

```python
import os
import subprocess
import torch
import torchaudio
from services.forced_alignment_srt import generate_srt_from_audio_and_text

async def export_voice_with_srt(
    audio_tensor: torch.Tensor,
    sample_rate: int,
    text: str,
    output_dir: str,
    base_name: str,
    language: str = "vi",
    mp3_bitrate: str = "192k"
) -> dict:
    """
    Xuất file .mp3 và .srt cùng lúc từ audio tensor và text script.
    """
    os.makedirs(output_dir, exist_ok=True)
    
    wav_temp_path = os.path.join(output_dir, f"{base_name}_temp.wav")
    mp3_path = os.path.join(output_dir, f"{base_name}.mp3")
    srt_path = os.path.join(output_dir, f"{base_name}.srt")
    
    # 1. Lưu tạm WAV tensor để mã hóa
    if audio_tensor.ndim == 1:
        audio_tensor = audio_tensor.unsqueeze(0)
    torchaudio.save(wav_temp_path, audio_tensor.cpu(), sample_rate)
    
    # 2. Chuyển đổi WAV -> MP3 bằng FFmpeg
    try:
        cmd = [
            "ffmpeg", "-y", "-i", wav_temp_path,
            "-codec:a", "libmp3lame", "-b:a", mp3_bitrate,
            mp3_path
        ]
        subprocess.run(cmd, check=True, capture_output=True)
    finally:
        if os.path.exists(wav_temp_path):
            os.remove(wav_temp_path)
            
    # 3. Tạo file SRT đồng bộ
    srt_content = await generate_srt_from_audio_and_text(
        audio_tensor=audio_tensor,
        sample_rate=sample_rate,
        text=text,
        language=language,
        output_srt_path=srt_path
    )
    
    return {
        "mp3_path": mp3_path,
        "srt_path": srt_path,
        "srt_content": srt_content
    }
```

---

## 5. Tích hợp Endpoint vào FastAPI (Omni Studio Backend)

Thêm router vào FastAPI để frontend hoặc client gọi trực tiếp:

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import uuid

router = APIRouter(prefix="/api/tts", tags=["TTS"])

class TTSRequest(BaseModel):
    text: str
    voice_id: str
    language: str = "vi"

@router.post("/generate-with-subtitles")
async def generate_with_subtitles(req: TTSRequest):
    take_id = str(uuid.uuid4())[:8]
    output_dir = "data/outputs"
    
    # 1. Gọi Engine sinh giọng của Omni Studio
    # audio_tensor, sample_rate = await your_tts_engine.synthesize(req.text, req.voice_id)
    
    # 2. Sinh cặp MP3 & SRT
    result = await export_voice_with_srt(
        audio_tensor=audio_tensor,
        sample_rate=sample_rate,
        text=req.text,
        output_dir=output_dir,
        base_name=take_id,
        language=req.language
    )
    
    return {
        "id": take_id,
        "audio_url": f"/audio/{take_id}.mp3",
        "srt_url": f"/audio/{take_id}.srt"
    }
```

---

## 6. Kiểm thử & Xử lý sự cố (Troubleshooting)

| Vấn đề | Nguyên nhân | Cách khắc phục |
| :--- | :--- | :--- |
| **SRT ra timestamp đều nhau mà không khít giọng** | WhisperX chưa tải được model wav2vec2 tương ứng với ngôn ngữ. | Kiểm tra kết nối mạng lần đầu để WhisperX cache model về `~/.cache/huggingface/hub/`. |
| **Lỗi `ffmpeg: command not found`** | Máy chủ chưa có FFmpeg. | Cài đặt ffmpeg (`winget install ffmpeg` trên Windows hoặc `apt install ffmpeg` trên Linux) và khai báo vào System PATH. |
| **Tiếng Việt (`vi`) dóng hàng bị lệch** | Ngôn ngữ chưa nhận diện đúng mã `"vi"`. | Đảm bảo `language="vi"` được truyền vào để hàm `resolve_language_code()` kích hoạt bộ lọc dấu tiếng Việt. |