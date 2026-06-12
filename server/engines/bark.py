_AVAILABLE = False
_REASON = ""

try:
    import bark as _bark_mod  # noqa: F401
    _AVAILABLE = True
except ImportError as _e:
    _REASON = str(_e)

INFO = {
    "id": "bark",
    "name": "Bark (Suno AI)",
    "available": _AVAILABLE,
    "unavailable_reason": _REASON,
    "description": "트랜스포머 기반 TTS. [웃음] [한숨] 등 비언어적 표현 텍스트 힌트 지원. MIT 라이선스.",
    "note": "첫 실행 시 모델 다운로드 (~5 GB). GPU 권장.",
    "speakers": (
        [{"id": f"v2/ko_speaker_{i}", "name": f"한국어 화자 {i}"} for i in range(9)]
        + [{"id": f"v2/en_speaker_{i}", "name": f"English Speaker {i}"} for i in range(9)]
        + [{"id": f"v2/ja_speaker_{i}", "name": f"Japanese Speaker {i}"} for i in range(4)]
        + [{"id": f"v2/zh_speaker_{i}", "name": f"Chinese Speaker {i}"} for i in range(9)]
    ),
    "languages": ["ko", "en", "ja", "zh", "de", "fr", "es", "hi"],
    "format": "wav",
    "supports_ssml": False,
}

_loaded = False


def _load():
    global _loaded
    if not _loaded:
        from bark import preload_models  # type: ignore
        preload_models()
        _loaded = True


def synthesize(text: str, speaker: str = "v2/ko_speaker_0", **_) -> tuple[bytes, str, str]:
    if not _AVAILABLE:
        raise RuntimeError(
            f"Bark가 설치되어 있지 않습니다. 설치: pip install suno-bark scipy\n세부: {_REASON}"
        )

    import io
    import numpy as np
    import scipy.io.wavfile as wavfile
    from bark import generate_audio, SAMPLE_RATE  # type: ignore

    _load()
    audio_array = generate_audio(text, history_prompt=speaker or "v2/ko_speaker_0")
    audio_f32 = np.array(audio_array, dtype=np.float32)

    buf = io.BytesIO()
    wavfile.write(buf, SAMPLE_RATE, audio_f32)
    return buf.getvalue(), "audio/wav", "wav"
