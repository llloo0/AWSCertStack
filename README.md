# CertStack

用 AWS 服务搭一个刷题应用：SAA-C03 / DOP-C02 备考 + AWS 服务实验台。

**这个仓库现在由你来实现。** M1 的参考实现已归档在 `solution/m1/`（已 gitignore），
课表在 [docs/LABS.md](docs/LABS.md)，从 Lab 0 开始。

## 当前状态

| 部分 | 状态 |
| --- | --- |
| 题目内容管道（SQLite → JSON） | ✅ 已提供，直接可用（`npm run data`） |
| M1 参考实现 | 📦 已归档到 `solution/m1/`，别提前看 |
| `infra/`（CDK） | 🌱 只有脚手架，Stack 由你写 |
| `web/`（前端） | 🌱 由你在 Lab 1 用 Vite 创建 |
| AWS 资源 | ☐ 已冻结并待销毁（Lab 0） |

## 从这里开始

1. 读 [docs/LABS.md](docs/LABS.md) 的「合作方式」和课表
2. 做 Lab 0：亲手销毁现有栈，观察 CloudFormation 的删除顺序
3. 做 Lab 1：私有 S3 + CloudFront（详细步骤见 [docs/LAB-01.md](docs/LAB-01.md)）

## 目录

```
.
├── aws-quiz.db            # 原始题库（2381 题 / 3 门考试）
├── data/
│   ├── exams.json         # 考试配置（题量、时长、通过线、考纲域权重）
│   ├── export_content.py  # SQLite → 内容包（含校验），直接可用
│   └── dist/              # 生成产物（gitignored）
├── docs/
│   ├── PLAN.md            # 架构、数据模型、成本、路线图（规格，不是答案）
│   ├── LABS.md            # 重建课表 + Lab 0
│   └── LAB-01.md          # 第一个实验的详细步骤
├── infra/                 # CDK v2 脚手架：app.ts 等你填
├── web/                   # 待创建（Lab 1）
└── solution/m1/           # 已部署实现的归档（gitignored）
```

## 前置

- Node.js ≥ 22、Python ≥ 3.10
- AWS CLI v2 ≥ 2.32，profile `certstack`（`aws login --profile certstack`）
- 账号已 bootstrap（`npx cdk bootstrap aws://<ACCOUNT_ID>/ap-northeast-1 --profile certstack`）

Free plan 账号**不要**为了 SSO 创建 AWS Organizations，会立即升级为按量付费——
`aws login` 就够了，详见 [docs/PLAN.md](docs/PLAN.md) 第 12 节。

## 内容管道（现成可用）

```bash
npm run data     # 生成 data/dist/content，2381 题，含完整性校验
```

产物里每题都有中英题干/选项/解析、正确答案、标签、来源，带内容指纹。
Lab 2 会把它传到 S3，但脚本本身不需要你重写——它属于「输入」，不是「要学的 AWS 部分」。

## 我提供的脚手架

- `infra/package.json` / `tsconfig.json` / `cdk.json`：CDK 工具链，避免把时间花在配置上
- `infra/bin/app.ts`：入口文件，里面留了 Lab 1 的 TODO
- 其余一切（Stack、Lambda、前端、脚本）由你写

## 成本

M1 架构全部按量计费，单人使用每月 < $1；没有 ALB / NAT / Aurora 这类固定费用资源。
`docs/PLAN.md` 第 9 节有完整成本表和销毁策略。
