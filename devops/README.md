# devops —— 部署层

```
devops/
├── setup.sh                    # 一次性：Python venv + SAM CLI + 前端依赖
├── step-01-static-web.sh       # 当前阶段：S3 + CloudFront + OAC
├── deploy-full.sh              # 参考：完整栈（step 07 之后才会用到）
├── create-user.sh              # Cognito 建用户（step 05）
├── smoke-test.sh               # 端到端冒烟（step 05）
├── dev-config.sh               # 本地开发配置（指向已部署环境）
├── down.sh                     # 备份 + 删栈
└── sam/
    ├── samconfig.toml          # 完整栈的 sam deploy 默认值
    └── steps/
        ├── 01-static-web/template.yaml   # 纯 CloudFormation，无 Lambda
        └── 07-full/template.yaml         # 完整 SAM 模板（后续步骤的参考实现）
```

## 原则

- **应用代码不动**：`devops/` 只负责创建资源、注入环境变量、发布构建产物。
- **一步一部署**：每个 `step-0N-*.sh` 都能独立执行，栈名始终是 `CertStack-dev`，逐步 update。
- **工具可替换**：现在用 CloudFormation/SAM；以后加 `devops/terraform/`，脚本换掉即可。

## 为什么 step 01 不用 SAM

这一步只有 S3 + CloudFront，没有 Lambda，不需要打包代码——直接用
`aws cloudformation deploy` 就够了。从 step 03 引入 Lambda 开始，才需要
`sam build`（打包 Python 依赖/layer）和 `sam deploy`。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `bash devops/setup.sh` | 一次性环境准备 |
| `bash devops/step-01-static-web.sh` | 部署静态站点 |
| `bash devops/down.sh` | 备份数据后删栈 |
| `bash devops/create-user.sh <name>` | 创建 Cognito 用户（step 05） |
| `bash devops/smoke-test.sh <name> <pwd>` | 端到端冒烟（step 05） |

所有脚本都从仓库根目录执行，内部 `cd` 到根目录，切换目录也不会出错。
