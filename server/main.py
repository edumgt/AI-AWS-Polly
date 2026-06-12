import os
import re
import time
import boto3
from botocore.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel

from engines import ENGINES

app = FastAPI(title="Multi-Engine TTS API")

CORS_ALLOW_ORIGIN = os.getenv("CORS_ALLOW_ORIGIN", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[CORS_ALLOW_ORIGIN] if CORS_ALLOW_ORIGIN != "*" else ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

REGION = os.getenv("AWS_REGION", "ap-northeast-2")
BUCKET = os.getenv("POLLY_S3_BUCKET", "")
PREFIX = os.getenv("POLLY_S3_PREFIX", "polly-lab/")
_boto_cfg = Config(region_name=REGION)

_TMP_DIR = "/tmp/tts-audio"


class SynthRequest(BaseModel):
    text: str
    provider: str = "polly"
    # AWS Polly specific
    voiceId: str = "Seoyeon"
    engine: str = "neural"
    textType: str = "text"
    format: str = "mp3"
    # Open-source engine params
    language: str = "ko"
    speaker: str = ""


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/engines")
def list_engines():
    return [entry["info"] for entry in ENGINES.values()]


@app.post("/synthesize")
async def synthesize(req: SynthRequest):
    text = req.text.strip()
    if not text:
        return JSONResponse(status_code=400, content={"error": "text가 필요합니다."})

    provider = req.provider
    if provider not in ENGINES:
        return JSONResponse(status_code=400, content={"error": f"알 수 없는 TTS 엔진: {provider}"})

    entry = ENGINES[provider]
    if not entry["info"]["available"]:
        reason = entry["info"].get("unavailable_reason", "")
        return JSONResponse(
            status_code=503,
            content={"error": f"'{entry['info']['name']}' 엔진을 사용할 수 없습니다.\n{reason}"},
        )

    kwargs: dict = {}
    if provider == "polly":
        kwargs = {
            "voice_id": req.voiceId,
            "engine": req.engine,
            "text_type": req.textType,
            "fmt": req.format,
        }
    else:
        kwargs = {
            "language": req.language,
            "speaker": req.speaker,
        }

    try:
        audio_bytes, content_type, ext = entry["fn"](text, **kwargs)
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})

    safe_provider = re.sub(r"[^a-zA-Z0-9_-]", "", provider)
    filename = f"{int(time.time() * 1000)}-{safe_provider}.{ext}"

    if BUCKET:
        s3 = boto3.client("s3", config=_boto_cfg)
        key = f"{PREFIX}{filename}"
        try:
            s3.put_object(Bucket=BUCKET, Key=key, Body=audio_bytes, ContentType=content_type)
        except Exception as exc:
            return JSONResponse(status_code=500, content={"error": f"S3 업로드 실패: {exc}"})

        audio_url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": BUCKET, "Key": key},
            ExpiresIn=3600,
        )
        return {
            "savedToS3": True,
            "s3Bucket": BUCKET,
            "s3Key": key,
            "contentType": content_type,
            "provider": provider,
            "engine": req.engine if provider == "polly" else provider,
            "voiceId": req.voiceId if provider == "polly" else req.speaker,
            "audioUrl": audio_url,
            "expiresIn": 3600,
        }
    else:
        # S3 미설정 시 로컬 임시 파일로 서빙
        os.makedirs(_TMP_DIR, exist_ok=True)
        out_path = os.path.join(_TMP_DIR, filename)
        with open(out_path, "wb") as fh:
            fh.write(audio_bytes)

        return {
            "savedToS3": False,
            "contentType": content_type,
            "provider": provider,
            "engine": req.engine if provider == "polly" else provider,
            "voiceId": req.voiceId if provider == "polly" else req.speaker,
            "audioUrl": f"/audio/{filename}",
            "expiresIn": 3600,
        }


@app.get("/audio/{filename}")
def serve_audio(filename: str):
    if not re.match(r"^[\w\-\.]+$", filename):
        return JSONResponse(status_code=400, content={"error": "잘못된 파일명"})

    path = os.path.join(_TMP_DIR, filename)
    if not os.path.exists(path):
        return JSONResponse(status_code=404, content={"error": "파일을 찾을 수 없습니다."})

    ext = filename.rsplit(".", 1)[-1].lower()
    media_type = {"mp3": "audio/mpeg", "wav": "audio/wav", "ogg": "audio/ogg"}.get(
        ext, "application/octet-stream"
    )
    return FileResponse(path, media_type=media_type)
