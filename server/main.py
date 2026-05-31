import os
import re
import time
import boto3
from botocore.exceptions import ClientError
from botocore.config import Config
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

app = FastAPI(title="Polly TTS API")

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
polly = boto3.client("polly", config=_boto_cfg)
s3 = boto3.client("s3", config=_boto_cfg)


class SynthRequest(BaseModel):
    text: str
    textType: str = "text"
    voiceId: str = "Seoyeon"
    engine: str = "neural"
    format: str = "mp3"


def _content_type(fmt: str) -> str:
    return {
        "mp3": "audio/mpeg",
        "ogg_vorbis": "audio/ogg",
    }.get(fmt, "application/octet-stream")


def _synthesize(text: str, text_type: str, voice_id: str, engine: str, fmt: str):
    return polly.synthesize_speech(
        Text=text,
        TextType=text_type,
        VoiceId=voice_id,
        OutputFormat=fmt,
        Engine=engine,
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/synthesize")
async def synthesize(req: SynthRequest):
    text = req.text.strip()
    if not text:
        return JSONResponse(status_code=400, content={"error": "text가 필요합니다."})

    if not BUCKET:
        return JSONResponse(status_code=500, content={"error": "POLLY_S3_BUCKET 환경변수가 설정되지 않았습니다."})

    engine = req.engine
    try:
        res = _synthesize(text, req.textType, req.voiceId, engine, req.format)
    except ClientError as e:
        code = e.response["Error"]["Code"]
        msg = e.response["Error"]["Message"]
        # neural 미지원 voice에서 standard 폴백
        if code == "ValidationException" and "does not support the selected engine" in msg and engine == "standard":
            engine = "neural"
            try:
                res = _synthesize(text, req.textType, req.voiceId, engine, req.format)
            except ClientError as e2:
                return JSONResponse(status_code=400, content={"error": e2.response["Error"]["Message"]})
        else:
            status = 400 if code == "ValidationException" else 500
            return JSONResponse(status_code=status, content={"error": msg})

    audio_data = res["AudioStream"].read()

    ext = "ogg" if req.format == "ogg_vorbis" else req.format
    safe_voice = re.sub(r"[^a-zA-Z0-9_-]", "", req.voiceId)
    key = f"{PREFIX}{int(time.time() * 1000)}-{safe_voice}.{ext}"
    content_type = _content_type(req.format)

    s3.put_object(Bucket=BUCKET, Key=key, Body=audio_data, ContentType=content_type)

    expires_in = 3600
    audio_url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=expires_in,
    )

    return {
        "savedToS3": True,
        "s3Bucket": BUCKET,
        "s3Key": key,
        "contentType": content_type,
        "engine": engine,
        "audioUrl": audio_url,
        "expiresIn": expires_in,
    }
