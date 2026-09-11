#!/usr/bin/env python3
"""
CLI Tool: Process Long Text with Smart Paragraph Chunking (~1000 chars ending at full sentences)
and Auto-Merge into a Single Audio File with 0.8s Silence Gap.

Usage:
    python tools/process_long_text.py --file transcript.txt --voice de18060d --target-chars 1000 --gap 0.8
"""

import sys
import os
import time
import argparse
import urllib.request
import json
from pathlib import Path

# Ensure utf-8 output in Windows terminal
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

API_BASE = os.environ.get("OMNIVOICE_API_URL", "http://127.0.0.1:8000")


def http_post(endpoint: str, data: dict) -> dict:
    url = f"{API_BASE}{endpoint}"
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_get(endpoint: str) -> dict:
    url = f"{API_BASE}{endpoint}"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description="Process long text to voiceover with smart chunking and auto-merge.")
    parser.add_argument("--file", "-f", type=str, default="transcript.txt", help="Path to input text file (default: transcript.txt)")
    parser.add_argument("--voice", "-v", type=str, default="de18060d", help="Voice ID (default: de18060d)")
    parser.add_argument("--target-chars", "-c", type=int, default=1000, help="Target characters per chunk (default: 1000)")
    parser.add_argument("--gap", "-g", type=float, default=0.8, help="Silence gap between chunks in seconds (default: 0.8)")
    parser.add_argument("--speed", "-s", type=float, default=1.0, help="Playback speed (default: 1.0)")
    parser.add_argument("--output", "-o", type=str, default="merged_transcript.wav", help="Merged output filename")
    parser.add_argument("--instruct", "-i", type=str, default=None, help="Optional voice style/emotion instruction")
    args = parser.parse_args()

    input_path = Path(args.file)
    if not input_path.exists():
        print(f"❌ File not found: {input_path}")
        sys.exit(1)

    print(f"📖 Reading '{input_path}'...")
    raw_text = input_path.read_text(encoding="utf-8").strip()
    total_raw_len = len(raw_text)
    print(f"📝 Total length: {total_raw_len:,} characters")

    # Step 1: Request smart chunking from API
    print(f"\n✂️  Splitting into coherent paragraphs (~{args.target_chars} chars, ending strictly on full sentences)...")
    try:
        split_res = http_post("/api/tools/split-text", {
            "text": raw_text,
            "target_chars": args.target_chars,
        })
    except Exception as e:
        print(f"❌ Failed to communicate with OmniVoice API at {API_BASE}: {e}")
        print("Vui lòng đảm bảo server backend đang chạy (run_studio.bat hoặc run_backend.bat).")
        sys.exit(1)

    chunks = split_res.get("chunks", [])
    if not chunks:
        print("❌ No chunks returned from splitter.")
        sys.exit(1)

    print(f"✅ Created {len(chunks)} chunks:")
    for idx, c in enumerate(chunks):
        end_mark = c[-25:] if len(c) > 25 else c
        print(f"   [{idx+1:02d}/{len(chunks):02d}] {len(c):4d} chars | ...\"{end_mark}\"")

    # Step 2: Enqueue batch tasks with auto_merge enabled
    print(f"\n🚀 Submitting {len(chunks)} chunks to SQLite task queue (Voice: {args.voice}, Auto-Merge Gap: {args.gap}s)...")
    items = [{"text": c} for c in chunks]
    batch_payload = {
        "items": items,
        "common_type": "clone",
        "common_voice_id": args.voice,
        "common_instruct": args.instruct,
        "common_params": {
            "speed": args.speed,
            "auto_merge": True,
            "gap_sec": args.gap,
        },
        "auto_merge": True,
        "gap_sec": args.gap,
    }

    try:
        batch_res = http_post("/api/tasks/batch", batch_payload)
    except Exception as e:
        print(f"❌ Failed to submit batch to API: {e}")
        sys.exit(1)

    batch_id = batch_res.get("batch_id")
    created_tasks = batch_res.get("tasks", [])
    print(f"✅ Batch #{batch_id} created with {len(created_tasks)} tasks in queue!")

    # Step 3: Monitor progress until all chunks are finished
    print("\n⏳ Processing chunks on GPU (queue worker is generating audio sequentially)...")
    task_ids = [t["id"] for t in created_tasks]
    start_time = time.time()
    
    last_completed = 0
    while True:
        try:
            # Poll task status
            tasks_info = []
            for tid in task_ids:
                t = http_get(f"/api/tasks/{tid}")
                tasks_info.append(t)
            
            completed = sum(1 for t in tasks_info if t.get("status") == "completed")
            failed = sum(1 for t in tasks_info if t.get("status") == "failed")
            processing = sum(1 for t in tasks_info if t.get("status") == "processing")
            pending = sum(1 for t in tasks_info if t.get("status") == "pending")

            if completed != last_completed or processing > 0:
                percent = (completed / len(task_ids)) * 100
                elapsed = time.time() - start_time
                print(f"   ⚡ Progress: {completed}/{len(task_ids)} completed ({percent:.1f}%) | {processing} processing | {pending} pending | {failed} failed | Elapsed: {elapsed:.0f}s")
                last_completed = completed

            if completed + failed == len(task_ids):
                break

            time.sleep(3.0)
        except KeyboardInterrupt:
            print("\n⚠️ Interrupted by user. Tasks remain in queue history.")
            return
        except Exception as e:
            print(f"⚠️ Polling warning: {e}")
            time.sleep(3.0)

    total_elapsed = time.time() - start_time
    print(f"\n🎉 All {len(task_ids)} tasks completed in {total_elapsed:.1f}s!")

    # Step 4: Verify or perform audio merge
    print(f"\n🔗 Merging all audio files with {args.gap}s silence gap...")
    merge_payload = {
        "task_ids": task_ids,
        "gap_sec": args.gap,
        "output_filename": args.output,
    }

    try:
        merge_res = http_post("/api/tasks/merge", merge_payload)
        output_filename = merge_res.get("filename")
        duration_sec = merge_res.get("duration_sec")
        audio_url = merge_res.get("audio_url")

        print("=" * 60)
        print("🏆 HOÀN THÀNH XỬ LÝ & GỘP FILE THÀNH CÔNG!")
        print(f"📁 Tên file:     outputs/{output_filename}")
        print(f"⏱️ Tổng thời lượng: {duration_sec:.2f} giây ({duration_sec/60:.2f} phút)")
        print(f"⏸️ Khoảng nghỉ gap: {args.gap} giây giữa mỗi đoạn")
        print(f"🔗 Link Audio:   {API_BASE}{audio_url}")
        print("=" * 60)
    except Exception as e:
        print(f"⚠️ Merge via API error: {e}")


if __name__ == "__main__":
    main()
