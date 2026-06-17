import base64
import json
import os
import re
import time

import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
BUCKET = os.environ.get("POLLY_S3_BUCKET", "")
PREFIX = os.environ.get("POLLY_S3_PREFIX", "polly-lab/")
CORS_ALLOW_ORIGIN = os.environ.get("CORS_ALLOW_ORIGIN", "*")

POLLY_INFO = {
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

polly = boto3.client("polly", region_name=REGION)
s3 = boto3.client("s3", region_name=REGION)


def _allowed_origins():
    if CORS_ALLOW_ORIGIN.strip() == "*":
        return ["*"]
    return [origin.strip() for origin in CORS_ALLOW_ORIGIN.split(",") if origin.strip()]


def _resolve_origin(event):
    origins = _allowed_origins()
    if origins == ["*"]:
        return "*"

    headers = event.get("headers") or {}
    request_origin = headers.get("origin") or headers.get("Origin")
    if request_origin and request_origin in origins:
        return request_origin

    return origins[0] if origins else "*"


def _cors_headers(event):
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": _resolve_origin(event),
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Expose-Headers": "Content-Type",
    }
    if headers["Access-Control-Allow-Origin"] != "*":
        headers["Vary"] = "Origin"
    return headers


def _response(event, status_code, body):
    return {
        "statusCode": status_code,
        "headers": _cors_headers(event),
        "body": json.dumps(body, ensure_ascii=False),
    }


def _empty_response(event, status_code=204):
    return {"statusCode": status_code, "headers": _cors_headers(event), "body": ""}


def _content_type(fmt):
    return {"mp3": "audio/mpeg", "ogg_vorbis": "audio/ogg"}.get(fmt, "application/octet-stream")


def _is_unsupported_engine_error(error):
    if error.response["Error"]["Code"] != "ValidationException":
        return False
    return "does not support the selected engine" in error.response["Error"]["Message"]


def _synthesize(text, text_type, voice_id, engine, fmt):
    resolved_engine = engine
    try:
        response = polly.synthesize_speech(
            Text=text,
            TextType=text_type,
            VoiceId=voice_id,
            OutputFormat=fmt,
            Engine=resolved_engine,
        )
    except ClientError as error:
        if resolved_engine != "standard" and _is_unsupported_engine_error(error):
            resolved_engine = "standard"
            response = polly.synthesize_speech(
                Text=text,
                TextType=text_type,
                VoiceId=voice_id,
                OutputFormat=fmt,
                Engine=resolved_engine,
            )
        else:
            raise
    return response, resolved_engine


def _request_method(event):
    return (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod", "")
        or "POST"
    ).upper()


def _request_path(event):
    raw_path = (
        event.get("rawPath")
        or event.get("requestContext", {}).get("http", {}).get("path")
        or event.get("path")
        or "/"
    )
    return raw_path.rstrip("/") or "/"


def _parse_body(event):
    raw_body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw_body = base64.b64decode(raw_body).decode("utf-8")
    if not raw_body:
        return {}
    return json.loads(raw_body)


def _handle_health(event):
    return _response(
        event,
        200,
        {
            "status": "ok",
            "service": "polly-lambda",
            "region": REGION,
            "bucketConfigured": bool(BUCKET),
        },
    )


def _handle_engines(event):
    return _response(event, 200, [POLLY_INFO])


def _handle_synthesize(event):
    try:
        body = _parse_body(event)
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        return _response(event, 400, {"error": "요청 body가 유효한 JSON이 아닙니다."})

    text = str(body.get("text", "")).strip()
    text_type = body.get("textType", "text")
    voice_id = body.get("voiceId", "Seoyeon")
    engine = body.get("engine", "neural")
    fmt = body.get("format", "mp3")

    if not text:
        return _response(event, 400, {"error": "text가 필요합니다."})

    if not BUCKET:
        return _response(event, 500, {"error": "POLLY_S3_BUCKET 환경변수가 설정되지 않았습니다."})

    try:
        res, resolved_engine = _synthesize(text, text_type, voice_id, engine, fmt)
    except ClientError as error:
        code = error.response["Error"]["Code"]
        message = error.response["Error"]["Message"]
        status = 400 if code == "ValidationException" else 500
        return _response(event, status, {"error": message})

    audio_data = res["AudioStream"].read()
    ext = "ogg" if fmt == "ogg_vorbis" else fmt
    safe_voice = re.sub(r"[^a-zA-Z0-9_-]", "", voice_id)
    key = f"{PREFIX}{int(time.time() * 1000)}-{safe_voice}.{ext}"
    content_type = _content_type(fmt)

    try:
        s3.put_object(Bucket=BUCKET, Key=key, Body=audio_data, ContentType=content_type)
        audio_url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": BUCKET, "Key": key},
            ExpiresIn=3600,
        )
    except ClientError as error:
        return _response(event, 500, {"error": error.response['Error']['Message']})

    return _response(
        event,
        200,
        {
            "savedToS3": True,
            "s3Bucket": BUCKET,
            "s3Key": key,
            "contentType": content_type,
            "provider": "polly",
            "engine": resolved_engine,
            "voiceId": voice_id,
            "audioUrl": audio_url,
            "expiresIn": 3600,
        },
    )


def lambda_handler(event, context):
    method = _request_method(event)
    path = _request_path(event)

    if method == "OPTIONS":
        return _empty_response(event)

    if method == "GET" and path in {"/", "/health"}:
        return _handle_health(event)

    if method == "GET" and path == "/engines":
        return _handle_engines(event)

    if method == "POST" and path in {"/", "/synthesize"}:
        return _handle_synthesize(event)

    return _response(event, 404, {"error": f"지원하지 않는 경로입니다: {method} {path}"})
