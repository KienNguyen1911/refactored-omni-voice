#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OmniVoice Studio - Google Colab All-In-One Setup & Launcher
===========================================================
Tự động thiết lập môi trường và chạy OmniVoice Studio trên Google Colab:
1. Kiểm tra GPU CUDA
2. Cài đặt FFmpeg & các thư viện Python
3. Biên dịch Static Web UI (Next.js)
4. Khởi động Cloudflare Tunnel (Miễn phí, không cần đăng ký tài khoản)
5. Khởi động FastAPI Backend Server (OmniVoice Studio)
6. Cung cấp Public HTTPS URL để sử dụng trực tiếp trên trình duyệt
"""

import os
import re
import sys
import time
import shutil
import argparse
import subprocess
import threading
from pathlib import Path

# Force UTF-8 encoding for console output across all platforms
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Cấu hình môi trường tối ưu cho PyTorch & CUDA trên Colab
os.environ["PYTHONUNBUFFERED"] = "1"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"


def run_cmd(cmd: str, check: bool = True, cwd: str = None) -> subprocess.CompletedProcess:
    """Thực thi câu lệnh shell và in ra màn hình."""
    print(f"--> [RUN] {cmd}")
    return subprocess.run(cmd, shell=True, check=check, cwd=cwd)


def check_gpu():
    """Kiểm tra GPU CUDA trên Google Colab."""
    print("=" * 70)
    print(" [1/5] KIỂM TRA MÔI TRƯỜNG PHẦN CỨNG (GPU)")
    print("=" * 70)
    try:
        import torch
        if torch.cuda.is_available():
            device_name = torch.cuda.get_device_name(0)
            vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
            print(f"[OK] GPU phát hiện: {device_name} ({vram_gb:.1f} GB VRAM)")
        else:
            print("[CẢNH BÁO] Không tìm thấy GPU CUDA! OmniVoice sẽ chạy chậm trên CPU.")
            print("Khuyên dùng: Vào Runtime -> Change runtime type -> Chọn T4 GPU (hoặc A100/V100).")
    except Exception as e:
        print(f"[CẢNH BÁO] Không thể kiểm tra PyTorch GPU: {e}")


def install_dependencies(skip_install: bool = False, install_whisperx: bool = False):
    """Cài đặt hệ thống và các gói Python cần thiết."""
    if skip_install:
        print("[2/5] Bỏ qua bước cài đặt thư viện (--skip-install).")
        return

    print("=" * 70)
    print(" [2/5] CÀI ĐẶT THƯ VIỆN HỆ THỐNG & PYTHON")
    print("=" * 70)

    # 1. Cài đặt FFmpeg nếu chưa có
    if not shutil.which("ffmpeg"):
        print("Đang cài đặt FFmpeg...")
        run_cmd("apt-get update -qq && apt-get install -y -qq ffmpeg", check=False)
    else:
        print("[OK] FFmpeg đã sẵn sàng.")

    # 2. Cài đặt các gói Python phụ thuộc
    print("Đang cài đặt các thư viện phụ thuộc...")
    pkgs = [
        "fastapi",
        "uvicorn",
        "python-multipart",
        "pydub",
        "soundfile",
        "librosa",
        "accelerate",
        "gradio",
    ]
    run_cmd(f"pip install -q {' '.join(pkgs)}", check=False)

    # Cài đặt chính package omnivoice ở chế độ editable
    root_dir = Path(__file__).resolve().parent
    run_cmd(f"pip install -q -e .", cwd=str(root_dir), check=False)

    if install_whisperx:
        print("Đang cài đặt WhisperX cho tính năng đồng bộ phụ đề SRT...")
        run_cmd("pip install -q git+https://github.com/m-bain/whisperx.git", check=False)


def prepare_frontend(root_dir: Path, force_rebuild: bool = False):
    """Kiểm tra và biên dịch frontend Next.js nếu cần."""
    print("=" * 70)
    print(" [3/5] KIỂM TRA GIAO DIỆN WEB (NEXT.JS FRONTEND)")
    print("=" * 70)

    web_out = root_dir / "web" / "out"
    index_file = web_out / "index.html"

    if index_file.exists() and not force_rebuild:
        print(f"[OK] Giao diện web đã được build sẵn tại {web_out}.")
        return

    print("Đang tiến hành build Static Web UI từ thư mục web/...")
    web_dir = root_dir / "web"
    if not web_dir.exists():
        print("[LỖI] Không tìm thấy thư mục web/!")
        return

    # Chạy npm install và build
    run_cmd("npm install --silent", cwd=str(web_dir), check=True)
    run_cmd("npm run build", cwd=str(web_dir), check=True)

    if (web_out / "index.html").exists():
        print("[OK] Build giao diện Next.js thành công!")
    else:
        print("[CẢNH BÁO] Không tìm thấy index.html sau khi build.")


def setup_cloudflared(root_dir: Path) -> Path:
    """Tải và cấu hình Cloudflare Tunnel trên Colab Linux."""
    print("=" * 70)
    print(" [4/5] THIẾT LẬP CLOUDFLARE TUNNEL (PUBLIC ACCESS)")
    print("=" * 70)

    cf_path = root_dir / "cloudflared"
    if not cf_path.exists():
        print("Đang tải Cloudflare Tunnel binary...")
        url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
        import urllib.request
        urllib.request.urlretrieve(url, str(cf_path))
        cf_path.chmod(0o755)
        print("[OK] Đã tải cloudflared.")
    else:
        print("[OK] Cloudflare Tunnel đã sẵn sàng.")

    return cf_path


def start_tunnel_and_server(root_dir: Path, port: int = 8000, mode: str = "studio"):
    """Khởi động server và Cloudflare Tunnel, hiển thị link truy cập."""
    print("=" * 70)
    print(f" [5/5] KHỞI ĐỘNG OMNIVOICE ({mode.upper()})")
    print("=" * 70)

    if mode == "gradio":
        print("Đang khởi động giao diện Gradio Demo với chế độ chia sẻ công khai...")
        cmd = f"python -m omnivoice.cli.demo --model k2-fsa/OmniVoice --port {port} --share"
        run_cmd(cmd, cwd=str(root_dir))
        return

    # Chế độ Studio (FastAPI + Web UI Next.js + Cloudflare Tunnel)
    cf_path = setup_cloudflared(root_dir)

    # Khởi động Cloudflare Tunnel
    tunnel_cmd = [str(cf_path), "tunnel", "--url", f"http://127.0.0.1:{port}"]
    tunnel_proc = subprocess.Popen(
        tunnel_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    tunnel_url = None
    url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")

    def monitor_tunnel():
        nonlocal tunnel_url
        for line in tunnel_proc.stdout:
            match = url_pattern.search(line)
            if match and not tunnel_url:
                tunnel_url = match.group(0)

    t_thread = threading.Thread(target=monitor_tunnel, daemon=True)
    t_thread.start()

    # Khởi động FastAPI server
    print(f"Đang khởi động OmniVoice Backend Server tại cổng {port}...")
    server_cmd = [sys.executable, "-m", "omnivoice.api.server"]
    server_proc = subprocess.Popen(
        server_cmd,
        cwd=str(root_dir),
    )

    # Chờ lấy Cloudflare URL (tối đa 30s)
    print("Đang tạo đường link truy cập công khai (Public HTTPS URL)...")
    for _ in range(60):
        if tunnel_url:
            break
        time.sleep(0.5)

    print("\n" + "=" * 70)
    if tunnel_url:
        print("  🎉 OMNIVOICE STUDIO ĐÃ SẴN SÀNG TRÊN GOOGLE COLAB! 🎉")
        print("=" * 70)
        print(f"\n  👉 BẤM VÀO ĐÂY ĐỂ MỞ GIAO DIỆN WEB:")
        print(f"     🔗 {tunnel_url}\n")
        print(f"  Local Endpoint: http://127.0.0.1:{port}")
    else:
        print("  [LƯU Ý] Chưa bắt được link Cloudflare. Kiểm tra local:")
        print(f"  Local Endpoint: http://127.0.0.1:{port}")
    print("=" * 70)
    print("Nhấn Ctrl+C trong notebook để dừng server.\n")

    try:
        server_proc.wait()
    except KeyboardInterrupt:
        print("\nĐang dừng OmniVoice Studio...")
    finally:
        server_proc.terminate()
        tunnel_proc.terminate()


def main():
    parser = argparse.ArgumentParser(description="Chạy OmniVoice Studio trên Google Colab")
    parser.add_argument("--mode", choices=["studio", "gradio"], default="studio",
                        help="Chọn giao diện: 'studio' (Next.js Web UI đầy đủ) hoặc 'gradio' (Demo đơn giản)")
    parser.add_argument("--port", type=int, default=8000, help="Cổng chạy server (mặc định: 8000)")
    parser.add_argument("--skip-install", action="store_true", help="Bỏ qua bước cài đặt gói thư viện")
    parser.add_argument("--rebuild-frontend", action="store_true", help="Biên dịch lại giao diện Next.js")
    parser.add_argument("--with-whisperx", action="store_true", help="Cài đặt thêm WhisperX cho SRT forced alignment")
    args = parser.parse_args()

    root_dir = Path(__file__).resolve().parent

    check_gpu()
    install_dependencies(skip_install=args.skip_install, install_whisperx=args.with_whisperx)
    if args.mode == "studio":
        prepare_frontend(root_dir, force_rebuild=args.rebuild_frontend)
    start_tunnel_and_server(root_dir, port=args.port, mode=args.mode)


if __name__ == "__main__":
    main()
