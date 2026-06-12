_AVAILABLE = False
_REASON = ""

try:
    import ChatTTS as _chattts_mod  # noqa: F401
    _AVAILABLE = True
except ImportError as _e:
    _REASON = str(_e)

INFO = {
    "id": "chattts",
    "name": "ChatTTS",
    "available": _AVAILABLE,
    "unavailable_reason": _REASON,
    "description": "대화형 최적화 TTS. 자연스러운 쉬어가기·추임새 표현. 한국어·영어 지원.",
    "note": "첫 실행 시 모델 다운로드 (~2 GB). 화자 시드를 바꾸면 다른 목소리로 생성됩니다.",
    "speakers": [
        {"id": "0", "name": "화자 A (시드 0)"},
        {"id": "2", "name": "화자 B (시드 2)"},
        {"id": "5", "name": "화자 C (시드 5)"},
        {"id": "42", "name": "화자 D (시드 42)"},
        {"id": "100", "name": "화자 E (시드 100)"},
    ],
    "languages": ["ko", "en", "zh"],
    "format": "wav",
    "supports_ssml": False,
}

_chat = None


def _load():
    global _chat
    if _chat is None:
        import ChatTTS  # type: ignore
        _chat = ChatTTS.Chat()
        _chat.load()
    return _chat


def synthesize(text: str, speaker: str = "0", **_) -> tuple[bytes, str, str]:
    if not _AVAILABLE:
        raise RuntimeError(
            f"ChatTTS가 설치되어 있지 않습니다. 설치: pip install chattts\n세부: {_REASON}"
        )

    import io
    import numpy as np
    import scipy.io.wavfile as wavfile
    import torch

    chat = _load()

    seed = int(speaker) if str(speaker).lstrip("-").isdigit() else 0
    torch.manual_seed(seed)

    wavs = chat.infer([text], use_decoder=True)
    audio_arr = wavs[0]

    if isinstance(audio_arr, torch.Tensor):
        audio_arr = audio_arr.cpu().numpy()

    audio_arr = np.array(audio_arr, dtype=np.float32)
    audio_i16 = np.clip(audio_arr, -1.0, 1.0)
    audio_i16 = (audio_i16 * 32767).astype(np.int16)

    buf = io.BytesIO()
    wavfile.write(buf, 24000, audio_i16)
    return buf.getvalue(), "audio/wav", "wav"
