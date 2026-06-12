_AVAILABLE = False
_REASON = ""

try:
    from TTS.api import TTS as _TTS  # noqa: F401
    _AVAILABLE = True
except ImportError as _e:
    _REASON = str(_e)

INFO = {
    "id": "vits",
    "name": "VITS (Korean CSS10)",
    "available": _AVAILABLE,
    "unavailable_reason": _REASON,
    "description": "엔드투엔드 단일 네트워크 TTS. 빠른 합성 속도. CSS10 한국어 단일 화자 모델.",
    "note": "첫 실행 시 모델 다운로드 (~200 MB). CPU에서도 실시간 합성 가능.",
    "speakers": [{"id": "default", "name": "기본 화자 (한국어 여성)"}],
    "languages": ["ko"],
    "format": "wav",
    "supports_ssml": False,
}

_model = None


def _load():
    global _model
    if _model is None:
        from TTS.api import TTS  # type: ignore
        _model = TTS("tts_models/ko/css10/vits", gpu=False)
    return _model


def synthesize(text: str, **_) -> tuple[bytes, str, str]:
    if not _AVAILABLE:
        raise RuntimeError(
            f"Coqui TTS가 설치되어 있지 않습니다. 설치: pip install TTS\n세부: {_REASON}"
        )

    import os
    import tempfile

    model = _load()

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        out_path = f.name

    try:
        model.tts_to_file(text=text, file_path=out_path)
        with open(out_path, "rb") as fh:
            return fh.read(), "audio/wav", "wav"
    finally:
        if os.path.exists(out_path):
            os.unlink(out_path)
