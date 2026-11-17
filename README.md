# CertStack

AWS 认证刷题应用 + AWS 部署实验台。应用代码和部署代码严格分开：

```
app/      应用本身（前端、Lambda、测试、本地运行）—— 不知道 SAM/Terraform 的存在
devops/   部署层（CloudFormation/SAM，以后可换成 Terraform）—— 只负责资源和发布
data/     题库导出脚本与产物（应用与部署共用的"输入"）
docs/     规划、部署路线、实验手册
```

## 当前进度：Step 01（静态站点）

| 步骤 | 内容 | 状态 |
| --- | --- | --- |
| 01 | S3 + CloudFront + OAC | 👈 现在 |
| 02 | 内容包上 S3，按 hash 版本化 + 路径缓存 | 待做 |
| 03 | Lambda + HTTP API | 待做 |
| 04 | DynamoDB 单表 | 待做 |
| 05 | Cognito + JWT 授权器 | 待做 |
| 06 | 可观测性（日志/指标/告警） | 待做 |
| 07 | CI/CD（CodePipeline/CodeBuild） | 待做 |

每一步的理由、验收和问题见 [docs/DEPLOY-STEPS.md](docs/DEPLOY-STEPS.md)。

## 跑 Step 01

```bash
bash devops/setup.sh               # 一次性：SAM CLI venv + 前端依赖（step 01 只用 AWS CLI + npm）
bash devops/step-01-static-web.sh
```

脚本会：创建私有 S3 桶 + CloudFront（OAC）→ 构建前端 → 写入 `config.json` →
上传 → 刷新缓存。完成后打印站点地址，浏览器打开会看到「部署进度」页，只有第 1 步是完成状态。

验收：

```bash
D=$(aws cloudformation describe-stacks --stack-name CertStack-dev --region ap-northeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomain'].OutputValue" --output text)
curl -sI "https://$D/" | head -12
curl -s -o /dev/null -w '%{http_code}\n' "https://$D/practice"   # 200，SPA 回退
```

## 本地开发与测试（不需要 AWS）

```bash
bash app/dev.sh                    # 前端开发服务器，显示「部署进度」页
.venv/bin/pytest app/tests -q      # Lambda 处理器单测（moto 模拟 DynamoDB/S3）
```

应用侧说明见 [app/README.md](app/README.md)。

## 为什么应用和部署要分开

- 应用只认**环境变量和构建产物**：`TABLE_NAME`、`CONTENT_BUCKET`、`config.json`。
- 部署层随时可换：现在的 `devops/sam/` 换成 `devops/terraform/`，`app/` 一行不用改。
- 每一步只引入一个新的失败面，出问题能立刻定位到刚加的那层。

## 成本

全部按量：CloudFront（每月 1 TB 出网 + 1000 万请求免费）、S3（几美分）、
后续的 Lambda/DynamoDB/Cognito 都在永久免费额度内。单人使用 **每月 < $1**。
所有资源带 `Project=CertStack`、`Env=dev`、`Stage=0N` 标签。
