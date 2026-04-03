#!/usr/bin/env bash
set -euo pipefail

# 사용 예시
AWS_REGION=ap-northeast-2
LAMBDA_NAME=polly-tts-lambda
ROLE_NAME=polly-tts-lambda-role
POLLY_S3_BUCKET=edumgt-20260402-14-test
CORS_ALLOW_ORIGIN='*'



: "${AWS_REGION:?AWS_REGION is required}"
: "${LAMBDA_NAME:?LAMBDA_NAME is required}"
: "${ROLE_NAME:?ROLE_NAME is required}"
: "${POLLY_S3_BUCKET:?POLLY_S3_BUCKET is required}"

RUNTIME="${RUNTIME:-nodejs20.x}"
HANDLER="${HANDLER:-handler.handler}"
ZIP_FILE="${ZIP_FILE:-lambda.zip}"

CORS_ALLOW_ORIGIN="${CORS_ALLOW_ORIGIN:-*}"
POLLY_S3_PREFIX="${POLLY_S3_PREFIX:-polly-lab/}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
CALLER_ARN="$(aws sts get-caller-identity --query Arn --output text)"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

cleanup() {
  rm -f "./${ZIP_FILE}" /tmp/polly-inline-policy.json /tmp/polly-cors.json 2>/dev/null || true
}
trap cleanup EXIT

log() { echo "[$(date +'%H:%M:%S')] $*"; }

# ------------------------------------------------------------
# Lambda update 충돌 방지 유틸
# ------------------------------------------------------------
wait_lambda_updated() {
  local fn="$1"

  # waiter (있으면 빠르게 기다림)
  aws lambda wait function-updated --function-name "$fn" >/dev/null 2>&1 || true

  # 안정적으로 State/LastUpdateStatus 폴링
  while true; do
    local last state reason
    last="$(aws lambda get-function-configuration --function-name "$fn" --query 'LastUpdateStatus' --output text 2>/dev/null || echo "Unknown")"
    state="$(aws lambda get-function-configuration --function-name "$fn" --query 'State' --output text 2>/dev/null || echo "Unknown")"
    reason="$(aws lambda get-function-configuration --function-name "$fn" --query 'LastUpdateStatusReason' --output text 2>/dev/null || echo "")"

    if [[ "$last" == "Successful" && "$state" == "Active" ]]; then
      break
    fi
    if [[ "$last" == "Failed" ]]; then
      echo "  ! Lambda last update FAILED: $reason" >&2
      return 1
    fi
    log "  - waiting... LastUpdateStatus=$last State=$state"
    sleep 2
  done
}

retry_on_conflict() {
  local max="${RETRY_MAX:-12}"
  local n=1
  while true; do
    set +e
    local out
    out="$("$@" 2>&1)"
    local rc=$?
    set -e
    if [[ $rc -eq 0 ]]; then
      return 0
    fi

    if echo "$out" | grep -q "ResourceConflictException"; then
      if [[ $n -ge $max ]]; then
        echo "$out" >&2
        echo "  ! failed after $max attempts: $*" >&2
        return $rc
      fi
      log "  - conflict(ResourceConflictException), retrying ($n/$max) ..."
      sleep 2
      n=$((n+1))
      continue
    fi

    # 그 외 에러는 그대로 출력 후 종료
    echo "$out" >&2
    return $rc
  done
}

# ------------------------------------------------------------
# S3 유틸 (버킷 존재/생성/권한/충돌 처리)
# ------------------------------------------------------------
ensure_bucket_exists_or_create() {
  local b="$1"

  # head-bucket: 0=접근가능(존재+권한), 403=있지만 권한/소유X, 404=없음
  set +e
  aws s3api head-bucket --bucket "$b" >/dev/null 2>&1
  local hb_rc=$?
  set -e

  if [[ $hb_rc -eq 0 ]]; then
    log "  - bucket exists & accessible: $b"
    return 0
  fi

  log "  - bucket not accessible or not exists: $b (head-bucket rc=$hb_rc)"
  log "  - trying to create bucket in region: $AWS_REGION"

  local create_out rc
  set +e
 
  create_out="$(aws s3api create-bucket --bucket "$b" --create-bucket-configuration "LocationConstraint=$AWS_REGION" 2>&1)"
  
  rc=$?
  set -e

  if [[ $rc -eq 0 ]]; then
    log "  - bucket created: $b"
    return 0
  fi

  # 이름 충돌(전세계 유일) 또는 접근불가면 자동으로 유니크 버킷명으로 재시도
  if echo "$create_out" | grep -Eq "BucketAlreadyExists|BucketAlreadyOwnedByYou|AccessDenied"; then
    # OwnedByYou인데도 create 실패면 이미 있음 → head-bucket 403일 수도 있으니 재확인
    set +e
    aws s3api head-bucket --bucket "$b" >/dev/null 2>&1
    local recheck_rc=$?
    set -e
    if [[ $recheck_rc -eq 0 ]]; then
      log "  - bucket exists after recheck: $b"
      return 0
    fi

    local alt="polly-${ACCOUNT_ID}-${AWS_REGION}-$(date +%Y%m%d%H%M%S)"
    log "  ! cannot create/use bucket '$b' (global conflict or no access)."
    log "  ! switching to a unique bucket name: $alt"
    POLLY_S3_BUCKET="$alt"

    # 실제 생성
   
    aws s3api create-bucket --bucket "$POLLY_S3_BUCKET" --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null

    log "  - bucket created: $POLLY_S3_BUCKET"
    return 0
  fi

  echo "$create_out" >&2
  return 1
}

put_bucket_cors_or_fail() {
  local b="$1"

  cat > /tmp/polly-cors.json <<CORS
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
      "AllowedOrigins": ["${CORS_ALLOW_ORIGIN}"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}
CORS

  set +e
  local out
  out="$(aws s3api put-bucket-cors --bucket "$b" --cors-configuration file:///tmp/polly-cors.json 2>&1)"
  local rc=$?
  set -e

  if [[ $rc -eq 0 ]]; then
    log "  - bucket CORS applied: $b"
    return 0
  fi

  if echo "$out" | grep -q "AccessDenied"; then
    echo "$out" >&2
    cat >&2 <<EOF

[필요 권한]
현재 사용자($CALLER_ARN)에 아래 권한이 없어 보입니다.

- s3:PutBucketCORS
- s3:GetBucketCORS (선택)
리소스는 버킷 자체(arn:aws:s3:::$b) 입니다.

예시(사용자 인라인 정책):
{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Effect":"Allow",
      "Action":["s3:PutBucketCORS","s3:GetBucketCORS"],
      "Resource":"arn:aws:s3:::$b"
    }
  ]
}

적용:
aws iam put-user-policy --user-name bedrock --policy-name PollyBucketCORS --policy-document file://policy.json

EOF
    return 1
  fi

  echo "$out" >&2
  return 1
}

# ------------------------------------------------------------
# zip 준비(없으면 설치 시도)
# ------------------------------------------------------------
ensure_zip() {
  if command -v zip >/dev/null 2>&1; then
    return 0
  fi
  log "zip not found."
  if command -v apt-get >/dev/null 2>&1; then
    log "installing zip via apt-get..."
    apt-get update -y >/dev/null
    apt-get install -y zip unzip >/dev/null
    command -v zip >/dev/null 2>&1 || { echo "zip install failed" >&2; return 1; }
    return 0
  fi
  echo "zip command not found and apt-get not available. Please install zip." >&2
  return 1
}

# ------------------------------------------------------------
# 실행
# ------------------------------------------------------------
log "Deploy start"
log "Caller: $CALLER_ARN"
log "Account: $ACCOUNT_ID"
log "Region: $AWS_REGION"

log "[0/8] Prereq"
ensure_zip

log "[1/8] Lambda dependency install + package"
pushd lambda >/dev/null
npm install --omit=dev
rm -f "../${ZIP_FILE}"
zip -rq "../${ZIP_FILE}" .
popd >/dev/null

log "[2/8] IAM role create (if not exists)"
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]
  }' >/dev/null
  # IAM 전파 지연 대응
  sleep 3
fi

log "[3/8] Attach policies"
aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null || true

cat > /tmp/polly-inline-policy.json <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["polly:SynthesizeSpeech"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"], "Resource": "arn:aws:s3:::${POLLY_S3_BUCKET}/*" }
  ]
}
POLICY
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name PollyS3Access \
  --policy-document file:///tmp/polly-inline-policy.json >/dev/null

log "[4/8] Ensure S3 bucket exists (create if missing)"
ensure_bucket_exists_or_create "$POLLY_S3_BUCKET"

log "[5/8] Lambda create/update (conflict-safe)"
if aws lambda get-function --function-name "$LAMBDA_NAME" >/dev/null 2>&1; then
  wait_lambda_updated "$LAMBDA_NAME"

  aws lambda update-function-code \
    --function-name "$LAMBDA_NAME" \
    --zip-file "fileb://${ZIP_FILE}" >/dev/null

  # ★ 코드 업데이트 완료 대기(필수)
  wait_lambda_updated "$LAMBDA_NAME"

  retry_on_conflict aws lambda update-function-configuration \
    --function-name "$LAMBDA_NAME" \
    --runtime "$RUNTIME" \
    --handler "$HANDLER" \
    --environment "Variables={POLLY_S3_BUCKET=${POLLY_S3_BUCKET},POLLY_S3_PREFIX=${POLLY_S3_PREFIX},CORS_ALLOW_ORIGIN=${CORS_ALLOW_ORIGIN}}" >/dev/null

  wait_lambda_updated "$LAMBDA_NAME"
else
  aws lambda create-function \
    --function-name "$LAMBDA_NAME" \
    --runtime "$RUNTIME" \
    --handler "$HANDLER" \
    --role "$ROLE_ARN" \
    --zip-file "fileb://${ZIP_FILE}" \
    --timeout 15 \
    --memory-size 256 \
    --environment "Variables={POLLY_S3_BUCKET=${POLLY_S3_BUCKET},POLLY_S3_PREFIX=${POLLY_S3_PREFIX},CORS_ALLOW_ORIGIN=${CORS_ALLOW_ORIGIN}}" >/dev/null

  aws lambda wait function-active-v2 --function-name "$LAMBDA_NAME"
fi

log "[6/8] Function URL create/get"
if ! aws lambda get-function-url-config --function-name "$LAMBDA_NAME" >/dev/null 2>&1; then
  aws lambda create-function-url-config --function-name "$LAMBDA_NAME" --auth-type NONE >/dev/null
fi

aws lambda update-function-url-config \
  --function-name "$LAMBDA_NAME" \
  --auth-type NONE \
  --cors "{\"AllowOrigins\":[\"${CORS_ALLOW_ORIGIN}\"],\"AllowMethods\":[\"POST\"],\"AllowHeaders\":[\"Content-Type\",\"Authorization\"],\"ExposeHeaders\":[\"Content-Type\"],\"MaxAge\":600}" >/dev/null

aws lambda add-permission \
  --function-name "$LAMBDA_NAME" \
  --statement-id FunctionURLAllowPublicAccess \
  --action lambda:InvokeFunctionUrl \
  --principal "*" \
  --function-url-auth-type NONE >/dev/null 2>&1 || true

aws lambda add-permission \
  --function-name "$LAMBDA_NAME" \
  --statement-id UrlPolicyInvokeFunctionPublic \
  --action lambda:InvokeFunction \
  --principal "*" \
  --invoked-via-function-url >/dev/null 2>&1 || true

FUNCTION_URL="$(aws lambda get-function-url-config --function-name "$LAMBDA_NAME" --query FunctionUrl --output text)"

log "[7/8] S3 bucket CORS apply"
put_bucket_cors_or_fail "$POLLY_S3_BUCKET"

log "[8/8] Done"
echo
echo "완료:"
echo " - Function URL: $FUNCTION_URL"
echo " - S3 Bucket   : $POLLY_S3_BUCKET"
echo " - S3 Prefix   : $POLLY_S3_PREFIX"
