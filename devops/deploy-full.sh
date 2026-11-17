#!/usr/bin/env bash
# 一键部署：构建内容包 -> SAM 部署 -> 构建前端 -> 上传 S3 -> 刷新 CloudFront
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="${AWS_PROFILE:-certstack}"
REGION="${AWS_REGION:-ap-northeast-1}"
STACK="${STACK_NAME:-CertStack-dev}"
ENV_NAME="${ENV_NAME:-dev}"
SAM=.venv/bin/sam

export AWS_PROFILE="$PROFILE"
export AWS_DEFAULT_REGION="$REGION"

if [[ ! -x "$SAM" ]]; then
  echo "缺少 SAM CLI，请先运行：bash scripts/setup.sh" >&2
  exit 1
fi

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --profile "$PROFILE" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

echo "==> 1/5 生成内容包"
python3 data/export_content.py | tail -3

echo "==> 2/5 sam build"
"$SAM" build --template-file devops/sam/steps/07-full/template.yaml --parallel

echo "==> 3/5 sam deploy（会先展示 changeset，确认后回车）"
"$SAM" deploy \
  --stack-name "$STACK" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --no-fail-on-empty-changeset \
  --parameter-overrides "Env=$ENV_NAME"

POOL_ID="$(output UserPoolId)"
CLIENT_ID="$(output UserPoolClientId)"
WEB_BUCKET="$(output WebBucketName)"
CONTENT_BUCKET="$(output ContentBucketName)"
DIST_ID="$(output DistributionId)"
DOMAIN="$(output DistributionDomain)"

echo "==> 4/5 构建前端"
npm --prefix app/web run build

cat > app/web/dist/config.json <<JSON
{
  "env": "$ENV_NAME",
  "region": "$REGION",
  "userPoolId": "$POOL_ID",
  "userPoolClientId": "$CLIENT_ID",
  "apiBaseUrl": "",
  "contentBaseUrl": "/content",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo "==> 5/5 上传静态资源并刷新缓存"
aws s3 sync app/web/dist "s3://$WEB_BUCKET" --delete --region "$REGION" --profile "$PROFILE"
aws s3 sync data/dist/content "s3://$CONTENT_BUCKET/content" --region "$REGION" --profile "$PROFILE"
aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" --paths '/*' \
  --region "$REGION" --profile "$PROFILE" >/dev/null

cat <<EOF

部署完成：
  站点: https://$DOMAIN
  用户池: $POOL_ID
  客户端: $CLIENT_ID

创建登录用户：
  bash scripts/create-user.sh <用户名>
EOF
