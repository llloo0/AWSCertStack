#!/usr/bin/env bash
# 端到端冒烟：登录 -> 建会话 -> 作答 -> 幂等重复提交 -> 交卷 -> 统计
# 用法：scripts/smoke-test.sh <用户名> <密码>
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="${AWS_PROFILE:-certstack}"
REGION="${AWS_REGION:-ap-northeast-1}"
STACK="${STACK_NAME:-CertStack-dev}"
USERNAME="${1:?usage: smoke-test.sh <username> <password>}"
PASSWORD="${2:?usage: smoke-test.sh <username> <password>}"
EXAM="${EXAM:-SAA-C03}"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --profile "$PROFILE" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

API="$(output ApiEndpoint)"
POOL_ID="$(output UserPoolId)"
CLIENT_ID="$(output UserPoolClientId)"

echo "==> 登录 $USERNAME"
TOKEN="$(aws cognito-idp admin-initiate-auth \
  --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME="$USERNAME",PASSWORD="$PASSWORD" \
  --region "$REGION" --profile "$PROFILE" \
  --query 'AuthenticationResult.IdToken' --output text)"

AUTH=(-H "authorization: Bearer $TOKEN" -H "content-type: application/json")

echo "==> GET $API/api/me"
curl -fsS "${AUTH[@]}" "$API/api/me" | head -c 400; echo

echo "==> POST $API/api/sessions"
SESSION="$(curl -fsS "${AUTH[@]}" -X POST "$API/api/sessions" \
  -d "{\"exam\":\"$EXAM\",\"mode\":\"practice\",\"count\":3}")"
echo "$SESSION" | head -c 400; echo

SID="$(printf '%s' "$SESSION" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
QIDS="$(printf '%s' "$SESSION" | python3 -c 'import json,sys; print(" ".join(json.load(sys.stdin)["questionIds"]))')"

echo "==> 作答 3 题（固定选 a）"
for QID in $QIDS; do
  curl -fsS "${AUTH[@]}" -X PUT "$API/api/sessions/$SID/answers/$QID" \
    -d '{"selected":["a"],"elapsedMs":4200}' | head -c 200; echo
done

FIRST_QID="$(echo "$QIDS" | cut -d' ' -f1)"
echo "==> 重复提交第一题（应返回 duplicate，统计不翻倍）"
curl -fsS "${AUTH[@]}" -X PUT "$API/api/sessions/$SID/answers/$FIRST_QID" \
  -d '{"selected":["a"],"elapsedMs":4200}' | head -c 300; echo

echo "==> POST $API/api/sessions/$SID/finish"
curl -fsS "${AUTH[@]}" -X POST "$API/api/sessions/$SID/finish" | python3 -m json.tool | head -30

echo "==> GET $API/api/stats"
curl -fsS "${AUTH[@]}" "$API/api/stats" | head -c 400; echo
echo "OK"
