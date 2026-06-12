_AVAILABLE = False
_REASON = ""

try:
    from tortoise.api import TextToSpeech as _TortoiseTTS  # noqa: F401
    _AVAILABLE = True
except ImportError as _e:
    _REASON = str(_e)

VOICES = [
    "random", "angie", "deniro", "freeman", "halle", "lj",
    "snakes", "tim_reynolds", "tom", "train_atkins", "train_dotrice",
]

INFO = {
    "id": "tortoise",
    "name": "Tortoise TTS",
    "available": _AVAILABLE,
    "unavailable_reason": _REASON,
    "description": "제로샷 음성 복제 선구자. AWS Polly Neural급 고품질. 주로 영어.",
    "note": "매우 느림 (GPU 강력 권장). 첫 실행 시 모델 다운로드 (~4 GB).",
    "speakers": [{"id": v, "name": v.replace("_", " ").title()} for v in VOICES],
    "languages": ["en"],
    "format": "wav",
    "supports_ssml": False,
}

_tts = None


def _load():
    global _tts
    if _tts is None:
        from tortoise.api import TextToSpeech  # type: ignore
        _tts = TextToSpeech()
    return _tts


def synthesize(text: str, speaker: str = "random", **_) -> tuple[bytes, str, str]:
    if not _AVAILABLE:
        raise RuntimeError(
            f"Tortoise TTS가 설치되어 있지 않습니다. 설치: pip install tortoise-tts\n세부: {_REASON}"
        )

    import io
    import torchaudio
    from tortoise.utils.audio import load_voices  # type: ignore

    tts = _load()
    voice = speaker if speaker in VOICES else "random"

    voice_samples, conditioning_latents = load_voices([voice])
    gen = tts.tts_with_preset(
        text,
        voice_samples=voice_samples,
        conditioning_latents=conditioning_latents,
        preset="fast",
    )

    # gen may be (audio_tensor, latents) tuple or just tensor
    if isinstance(gen, tuple):
        gen = gen[0]

    buf = io.BytesIO()
    torchaudio.save(buf, gen.squeeze(0).cpu(), 24000, format="wav")
    return buf.getvalue(), "audio/wav", "wav"
