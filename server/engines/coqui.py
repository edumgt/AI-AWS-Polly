_AVAILABLE = False
_REASON = ""

try:
    from TTS.api import TTS as _TTS  # noqa: F401
    _AVAILABLE = True
except ImportError as _e:
    _REASON = str(_e)

# XTTS v2 built-in speakers (subset; covers most use cases)
SPEAKERS = [
    "Claribel Dervla", "Daisy Studious", "Gracie Wise", "Tammie Ema",
    "Alison Dietlinde", "Ana Florence", "Annmarie Nele", "Asya Anara",
    "Andrew Chipper", "Badr Odhiambo", "Dionisio Schuyler", "Viktor Eka",
    "Abrahan Mack", "Craig Gutsy", "Damien Black", "Gilberto Mathias",
    "Royston Min", "Maja Ruoho", "Nova Hogarth", "Uta Obando",
]

INFO = {
    "id": "coqui",
    "name": "Coqui XTTS v2",
    "available": _AVAILABLE,
    "unavailable_reason": _REASON,
    "description": "단 3초 오디오로 음성 복제. 한국어 포함 17개 언어. Mozilla Public License.",
    "note": "첫 실행 시 모델 다운로드 (~2 GB). CPU에서도 동작하나 GPU 권장.",
    "speakers": [{"id": s, "name": s} for s in SPEAKERS],
    "languages": [
        "ko", "en", "zh-cn", "ja", "fr", "de", "es", "it",
        "pt", "ru", "pl", "nl", "tr", "cs", "ar", "hu", "hi",
    ],
    "format": "wav",
    "supports_ssml": False,
}

_model = None


def _load():
    global _model
    if _model is None:
        from TTS.api import TTS  # type: ignore
        _model = TTS("tts_models/multilingual/multi-dataset/xtts_v2", gpu=False)
    return _model


def synthesize(
    text: str,
    language: str = "ko",
    speaker: str = "Claribel Dervla",
    **_,
) -> tuple[bytes, str, str]:
    if not _AVAILABLE:
        raise RuntimeError(
            f"Coqui TTS가 설치되어 있지 않습니다. 설치: pip install TTS\n세부: {_REASON}"
        )

    import os
    import tempfile

    model = _load()
    spk = speaker if speaker in SPEAKERS else SPEAKERS[0]

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        out_path = f.name

    try:
        model.tts_to_file(
            text=text,
            file_path=out_path,
            language=language or "ko",
            speaker=spk,
        )
        with open(out_path, "rb") as fh:
            return fh.read(), "audio/wav", "wav"
    finally:
        if os.path.exists(out_path):
            os.unlink(out_path)
