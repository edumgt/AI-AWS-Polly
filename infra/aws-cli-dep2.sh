#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------
# GitHub Actions 용: Lambda 코드(zip)만 패키징해서 업로드
# - IAM Role/Policy 생성/수정 없음
# - S3 버킷/CORS/Function URL 설정 없음
# ------------------------------------------------------------

: "${AWS_REGION:?AWS_REGION is required}"
: "${LAMBDA_NAME:?LAMBDA_NAME is required}"

# 옵션(기본값)
LAMBDA_DIR="${LAMBDA_DIR:-lambda}"          # lambda 소스 폴더 (package.json 포함)
ZIP_FILE="${ZIP_FILE:-lambda.zip}"          # 생성될 zip 파일명(리포 루트 기준)
RUNTIME="${RUNTIME:-nodejs20.x}"            # 필요시 설정 업데이트용
HANDLER="${HANDLER:-handler.handler}"       # 필요시 설정 업데이트용

# 환경변수 업데이트(원하면 1로)
UPDATE_CONFIG="${UPDATE_CONFIG:-0}"         # 1이면 update-function-configuration 수행
POLLY_S3_BUCKET="${POLLY_S3_BUCKET:-}"      # UPDATE_CONFIG=1일 때 사용 가능
POLLY_S3_PREFIX="${POLLY_S3_PREFIX:-polly-lab/}"
CORS_ALLOW_ORIGIN="${CORS_ALLOW_ORIGIN:-*}"

# 함수 미존재 시 동작
FAIL_IF_MISSING="${FAIL_IF_MISSING:-1}"     # 1이면 없을 때 에러 종료(기본)
# CREATE_IF_MISSING 같은 create 로직은 요청대로 기본 제외(필요하면 추가 가능)

cleanup() {
  rm -f "./${ZIP_FILE}" 2>/dev/null || true
}
trap cleanup EXIT

log() { echo "[$(date +'%H:%M:%S')] $*"; }

# ------------------------------------------------------------
# Lambda update 충돌 방지 유틸
# ------------------------------------------------------------
wait_lambda_updated() {
  local fn="$1"
  aws lambda wait function-updated --function-name "$fn" --region "$AWS_REGION" >/dev/null 2>&1 || true

  while true; do
    local last state reason
    last="$(aws lambda get-function-configuration --function-name "$fn" --region "$AWS_REGION" --query 'LastUpdateStatus' --output text 2>/dev/null || echo "Unknown")"
    state="$(aws lambda get-function-configuration --function-name "$fn" --region "$AWS_REGION" --query 'State' --output text 2>/dev/null || echo "Unknown")"
    reason="$(aws lambda get-function-configuration --function-name "$fn" --region "$AWS_REGION" --query 'LastUpdateStatusReason' --output text 2>/dev/null || echo "")"

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

    echo "$out" >&2
    return $rc
  done
}

ensure_zip() {
  if command -v zip >/dev/null 2>&1; then
    return 0
  fi
  log "zip not found. installing..."
  sudo apt-get update -y >/dev/null
  sudo apt-get install -y zip unzip >/dev/null
  command -v zip >/dev/null 2>&1 || { echo "zip install failed" >&2; return 1; }
}

# ------------------------------------------------------------
# 실행
# ------------------------------------------------------------
log "Deploy start"
log "Region: $AWS_REGION"
log "Lambda: $LAMBDA_NAME"
log "Lambda dir: $LAMBDA_DIR"

log "[0/4] Prereq"
ensure_zip
command -v node >/dev/null 2>&1 || { echo "node not found (setup-node 필요)" >&2; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "npm not found (setup-node 필요)" >&2; exit 1; }

log "[1/4] Check Lambda exists"
if ! aws lambda get-function --function-name "$LAMBDA_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
  if [[ "$FAIL_IF_MISSING" == "1" ]]; then
    echo "Lambda not found: $LAMBDA_NAME (FAIL_IF_MISSING=1)" >&2
    exit 1
  fi
fi

log "[2/4] Install deps + package zip"
pushd "$LAMBDA_DIR" >/dev/null
npm ci --omit=dev
popd >/dev/null

rm -f "./${ZIP_FILE}"
pushd "$LAMBDA_DIR" >/dev/null
zip -rq "../${ZIP_FILE}" .
popd >/dev/null
log "  - packaged: ./${ZIP_FILE}"

log "[3/4] Update Lambda code (conflict-safe)"
wait_lambda_updated "$LAMBDA_NAME"
retry_on_conflict aws lambda update-function-code \
  --function-name "$LAMBDA_NAME" \
  --region "$AWS_REGION" \
  --zip-file "fileb://${ZIP_FILE}" >/dev/null

wait_lambda_updated "$LAMBDA_NAME"

# (선택) 환경변수/런타임/핸들러를 CI에서 같이 갱신하고 싶을 때만 사용
if [[ "$UPDATE_CONFIG" == "1" ]]; then
  log "  - updating function configuration (UPDATE_CONFIG=1)"
  # 필요한 값만 넣고 싶으면 여기 Variables 구성을 너 프로젝트에 맞게 더 줄여도 됨
  retry_on_conflict aws lambda update-function-configuration \
    --function-name "$LAMBDA_NAME" \
    --region "$AWS_REGION" \
    --runtime "$RUNTIME" \
    --handler "$HANDLER" \
    --environment "Variables={POLLY_S3_BUCKET=${POLLY_S3_BUCKET},POLLY_S3_PREFIX=${POLLY_S3_PREFIX},CORS_ALLOW_ORIGIN=${CORS_ALLOW_ORIGIN}}" >/dev/null

  wait_lambda_updated "$LAMBDA_NAME"
fi

log "[4/4] Done"
echo "완료: Lambda code updated -> ${LAMBDA_NAME} (${AWS_REGION})"
