#!/usr/bin/env bash
# Step 01 发布脚本
#
# 做四件事：构建 → 组装 → 上传（按路径分别设置缓存）→ 失效。
# 需要已经按 Increment 0–4 部署过 CertStack-dev。
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="${AWS_PROFILE:-certstack}"
REGION="${AWS_REGION:-ap-northeast-1}"
STACK="${STACK_NAME:-CertStack-dev}"
ENV_NAME="${ENV_NAME:-dev}"
STAGE="01-static-web"
WEB_ROOT="app/web/dist"

export AWS_PROFILE="$PROFILE"
export AWS_DEFAULT_REGION="$REGION"

say() { printf '\n==> %s\n' "$*"; }

command -v aws >/dev/null || { echo "找不到 aws CLI"; exit 1; }

say "读取栈输出"
STATUS="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true)"
if [[ -z "$STATUS" || "$STATUS" == "None" ]]; then
  echo "栈 $STACK 不存在，先完成 Increment 0–4 的部署" >&2
  exit 1
fi

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

BUCKET="$(output WebBucketName)"
DIST_ID="$(output DistributionId)"
DOMAIN="$(output DistributionDomain)"

for v in BUCKET DIST_ID DOMAIN; do
  if [[ -z "${!v}" || "${!v}" == "None" ]]; then
    echo "栈输出缺少 $v，检查模板的 Outputs" >&2
    exit 1
  fi
done

echo "bucket=$BUCKET"
echo "distribution=$DIST_ID"
echo "domain=$DOMAIN"

say "1/6 生成题库内容包"
python3 data/export_content.py | tail -3

say "2/6 构建前端"
if [[ ! -d app/web/node_modules ]]; then
  npm --prefix app/web install --no-audit --no-fund
fi
npm --prefix app/web run build

say "3/6 组装发布目录"
rm -rf "$WEB_ROOT/content"
cp -r data/dist/content "$WEB_ROOT/content"
cat > "$WEB_ROOT/config.json" <<JSON
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

say "4/6 上传带 hash 的静态资源（长缓存）"
if [[ -d "$WEB_ROOT/assets" ]]; then
  aws s3 sync "$WEB_ROOT/assets" "s3://$BUCKET/assets" \
    --delete \
    --cache-control "public, max-age=31536000, immutable" \
    --region "$REGION"
fi

say "5/6 上传内容包与入口文件"
# 内容包的目录名带 hash，可以长缓存；先传文件，再覆盖 index.json
aws s3 sync "$WEB_ROOT/content" "s3://$BUCKET/content" \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --region "$REGION"

aws s3 cp "$WEB_ROOT/content/index.json" "s3://$BUCKET/content/index.json" \
  --cache-control "no-cache" \
  --content-type "application/json" \
  --region "$REGION"

# 入口与运行期配置：固定路径，必须不缓存
aws s3 cp "$WEB_ROOT/index.html" "s3://$BUCKET/index.html" \
  --cache-control "no-cache" \
  --content-type "text/html; charset=utf-8" \
  --region "$REGION"

aws s3 cp "$WEB_ROOT/config.json" "s3://$BUCKET/config.json" \
  --cache-control "no-cache" \
  --content-type "application/json" \
  --region "$REGION"

# 根目录下的其它文件（favicon 等）
shopt -s nullglob
for f in "$WEB_ROOT"/*; do
  base="$(basename "$f")"
  case "$base" in
    assets|content|index.html|config.json) continue ;;
  esac
  if [[ -f "$f" ]]; then
    aws s3 cp "$f" "s3://$BUCKET/$base" --cache-control "public, max-age=86400" --region "$REGION"
  fi
done

say "6/6 刷新 CloudFront 缓存"
aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" --paths '/*' --region "$REGION" >/dev/null

cat <<EOF

发布完成：https://$DOMAIN

自己验证：
  curl -sI "https://$DOMAIN/config.json" | grep -iE 'cache-control|x-cache'
  curl -sI "https://$DOMAIN/index.html" | grep -iE 'cache-control|x-cache'
  curl -sI "https://$DOMAIN/content/index.json" | grep -iE 'cache-control|x-cache'
  curl -sI "https://$DOMAIN/assets/<某个hash文件>.js" | grep -iE 'cache-control|age'

期望：
  config.json / index.html / content/index.json  ->  cache-control: no-cache
  带 hash 的静态资源                              ->  immutable，第二次请求 x-cache: Hit
EOF
