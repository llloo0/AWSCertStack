#!/usr/bin/env bash
# 备份 DynamoDB 单表，然后删除整个 CloudFormation 栈。
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="${AWS_PROFILE:-certstack}"
REGION="${AWS_REGION:-ap-northeast-1}"
STACK="${STACK_NAME:-CertStack-dev}"

TABLE="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --profile "$PROFILE" \
  --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text 2>/dev/null || true)"

if [[ -n "$TABLE" && "$TABLE" != "None" ]]; then
  mkdir -p var/backups
  OUT="var/backups/${STACK}-$(date -u +%Y%m%dT%H%M%SZ).json.gz"
  echo "==> 备份 $TABLE -> $OUT"
  aws dynamodb scan --table-name "$TABLE" --region "$REGION" --profile "$PROFILE" \
    --consistent-read --output json | gzip -9 > "$OUT"
  echo "    备份完成（$(du -h "$OUT" | cut -f1)）"
else
  echo "==> 栈不存在或没有表，跳过备份"
fi

echo "==> 删除栈 $STACK（CloudFront 通常最慢，耐心等）"
aws cloudformation delete-stack --stack-name "$STACK" --region "$REGION" --profile "$PROFILE"
aws cloudformation wait stack-delete-complete --stack-name "$STACK" --region "$REGION" --profile "$PROFILE"
echo "完成。CDKToolkit / SAM 产物桶保留，不影响后续重建。"
