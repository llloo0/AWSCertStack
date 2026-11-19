# CertStack

AWS 认证刷题应用 + AWS 部署实验台。应用代码和部署代码严格分开：

```
app/      应用本身（前端、Lambda、测试、本地运行）—— 不知道 SAM/Terraform 的存在
devops/   部署层 —— 从零开始，现在只有一个模板骨架
data/     题库导出脚本与产物（应用与部署共用的"输入"）
docs/     规划与部署路线
```

## 现在在哪

| 部分 | 状态 |
| --- | --- |
| Web 应用（`app/web`） | 已完成，本地 mock 模式可跑，视觉已确认 |
| Lambda（`app/lambda`） | 代码已写，尚未接入部署 |
| 部署（`devops/`） | **从零开始**：Step 01 已完成：私有桶 + CloudFront + OAC + 缓存行为 + 发布脚本；下一步 Step 02（Lambda + HTTP API） |
| 参考实现 | 归档在 `solution/reference/`，先别看 |

## 从零开始部署

部署不是一条命令的事，是按 `docs/DEVOPS-FROM-ZERO.md` 一次加一个资源长出来的：

1. 读 [docs/DEVOPS-FROM-ZERO.md](docs/DEVOPS-FROM-ZERO.md) 的 Increment 0
2. `devops/sam/steps/01-static-web/template.yaml` 里已经有第一个 S3 桶
3. 部署、验收、提交，再进入 Increment 1

Increment 0 的部署命令：

```bash
aws cloudformation deploy \
  --template-file devops/sam/steps/01-static-web/template.yaml \
  --stack-name CertStack-dev \
  --region ap-northeast-1 --profile certstack \
  --parameter-overrides Env=dev \
  --no-fail-on-empty-changeset
```

> 模板现在故意是空的：`Resources` 里只有一个注释。在你写进第一个资源之前，
> `cfn-lint` 和 `deploy` 都会报错，这是预期行为。

## 目录

```
app/
  web/            React 前端（mock 模式，数据在 localStorage）
  lambda/         Python 处理器（后续步骤接入）
  tests/          pytest + moto
devops/
  README.md
  sam/steps/01-static-web/template.yaml    ← 你现在要写的地方
docs/
  DEVOPS-FROM-ZERO.md   部署模板怎么来的 + Increment 0–6
  PLAN.md               整体规划（架构、数据模型、成本、路线）
solution/
  reference/      已跑通的参考实现（gitignored）
  m1/             更早的实现归档（gitignored）
data/
  export_content.py      SQLite → 静态内容包
```

## 本地跑应用

```bash
bash app/dev.sh                    # http://localhost:5173，mock 模式
.venv/bin/pytest app/tests -q      # Lambda 处理器单测
```

## 原则

- 应用只认**环境变量和构建产物**：`TABLE_NAME`、`CONTENT_BUCKET`、`config.json`。
- 部署层随时可换：CloudFormation/SAM 换成 Terraform，`app/` 一行不用改。
- 一次只加一个资源，出问题能定位到刚加的那层。

## 成本

静态站点这一段只有 S3 + CloudFront，单人使用接近 $0。
后续 Lambda / DynamoDB / Cognito 都在免费额度内，整体每月 < $1。
