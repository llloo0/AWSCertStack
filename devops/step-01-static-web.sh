#!/usr/bin/env bash
# Step 01：把当前这版前端（mock 模式）发布到私有 S3 + CloudFront。
#
# 这一版还没有 API / DynamoDB / Cognito：
#   - 答题数据保存在浏览器 localStorage
#   - 题库随前端一起发布，从 /content 读取
# 后续步骤会把 mock 换成真实后端。
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="${AWS_PROFILE:-certstack}"
REGION="${AWS_REGION:-ap-northeast-1}"
STACK="${STACK_NAME:-CertStack-dev}"
ENV_NAME="${ENV_NAME:-dev}"
STAGE="01-static-web"
TEMPLATE="devops/sam/steps/01-static-web/template.yaml"

export AWS_PROFILE="$PROFILE"
export AWS_DEFAULT_REGION="$REGION"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

echo "==> 1/5 生成题库内容包"
if [[ ! -f data/dist/content/index.json ]]; then
  python3 data/export_content.py | tail -3
else
  echo "已存在 data/dist/content，跳过"
fi

echo "==> 2/5 创建/更新 CloudFormation 栈（CloudFront 创建约 5-8 分钟）"
aws cloudformation deploy \
  --template-file "$TEMPLATE" \
  --stack-name "$STACK" \
  --region "$REGION" \
  --parameter-overrides "Env=$ENV_NAME" "Stage=$STAGE" \
  --tags Project=CertStack Env="$ENV_NAME" Stage="$STAGE" \
  --no-fail-on-empty-changeset

WEB_BUCKET="$(output WebBucketName)"
DIST_ID="$(output DistributionId)"
DOMAIN="$(output DistributionDomain)"

echo "==> 3/5 构建前端"
[[ -d app/web/node_modules ]] || npm --prefix app/web install --no-audit --no-fund
npm --prefix app/web run build

echo "==> 4/5 组装发布目录"
rm -rf app/web/dist/content
cp -r data/dist/content app/web/dist/content
cat > app/web/dist/config.json <<JSON
{
  "stage": "$STAGE",
  "mock": true,
  "env": "$ENV_NAME",
  "region": "$REGION",
  "contentBaseUrl": "/content",
  "features": { "content": true, "api": true, "auth": true },
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo "==> 5/5 上传并刷新缓存"
aws s3 sync app/web/dist "s3://$WEB_BUCKET" --delete --region "$REGION"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' --region "$REGION" >/dev/null

cat <<EOF

Step 01 完成。

站点：https://$DOMAIN

请自己验证：
  D="https://$DOMAIN"
  B="$WEB_BUCKET"

  curl -sI "\$D/" | head -12
  curl -s -o /dev/null -w '%{http_code}\\n' "\$D/practice"        # 期望 200
  curl -s -o /dev/null -w '%{http_code}\\n' "https://\$B.s3.$REGION.amazonaws.com/index.html"  # 期望 403
  curl -sI "\$D/config.json" | grep -i cache-control             # 期望 no-cache 行为

这一版是 mock 模式：登录跳过，答题记录只存在浏览器 localStorage。
设置页可以「重置演示数据」。
EOF
