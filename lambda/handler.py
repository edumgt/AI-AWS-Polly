import json
import os
import re
import time
import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
BUCKET = os.environ.get("POLLY_S3_BUCKET", "")
PREFIX = os.environ.get("POLLY_S3_PREFIX", "polly-lab/")

polly = boto3.client("polly", region_name=REGION)
s3 = boto3.client("s3", region_name=REGION)


def _cors_headers():
    return {"Content-Type": "application/json"}


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": _cors_headers(),
        "body": json.dumps(body, ensure_ascii=False),
    }


def _content_type(fmt):
    return {"mp3": "audio/mpeg", "ogg_vorbis": "audio/ogg"}.get(fmt, "application/octet-stream")


def _synthesize(text, text_type, voice_id, engine, fmt):
    return polly.synthesize_speech(
        Text=text,
        TextType=text_type,
        VoiceId=voice_id,
        OutputFormat=fmt,
        Engine=engine,
    )


def lambda_handler(event, context):
    method = (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod", "")
    )

    if method == "OPTIONS":
        return {"statusCode": 204, "headers": _cors_headers(), "body": ""}

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"error": "요청 body가 유효한 JSON이 아닙니다."})

    text = str(body.get("text", "")).strip()
    text_type = body.get("textType", "text")
    voice_id = body.get("voiceId", "Seoyeon")
    engine = body.get("engine", "neural")
    fmt = body.get("format", "mp3")

    if not text:
        return _response(400, {"error": "text가 필요합니다."})

    if not BUCKET:
        return _response(500, {"error": "POLLY_S3_BUCKET 환경변수가 설정되지 않았습니다."})

    try:
        res = _synthesize(text, text_type, voice_id, engine, fmt)
    except ClientError as e:
        code = e.response["Error"]["Code"]
        msg = e.response["Error"]["Message"]
        if code == "ValidationException" and "does not support the selected engine" in msg and engine == "standard":
            engine = "neural"
            try:
                res = _synthesize(text, text_type, voice_id, engine, fmt)
            except ClientError as e2:
                return _response(400, {"error": e2.response["Error"]["Message"]})
        else:
            status = 400 if code == "ValidationException" else 500
            return _response(status, {"error": msg})

    audio_data = res["AudioStream"].read()

    ext = "ogg" if fmt == "ogg_vorbis" else fmt
    safe_voice = re.sub(r"[^a-zA-Z0-9_-]", "", voice_id)
    key = f"{PREFIX}{int(time.time() * 1000)}-{safe_voice}.{ext}"
    content_type = _content_type(fmt)

    s3.put_object(Bucket=BUCKET, Key=key, Body=audio_data, ContentType=content_type)

    expires_in = 3600
    audio_url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=expires_in,
    )

    return _response(200, {
        "savedToS3": True,
        "s3Bucket": BUCKET,
        "s3Key": key,
        "contentType": content_type,
        "engine": engine,
        "audioUrl": audio_url,
        "expiresIn": expires_in,
    })
