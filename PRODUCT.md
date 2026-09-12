# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Both creative practitioners (content creators, audio producers, game/media sound designers, voice directors) and technical users (AI researchers, developers, and power users). They need an intuitive, responsive creative studio workflow for crafting voice lines alongside fine-grained technical control over generation parameters, speech rate, diffusion sampling, and prompt engineering.

## Product Purpose

OmniVoice Studio provides a local, high-performance web workstation for zero-shot text-to-speech synthesis, bespoke voice design, and instant voice cloning powered by the OmniVoice diffusion language model. Success means generating natural, expressive, broadcast-grade speech in seconds, exploring and refining custom vocal identities without audio references, and managing speech generation tasks reliably on local hardware.

## Positioning

Unlike conventional TTS tools that rely solely on fixed speaker presets or reference audio cloning, OmniVoice Studio specializes in creative prompt-based Voice Design—allowing users to summon bespoke vocal personas and character voices simply by specifying descriptive attributes (gender, age, pitch, emotion, dialect, vocal texture, whisper) from scratch—backed by massive 600+ language support and ultra-low RTF (down to 0.025) inference.

## Operating Context

Local desktop workstation environment running on Windows (NVIDIA GPU / CUDA, Intel Arc XPU, or CPU) with a FastAPI backend on port 8000 and Next.js WebUI on port 3000. Workflow entails drafting and editing scripts, exploring voice attributes or uploading reference audio, previewing waveforms, tuning sampling parameters (temperature, steps, speed), queuing asynchronous generation jobs via an SQLite-backed queue, and reviewing/exporting generated audio files.

## Capabilities and Constraints

- **Capabilities**:
  - Voice Design: Prompt-based generation of custom vocal personas from natural language descriptors without reference audio.
  - Voice Cloning: High-fidelity zero-shot speaker cloning with 3–10s audio reference.
  - Multilingual Synthesis: Broad coverage across 600+ languages.
  - Task Queue & Batch History: Asynchronous background generation, status tracking, SQLite persistence, and batch export.
  - Persistent Audio Player Bar: Global audio playback, waveform seeking, and one-click download.
  - Local Voice Library: Preset and custom voice management with tag filtering and preview.
- **Constraints**:
  - Local hardware-dependent inference (VRAM constraints, PyTorch/CUDA/XPU dependencies).
  - Web UI communicates with a local FastAPI REST service (`http://127.0.0.1:8000`).
  - Audio formats restricted to standard WAV/FLAC/MP3 for reference inputs and outputs.

## Brand Commitments

- **Name**: OmniVoice Studio / OmniVoice 🌍
- **Visual Identity**: Modern, high-performance dark-mode studio workstation aesthetic with refined audio-workstation affordances.
- **Tone**: Professional, precise, capable, and empowering for creative audio production.

## Evidence on Hand

- Core OmniVoice model repository, arXiv paper (arXiv:2604.00688), demo page (`zhu-han.github.io/omnivoice`).
- Active Next.js 16 + React 19 + Tailwind CSS frontend in `web/`.
- FastAPI backend endpoints with SQLite task database (`omnivoice_tasks.db`).
- Existing functional components: `VoiceCloneStudio`, `VoiceDesignStudio`, `VoiceLibrary`, `TaskQueueHistory`, and `AudioPlayerBar`.

## Product Principles

1. **Immediate Creative Feedback**: Audio synthesis and preview controls must feel immediate, responsive, and tactile, minimizing latency between thought and hearing.
2. **Dual-Layer Simplicity and Depth**: Keep primary workflows (designing voices, cloning, generating) clean and accessible while exposing deep parameter controls (diffusion steps, temperature, seed, pitch) without clutter.
3. **Rock-Solid Local Reliability**: Asynchronous tasks, background worker states, and long-running batch jobs must always show accurate progress and preserve generated artifacts without loss.
4. **Authentic Vocal Nuance**: Prioritize fidelity, natural prosody, emotional inflection, and non-verbal nuances over sterile, robotic speech.
