#!/usr/bin/env bash
# 一次性环境准备：Python venv + SAM CLI + 前端依赖。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 检查 AWS 凭证"
aws sts get-caller-identity --profile "${AWS_PROFILE:-certstack}" >/dev/null
echo "    OK"

if [[ ! -x .venv/bin/sam ]]; then
  echo "==> 创建 Python venv 并安装 SAM CLI（约 1-2 分钟）"
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip >/dev/null
  .venv/bin/pip install aws-sam-cli cfn-lint
fi
.venv/bin/sam --version

echo "==> 安装前端依赖"
npm --prefix app/web install --no-audit --no-fund

echo
echo "环境就绪。下一步：bash scripts/deploy.sh"
