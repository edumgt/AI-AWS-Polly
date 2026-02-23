#!/usr/bin/env bash
set -euo pipefail

FROM_PATH="${1:-}"
TO_S3="${2:-}"

if [[ -z "$FROM_PATH" || -z "$TO_S3" ]]; then
  echo "Usage: $0 <from_local_folder> <to_s3_uri>"
  echo "Example: $0 ./dist s3://my-bucket/web/dist/"
  exit 1
fi

if [[ ! -d "$FROM_PATH" ]]; then
  echo "Error: FROM_PATH is not a directory: $FROM_PATH"
  exit 1
fi

# aws cli 확인
command -v aws >/dev/null 2>&1 || { echo "Error: aws cli not found"; exit 1; }

# 경로 정규화 (끝 슬래시 처리)
FROM_PATH="${FROM_PATH%/}/"
# TO_S3는 s3:// 로 시작해야 함
if [[ "$TO_S3" != s3://* ]]; then
  echo "Error: TO_S3 must start with s3:// (got: $TO_S3)"
  exit 1
fi
# S3도 끝 슬래시 붙여서 '폴더 안 내용' 동기화가 직관적
TO_S3="${TO_S3%/}/"

echo "Sync:"
echo "  FROM: $FROM_PATH"
echo "  TO  : $TO_S3"
echo

# 업로드(동기화): 변경된 것만 전송. 필요시 --delete 추가 가능(아래 주석 참고)
aws s3 sync "$FROM_PATH" "$TO_S3" \
  --only-show-errors

echo "Done."