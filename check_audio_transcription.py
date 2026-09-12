import sys
import whisperx

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

model = whisperx.load_model("base", device="cpu", compute_type="float32")
res = model.transcribe("outputs/out_clone_80bd675d70.wav", language="vi")
for seg in res["segments"]:
    print(f"{seg['start']:.2f} -> {seg['end']:.2f}: {seg['text']}")
