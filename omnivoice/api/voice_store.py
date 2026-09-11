import os
import json
import uuid
import time
import shutil
from typing import List, Dict, Optional, Any
from pathlib import Path

VOICES_DIR = Path("voices")
METADATA_FILE = VOICES_DIR / "metadata.json"


class VoiceStore:
    def __init__(self, storage_dir: Optional[Path] = None):
        self.storage_dir = storage_dir or VOICES_DIR
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.metadata_file = self.storage_dir / "metadata.json"
        self._ensure_metadata_file()

    def _ensure_metadata_file(self):
        if not self.metadata_file.exists():
            with open(self.metadata_file, "w", encoding="utf-8") as f:
                json.dump([], f, ensure_ascii=False, indent=2)

    def list_voices(self) -> List[Dict[str, Any]]:
        try:
            with open(self.metadata_file, "r", encoding="utf-8") as f:
                voices = json.load(f)
                # Verify audio files exist
                for v in voices:
                    audio_path = self.storage_dir / v.get("audio_filename", "")
                    v["has_audio"] = audio_path.exists()
                    v["audio_url"] = f"/api/audio/voice_{v['id']}"
                return voices
        except Exception as e:
            print(f"Error reading voices metadata: {e}")
            return []

    def get_voice(self, voice_id: str) -> Optional[Dict[str, Any]]:
        voices = self.list_voices()
        for v in voices:
            if v["id"] == voice_id:
                return v
        return None

    def add_voice(
        self,
        name: str,
        audio_data: bytes,
        filename: str,
        gender: str = "Unspecified",
        language: str = "Auto",
        description: str = "",
        ref_text: Optional[str] = None,
        model=None,
    ) -> Dict[str, Any]:
        voice_id = str(uuid.uuid4())[:8]
        ext = Path(filename).suffix.lower() or ".mp3"
        stored_audio_name = f"{voice_id}{ext}"
        audio_path = self.storage_dir / stored_audio_name

        with open(audio_path, "wb") as f:
            f.write(audio_data)

        prompt_filename = f"{voice_id}.pt"
        prompt_path = self.storage_dir / prompt_filename

        # If model is available, pre-compute and cache the VoiceClonePrompt
        has_prompt = False
        if model is not None:
            try:
                prompt = model.create_voice_clone_prompt(
                    ref_audio=str(audio_path),
                    ref_text=ref_text if ref_text else None,
                )
                prompt.save(str(prompt_path))
                has_prompt = True
            except Exception as e:
                print(f"Failed to pre-compute voice clone prompt: {e}")

        new_voice = {
            "id": voice_id,
            "name": name,
            "description": description,
            "gender": gender,
            "language": language,
            "audio_filename": stored_audio_name,
            "prompt_filename": prompt_filename if has_prompt else None,
            "ref_text": ref_text or "",
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }

        voices = self.list_voices()
        # Clean out temporary computed properties before writing
        for v in voices:
            v.pop("has_audio", None)
            v.pop("audio_url", None)

        voices.insert(0, new_voice)

        with open(self.metadata_file, "w", encoding="utf-8") as f:
            json.dump(voices, f, ensure_ascii=False, indent=2)

        new_voice["audio_url"] = f"/api/audio/voice_{new_voice['id']}"
        new_voice["has_audio"] = True
        return new_voice

    def delete_voice(self, voice_id: str) -> bool:
        voices = self.list_voices()
        voice_to_delete = None
        remaining = []

        for v in voices:
            if v["id"] == voice_id:
                voice_to_delete = v
            else:
                v.pop("has_audio", None)
                v.pop("audio_url", None)
                remaining.append(v)

        if not voice_to_delete:
            return False

        # Remove audio and prompt files
        audio_name = voice_to_delete.get("audio_filename")
        if audio_name:
            audio_file = self.storage_dir / audio_name
            if audio_file.exists():
                audio_file.unlink(missing_ok=True)

        prompt_name = voice_to_delete.get("prompt_filename")
        if prompt_name:
            prompt_file = self.storage_dir / prompt_name
            if prompt_file.exists():
                prompt_file.unlink(missing_ok=True)

        with open(self.metadata_file, "w", encoding="utf-8") as f:
            json.dump(remaining, f, ensure_ascii=False, indent=2)

        return True

    def get_prompt_or_audio(self, voice_id: str, model=None):
        """Returns (prompt, audio_path, ref_text)"""
        voice = self.get_voice(voice_id)
        if not voice:
            raise ValueError(f"Voice {voice_id} not found")

        prompt_name = voice.get("prompt_filename")
        if prompt_name:
            prompt_path = self.storage_dir / prompt_name
            if prompt_path.exists():
                try:
                    from omnivoice import VoiceClonePrompt

                    prompt = VoiceClonePrompt.load(str(prompt_path))
                    return prompt, None, voice.get("ref_text")
                except Exception as e:
                    print(f"Failed to load cached prompt {prompt_path}: {e}")

        # Fallback to audio path
        audio_path = self.storage_dir / voice.get("audio_filename", "")
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file for voice {voice_id} not found")

        # If model is provided, create and save prompt now
        if model is not None:
            try:
                from omnivoice import VoiceClonePrompt

                prompt = model.create_voice_clone_prompt(
                    ref_audio=str(audio_path),
                    ref_text=voice.get("ref_text") or None,
                )
                prompt_file = self.storage_dir / f"{voice_id}.pt"
                prompt.save(str(prompt_file))
                # Update metadata
                self._update_prompt_file(voice_id, f"{voice_id}.pt")
                return prompt, None, voice.get("ref_text")
            except Exception as e:
                print(f"Could not build prompt on the fly: {e}")

        return None, str(audio_path), voice.get("ref_text")

    def _update_prompt_file(self, voice_id: str, prompt_filename: str):
        voices = self.list_voices()
        for v in voices:
            v.pop("has_audio", None)
            v.pop("audio_url", None)
            if v["id"] == voice_id:
                v["prompt_filename"] = prompt_filename

        with open(self.metadata_file, "w", encoding="utf-8") as f:
            json.dump(voices, f, ensure_ascii=False, indent=2)
