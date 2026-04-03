const { PollyClient, SynthesizeSpeechCommand } = require("@aws-sdk/client-polly");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { corsResponse, handlePreflight } = require("./cors");

const region = "ap-northeast-2";
const bucket = "edumgt-20260402-14-test";
const prefix = "polly-lab/";

const polly = new PollyClient({ region });
const s3 = new S3Client({ region });

function isUnsupportedEngineError(error) {
  return (
    error?.name === "ValidationException" &&
    String(error?.message || "").includes("does not support the selected engine")
  );
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod;

  // ✅ Preflight
  if (method === "OPTIONS") {
    return handlePreflight(event);
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const {
      text,
      textType = "text",
      voiceId = "Seoyeon",
      engine = "neural",
      format = "mp3",
    } = body;

    if (!text || !String(text).trim()) {
      return corsResponse(event, 400, { error: "text가 필요합니다." });
    }

    let pollyRes;
    let resolvedEngine = engine;

    try {
      pollyRes = await polly.send(
        new SynthesizeSpeechCommand({
          Text: text,
          TextType: textType,
          VoiceId: voiceId,
          OutputFormat: format,
          Engine: resolvedEngine,
        })
      );
    } catch (error) {
      if (!isUnsupportedEngineError(error) || resolvedEngine !== "standard") {
        throw error;
      }

      resolvedEngine = "neural";
      pollyRes = await polly.send(
        new SynthesizeSpeechCommand({
          Text: text,
          TextType: textType,
          VoiceId: voiceId,
          OutputFormat: format,
          Engine: resolvedEngine,
        })
      );
    }

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

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );

    const audioUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 3600 }
    );

    return corsResponse(event, 200, {
      savedToS3: true,
      s3Bucket: bucket,
      s3Key: key,
      contentType,
      engine: resolvedEngine,
      audioUrl,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error(error);
    const statusCode = error?.name === "ValidationException" ? 400 : 500;
    return corsResponse(event, statusCode, { error: error.message || "unknown error" });
  }
};
