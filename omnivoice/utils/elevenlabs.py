"""ElevenLabs Voice Link Scraper & Audio Importer.

Allows extracting voice metadata (name, description, gender, language, ref transcript)
and downloading high-fidelity sample audio directly from public ElevenLabs voice links.
"""

import re
import json
import logging
import urllib.request
import urllib.parse
from typing import Dict, Any, Optional

logger = logging.getLogger("omnivoice.elevenlabs")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
}


def extract_voice_id_from_url(url_or_id: str) -> str:
    """Extracts ElevenLabs voice ID from various URL formats or raw ID."""
    cleaned = (url_or_id or "").strip()
    if not cleaned:
        raise ValueError("URL hoặc Voice ID không được để trống.")

    # Direct ID check (e.g. xAVsdcJvD1uegu8lFEE2, usually 15-25 alphanumeric chars)
    if re.match(r"^[a-zA-Z0-9_-]{15,30}$", cleaned):
        return cleaned

    # Query param ?voiceId=...
    try:
        parsed = urllib.parse.urlparse(cleaned)
        qs = urllib.parse.parse_qs(parsed.query)
        if "voiceId" in qs and qs["voiceId"]:
            return qs["voiceId"][0]

        # Path match /voices/{voice_id}
        m = re.search(r"/voices/([a-zA-Z0-9_-]+)", parsed.path)
        if m:
            return m.group(1)
    except Exception as e:
        logger.warning(f"Error parsing URL {cleaned}: {e}")

    # Fallback regex in entire string
    m = re.search(r"[a-zA-Z0-9_-]{20}", cleaned)
    if m:
        return m.group(0)

    raise ValueError(f"Không thể tìm thấy Voice ID hợp lệ trong: '{url_or_id}'")


def fetch_elevenlabs_voice_info(voice_url_or_id: str, timeout: float = 15.0) -> Dict[str, Any]:
    """Fetches public voice metadata and preview audio URL from ElevenLabs.

    Returns:
        Dict with keys: voice_id, name, description, gender, language,
        preview_url, ref_text, source_url
    """
    voice_id = extract_voice_id_from_url(voice_url_or_id)
    target_url = f"https://elevenlabs.io/voices/{voice_id}"

    req = urllib.request.Request(target_url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
    except Exception as e:
        logger.error(f"Failed to fetch ElevenLabs page for voice {voice_id}: {e}")
        raise RuntimeError(f"Không thể kết nối tới ElevenLabs (Voice ID: {voice_id}): {e}")

    # 1. Search for sample audio preview URLs
    storage_urls = re.findall(
        r"https://storage\.googleapis\.com/eleven-public-prod/[^\"\'\s\\]+", html
    )
    preview_url: Optional[str] = None
    for u in storage_urls:
        if voice_id in u and u.endswith(".mp3"):
            if "custom/voices" in u:
                preview_url = u
                break
            if not preview_url:
                preview_url = u

    if not preview_url and storage_urls:
        # Fallback to any mp3 in list
        for u in storage_urls:
            if u.endswith(".mp3"):
                preview_url = u
                break

    # Defaults
    name = "ElevenLabs Voice"
    description = ""
    gender = "Unspecified"
    language = "Auto"
    ref_text = ""

    # 2. Parse Next.js App Router RSC chunks
    chunks = re.findall(r'self\.__next_f\.push\(\[1,\s*"(.*?)"\]\)', html)
    full_rsc = "".join(chunks) if chunks else html
    unescaped = full_rsc.replace('\\"', '"').replace("\\\\", "\\")

    # Title props extraction
    title_props_match = re.search(r'"titleProps":\s*({.+?}),"ttsOmnibox"', unescaped)
    if title_props_match:
        try:
            tp = json.loads(title_props_match.group(1))
            name = tp.get("name") or name
            raw_desc = tp.get("description") or tp.get("shortDescription") or description
            category = tp.get("category", {}).get("label")
            if category and not raw_desc.startswith(f"[{category}]"):
                description = f"[{category}] {raw_desc}"
            else:
                description = raw_desc

            languages = tp.get("languages", [])
            if languages and isinstance(languages, list):
                first_lang = languages[0].get("label")
                if first_lang:
                    language = first_lang
        except Exception as e:
            logger.debug(f"titleProps parse error: {e}")

    # Fallbacks for name
    if name == "ElevenLabs Voice":
        nm = re.search(r'"name":"([^"]+)"', unescaped)
        if nm:
            name = nm.group(1)

    # NOTE: ElevenLabs 'initialText' is only placeholder text for their demo playground
    # (e.g. the Zephyros dragon story) and DOES NOT match the spoken content of preview_url.
    # Leave ref_text empty so the system automatically and accurately transcribes the downloaded
    # preview audio using Whisper ASR.
    ref_text = ""

    # Gender inference from description
    desc_lower = description.lower()
    if any(k in desc_lower for k in ("female", "woman", "girl", "nữ")):
        gender = "Female"
    elif any(k in desc_lower for k in ("male", "man", "boy", "nam")):
        gender = "Male"

    # OG tag fallback
    if name == "ElevenLabs Voice":
        og_title = re.search(r'<meta\s+property="og:title"\s+content="([^"]+)"', html)
        if og_title:
            t = (
                og_title.group(1)
                .replace(" AI Entertainment Voice", "")
                .replace(" AI Voice", "")
                .strip()
            )
            if t:
                name = t

    if not description:
        og_desc = re.search(r'<meta\s+property="og:description"\s+content="([^"]+)"', html)
        if og_desc:
            description = og_desc.group(1).strip()
            if gender == "Unspecified":
                if "female" in description.lower():
                    gender = "Female"
                elif "male" in description.lower():
                    gender = "Male"

    if not preview_url:
        raise ValueError(
            f"Không tìm thấy file audio mẫu (preview URL) cho giọng {voice_id} trên ElevenLabs."
        )

    # 3. Extract multilingual preview alternatives
    lang_name_map = {
        "pl": "Ba Lan (Polish)",
        "en": "Tiếng Anh (English)",
        "vi": "Tiếng Việt (Vietnamese)",
        "fr": "Tiếng Pháp (French)",
        "de": "Tiếng Đức (German)",
        "es": "Tây Ban Nha (Spanish)",
        "it": "Tiếng Ý (Italian)",
        "pt": "Bồ Đào Nha (Portuguese)",
        "ru": "Tiếng Nga (Russian)",
        "ko": "Tiếng Hàn (Korean)",
        "ja": "Tiếng Nhật (Japanese)",
        "zh": "Tiếng Trung (Chinese)",
        "hi": "Tiếng Hindi (Hindi)",
        "id": "Indonesia (Indonesian)",
        "tr": "Thổ Nhĩ Kỳ (Turkish)",
        "ar": "Tiếng Ả Rập (Arabic)",
        "th": "Tiếng Thái (Thai)",
        "nl": "Hà Lan (Dutch)",
        "sv": "Thụy Điển (Swedish)",
        "el": "Hy Lạp (Greek)",
        "cs": "Tiếng Séc (Czech)",
        "ro": "Romania (Romanian)",
        "no": "Na Uy (Norwegian)",
        "hr": "Croatia (Croatian)",
        "hu": "Hungary (Hungarian)",
        "ta": "Tamil (Tamil)",
    }

    available_languages = []
    lang_matches = re.findall(
        r'\{"language":"([a-zA-Z_-]{2,10})","previewUrl":"(https://[^"]+)"\}', unescaped
    )
    seen_langs = set()
    for code, p_url in lang_matches:
        code_clean = code.lower()
        if code_clean not in seen_langs:
            seen_langs.add(code_clean)
            available_languages.append({
                "code": code_clean,
                "label": lang_name_map.get(code_clean, code.upper()),
                "preview_url": p_url,
            })

    return {
        "voice_id": voice_id,
        "name": name,
        "description": description,
        "gender": gender,
        "language": language,
        "preview_url": preview_url,
        "ref_text": ref_text,
        "source_url": target_url,
        "available_languages": available_languages,
    }


def download_elevenlabs_audio(preview_url: str, timeout: float = 30.0) -> bytes:
    """Downloads audio bytes from ElevenLabs preview URL."""
    req = urllib.request.Request(preview_url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            if len(data) < 1024:
                raise ValueError("File audio tải về quá nhỏ hoặc không hợp lệ.")
            return data
    except Exception as e:
        logger.error(f"Failed to download audio from {preview_url}: {e}")
        raise RuntimeError(f"Lỗi khi tải audio từ ElevenLabs: {e}")
