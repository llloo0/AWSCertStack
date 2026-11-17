#!/usr/bin/env bash
# 生成前端本地开发配置（API 指向已部署的 CloudFront）。
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="${AWS_PROFILE:-certstack}"
REGION="${AWS_REGION:-ap-northeast-1}"
STACK="${STACK_NAME:-CertStack-dev}"
OUT="${1:-app/web/public/config.dev.json}"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --profile "$PROFILE" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

DOMAIN="$(output DistributionDomain)"
POOL_ID="$(output UserPoolId)"
CLIENT_ID="$(output UserPoolClientId)"

mkdir -p "$(dirname "$OUT")"
cat > "$OUT" <<JSON
{
  "env": "dev",
  "region": "$REGION",
  "userPoolId": "$POOL_ID",
  "userPoolClientId": "$CLIENT_ID",
  "apiBaseUrl": "https://$DOMAIN",
  "contentBaseUrl": "https://$DOMAIN/content",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo "已写入 $OUT（站点 https://$DOMAIN）"
