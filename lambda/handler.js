const { PollyClient, SynthesizeSpeechCommand } = require("@aws-sdk/client-polly");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const region = "ap-northeast-2";
const bucket = "polly-bucket-edumgt";
const prefix = "polly-lab/";

const ALLOWED_ORIGIN =
  process.env.CORS_ALLOW_ORIGIN ||
  "http://polly-bucket-edumgt.s3-website.ap-northeast-2.amazonaws.com";

function normalizeOrigin(o = "") {
  // 혹시 모를 trailing slash 제거
  return String(o).replace(/\/$/, "");
}

function getCorsOrigin(event) {
  const reqOrigin =
    event?.headers?.origin ||
    event?.headers?.Origin ||
    "";

  if (normalizeOrigin(reqOrigin) === normalizeOrigin(ALLOWED_ORIGIN)) {
    return normalizeOrigin(ALLOWED_ORIGIN); // 반드시 정확히 origin 형태로
  }
  return ""; // 불일치면 CORS 헤더 미부여
}

function response(event, statusCode, payload, extraHeaders = {}) {
  const corsOrigin = getCorsOrigin(event);

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    ...extraHeaders
  };

  // 허용된 Origin일 때만 CORS 헤더 내려줌
  if (corsOrigin) {
    headers["Access-Control-Allow-Origin"] = corsOrigin;
    headers["Vary"] = "Origin"; // 캐시/프록시 안전
  }

  return {
    statusCode,
    headers,
    body: JSON.stringify(payload)
  };
}

const polly = new PollyClient({ region });
const s3 = new S3Client({ region });


exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod;

  // ✅ preflight 처리
  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600"
      },
      body: ""
    };
  }

  if (!region || !bucket) {
    return response(500, { error: "AWS_REGION 및 POLLY_S3_BUCKET 환경변수가 필요합니다." });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const {
      text,
      textType = "text",
      voiceId = "Seoyeon",
      engine = "standard",
      format = "mp3"
    } = body;

    if (!text || !String(text).trim()) {
      return response(400, { error: "text가 필요합니다." });
    }

    const pollyRes = await polly.send(new SynthesizeSpeechCommand({
      Text: text,
      TextType: textType,
      VoiceId: voiceId,
      OutputFormat: format,
      Engine: engine
    }));

    const chunks = [];
    for await (const chunk of pollyRes.AudioStream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const ext = format === "ogg_vorbis" ? "ogg" : format;
    const safeVoice = String(voiceId).replace(/[^a-zA-Z0-9_-]/g, "");
    const key = `${prefix}${Date.now()}-${safeVoice}.${ext}`;

    const contentType =
      format === "mp3" ? "audio/mpeg" :
      format === "ogg_vorbis" ? "audio/ogg" :
      "application/octet-stream";

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType
    }));

    const audioUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 3600 }
    );

    return response(200, {
      savedToS3: true,
      s3Bucket: bucket,
      s3Key: key,
      contentType,
      audioUrl,
      expiresIn: 3600
    });
  } catch (error) {
    console.error(error);
    return response(500, { error: error.message || "unknown error" });
  }
};
