#!/usr/bin/env bash
# 创建或重置 Cognito 用户。用法：scripts/create-user.sh <用户名> [密码]
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="${AWS_PROFILE:-certstack}"
REGION="${AWS_REGION:-ap-northeast-1}"
STACK="${STACK_NAME:-CertStack-dev}"
USERNAME="${1:?usage: create-user.sh <username> [password]}"

if [[ $# -ge 2 ]]; then
  PASSWORD="$2"
else
  PASSWORD="$(python3 -c 'import secrets,string; a=string.ascii_letters+string.digits; print("Cq" + "".join(secrets.choice(a) for _ in range(14)) + "9")')"
fi

POOL_ID="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --profile "$PROFILE" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)"

if [[ -z "$POOL_ID" || "$POOL_ID" == "None" ]]; then
  echo "无法读取 UserPoolId，确认栈 $STACK 已部署。" >&2
  exit 1
fi

echo "==> 创建用户（已存在则跳过）"
aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" --username "$USERNAME" \
  --user-attributes Name=preferred_username,Value="$USERNAME" \
  --message-action SUPPRESS \
  --region "$REGION" --profile "$PROFILE" >/dev/null 2>&1 || true

echo "==> 设置永久密码"
aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL_ID" --username "$USERNAME" \
  --password "$PASSWORD" --permanent \
  --region "$REGION" --profile "$PROFILE"

cat <<EOF

用户名: $USERNAME
密码:   $PASSWORD
用户池: $POOL_ID

登录地址：见 deploy 输出里的 AppUrl。
EOF
