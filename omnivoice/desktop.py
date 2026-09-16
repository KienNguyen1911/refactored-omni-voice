import os
import sys
import time
import logging
import threading
import urllib.request
from pathlib import Path

# Setup environment before PyTorch/CUDA initializations
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
os.environ.setdefault("PYTHONUNBUFFERED", "1")

# Configure FFmpeg paths
project_root = Path(__file__).resolve().parent.parent
possible_ffmpeg_paths = [
    project_root / "tools" / "ffmpeg" / "bin",
    Path(r"C:\Dev\VoiceStudio"),
    Path(os.path.expandvars(r"%LOCALAPPDATA%\Programs\node")),
]
for p in possible_ffmpeg_paths:
    if p.exists() and str(p) not in os.environ.get("PATH", ""):
        os.environ["PATH"] = f"{p};{os.environ.get('PATH', '')}"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("omnivoice.desktop")

import uvicorn
import webview
from omnivoice.api.server import app


class UvicornServerThread(threading.Thread):
    def __init__(self, host: str = "127.0.0.1", port: int = 8000):
        super().__init__(daemon=True)
        self.host = host
        self.port = port
        config = uvicorn.Config(
            app=app,
            host=host,
            port=port,
            log_level="warning",
            access_log=False,
        )
        self.server = uvicorn.Server(config)

    def run(self):
        self.server.run()

    def stop(self):
        self.server.should_exit = True


def wait_for_server(url: str, timeout: float = 20.0) -> bool:
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.25)
    return False


def main():
    host = "127.0.0.1"
    port = 8000
    health_url = f"http://{host}:{port}/api/health"
    app_url = f"http://{host}:{port}/"

    logger.info("Dang khoi dong OmniVoice Backend Server...")
    server_thread = UvicornServerThread(host=host, port=port)
    server_thread.start()

    logger.info("Dang cho Backend API san sang...")
    if not wait_for_server(health_url, timeout=25.0):
        logger.warning("Khong the ket noi den /api/health trong 25 giay, van tiep tuc mo cua so.")

    logger.info("Mo cua so OmniVoice Studio Desktop...")
    window = webview.create_window(
        title="OmniVoice Studio",
        url=app_url,
        width=1380,
        height=900,
        min_size=(1024, 680),
        background_color="#08090b",
        text_select=True,
    )

    try:
        # Start PyWebView with Edge Chromium (WebView2)
        webview.start(gui="edgechromium", debug=False)
    except Exception as e:
        logger.warning(f"edgechromium fallback to default: {e}")
        webview.start(debug=False)

    logger.info("Nguoi dung da dong cua so. Dang don dep tien trinh...")
    try:
        from omnivoice.api.server import task_worker
        task_worker.stop()
    except Exception as e:
        logger.warning(f"Loi khi dung task_worker: {e}")

    server_thread.stop()
    logger.info("OmniVoice Studio da dong an toan.")
    sys.exit(0)


if __name__ == "__main__":
    main()
