import os
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

REGION = os.getenv("AWS_REGION", "ap-northeast-2")

INFO = {
    "id": "polly",
    "name": "AWS Polly",
    "available": True,
    "unavailable_reason": "",
    "description": "Amazon 관리형 신경망 TTS. 고품질·저지연. S3 저장 포함.",
    "note": "",
    "speakers": [
        {"id": "Seoyeon", "name": "서연 (한국어)"},
        {"id": "Jihye", "name": "지혜 (한국어)"},
        {"id": "Matthew", "name": "Matthew (EN)"},
        {"id": "Joanna", "name": "Joanna (EN)"},
        {"id": "Aria", "name": "Aria (EN)"},
    ],
    "polly_engines": ["standard", "neural", "generative", "long-form"],
    "languages": ["ko", "en"],
    "format": "mp3",
    "supports_ssml": True,
}

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = boto3.client("polly", config=Config(region_name=REGION))
    return _client


def synthesize(
    text: str,
    voice_id: str = "Seoyeon",
    engine: str = "neural",
    text_type: str = "text",
    fmt: str = "mp3",
    **_,
) -> tuple[bytes, str, str]:
    client = _get_client()

    def _call(eng: str):
        return client.synthesize_speech(
            Text=text,
            TextType=text_type,
            VoiceId=voice_id,
            OutputFormat=fmt,
            Engine=eng,
        )

    try:
        res = _call(engine)
    except ClientError as e:
        code = e.response["Error"]["Code"]
        msg = e.response["Error"]["Message"]
        if code == "ValidationException" and "does not support" in msg and engine != "standard":
            try:
                res = _call("standard")
            except ClientError as e2:
                raise RuntimeError(e2.response["Error"]["Message"]) from e2
        else:
            status_msg = msg if code == "ValidationException" else f"[{code}] {msg}"
            raise RuntimeError(status_msg)

    audio = res["AudioStream"].read()
    content_type = "audio/mpeg" if fmt == "mp3" else "audio/ogg"
    ext = "ogg" if fmt == "ogg_vorbis" else fmt
    return audio, content_type, ext
