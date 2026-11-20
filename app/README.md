# app —— 应用代码（与部署无关）

这里只有「应用本身」：前端、Lambda、测试、本地运行。**不含任何 SAM/Terraform/CloudFormation 概念**，
部署层在 `../devops/`，通过构建产物与环境变量与这里解耦。

```
app/
├── web/                 # React + Vite 前端
│   └── public/config.json 由部署层在发布时写入（运行期配置）
├── lambda/
│   ├── common/python/certstack/   # 共享库（打包成 Lambda Layer）
│   ├── profile/app.py             # /api/me, /api/stats
│   ├── sessions/app.py            # /api/sessions*
│   ├── study/app.py               # /api/srs/due, /api/bookmarks
│   └── health/app.py              # /api/health
└── tests/               # pytest + moto，本地模拟 DynamoDB/S3
```

## 本地运行

```bash
bash app/dev.sh
```

首次会安装前端依赖，并生成 `web/public/config.dev.json`（阶段 local，还没有 API/登录）。
打开 http://localhost:5173 会看到「部署进度」页。

## 本地测试

```bash
# 一次性
python3 -m venv .venv && .venv/bin/pip install pytest moto boto3

# 跑测试
.venv/bin/pytest app/tests -q
```

测试用 moto 在本机模拟 DynamoDB/S3，覆盖：鉴权主体解析、建会话、作答、幂等、
交卷判分、标签统计、SRS 队列、书签。

## 运行期配置（config.json）

部署层发布前端时写入，前端启动时读取：

```jsonc
{
  "stage": "01-static-web",        // 当前部署阶段
  "mock": false,                   // true = 本地演示模式（localStorage 模拟后端）
  "env": "dev",
  "region": "ap-northeast-1",
  "userPoolId": "...",             // step 05 之后出现
  "userPoolClientId": "...",
  "apiBaseUrl": "",                // 空表示同源 /api
  "contentBaseUrl": "/content",    // step 02 之后出现
  "features": { "content": true, "api": true, "auth": true }
}
```

`features.auth` 为 false 时，前端只渲染「部署进度」页，不会尝试登录。

## Lambda 的环境变量

| 变量 | 用途 | 引入阶段 |
| --- | --- | --- |
| `TABLE_NAME` | DynamoDB 表名 | step 04 |
| `CONTENT_BUCKET` | 内容包所在桶 | step 02 |
| `CONTENT_INDEX_KEY` | 内容索引对象键 | step 02 |
| `ALLOWED_ORIGINS` | 本地开发 CORS 白名单 | step 03 |
| `ALLOW_DEV_AUTH` | 临时允许无 JWT（仅 dev，接 Cognito 前使用） | step 04 |
| `DEV_USER_SUB` | 临时固定用户 ID（配合 `ALLOW_DEV_AUTH`） | step 04 |

应用代码只依赖这些环境变量，不依赖资源名字或 CFN 逻辑 ID——这是能换掉
SAM/Terraform 的前提。
