#!/usr/bin/env bash
# 本地运行前端（演示模式，不依赖任何 AWS 服务）。
# 会：准备真实题库内容 -> 写入 mock 配置 -> 启动 Vite。
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -d app/web/node_modules ]]; then
  echo "==> 安装前端依赖"
  npm --prefix app/web install --no-audit --no-fund
fi

if [[ ! -f data/dist/content/index.json ]]; then
  echo "==> 生成内容包"
  python3 data/export_content.py | tail -3
fi

echo "==> 复制题库到前端静态目录"
mkdir -p app/web/public/content
rsync -a --delete data/dist/content/ app/web/public/content/

echo "==> 写入本地演示配置"
cat > app/web/public/config.dev.json <<'JSON'
{
  "stage": "local",
  "env": "local",
  "region": "ap-northeast-1",
  "mock": true,
  "contentBaseUrl": "/content",
  "features": { "content": true, "api": true, "auth": true }
}
JSON

echo
echo "打开 http://localhost:5173  （Ctrl+C 停止）"
echo "数据只存在浏览器 localStorage，清空方法：控制台执行 localStorage.removeItem('certstack:mock:v1')"
echo
cd app/web
npm run dev
