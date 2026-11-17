# 从 0 到 1：部署路线

应用代码在 `app/`，部署代码在 `devops/`。这一份只讲**部署怎么一步步长出来**，
每一步都能单独部署、单独验证、单独回滚。

| 步骤 | 新增的 AWS 资源 | 为什么需要它 | 应用侧变化 |
| --- | --- | --- | --- |
| 01 | S3（web）+ CloudFront + OAC + 响应头策略 | 先把「能访问的静态站点」跑通 | 显示部署进度页 |
| 02 | S3（内容）+ `/content/*` 缓存行为 | 题目是只读大文件，放 CDN 最便宜 | 能浏览题库 |
| 03 | Lambda + HTTP API + IAM 角色 | 需要服务端逻辑（抽题、判分） | 能调 `/api/health` |
| 04 | DynamoDB 单表 + 2 个 GSI | 刷题记录、统计要持久化 | 练习记录落库 |
| 05 | Cognito + JWT 授权器 | 用户与访问控制 | 开放登录 |
| 06 | CloudWatch 指标/告警、日志保留 | 出问题要能看见 | 不变 |
| 07 | CodePipeline + CodeBuild | 部署自动化 | 不变 |

为什么是这个顺序：每一步只引入一个「新的失败面」，出问题能立刻定位到刚加的东西。
反过来（一次全上）就会像之前的 M1——能跑，但说不清哪一层在干什么。

---

## Step 01：静态站点（当前）

**命令**

```bash
bash devops/step-01-static-web.sh
```

**它做了什么**

1. `aws cloudformation deploy` 创建：私有 S3 桶、CloudFront（OAC）、响应头策略、桶策略，
   以及 `/config.json`、`/content/index.json`、`/content/*` 三条缓存行为
2. 构建 `app/web`（Vite）
3. 把题库复制进发布目录，写 `config.json`（`mock: true`，答题数据存浏览器）
4. `aws s3 sync` 上传，`create-invalidation` 刷新缓存

> 为了让「先看清楚 Web」这件事成立，这一版把题库临时跟前端一起发布，应用跑在 mock 模式。
> Step 02 会把题库拆到独立内容桶，并按 hash 版本化；Step 03 起逐步替换 mock。

**验收**

```bash
D=$(aws cloudformation describe-stacks --stack-name CertStack-dev --region ap-northeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomain'].OutputValue" --output text)
B=$(aws cloudformation describe-stacks --stack-name CertStack-dev --region ap-northeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='WebBucketName'].OutputValue" --output text)

curl -sI "https://$D/" | head -12                 # 200 + HSTS / CSP
curl -s -o /dev/null -w '%{http_code}\n' "https://$D/practice"          # 200（SPA 回退）
curl -s -o /dev/null -w '%{http_code}\n' "https://$B.s3.ap-northeast-1.amazonaws.com/index.html"  # 403
```

浏览器打开 `https://$D/`，应看到「部署进度」页，第 1 步完成，其余待开始。

**在控制台看什么**

- CloudFormation → `CertStack-dev` → Events：S3 先建，CloudFront 最慢，桶策略最后（因为它引用了 Distribution 的 ARN）
- CloudFront → Distribution：Origins 只有 1 个，Origin access control 指向刚建的 OAC
- S3 → 桶 → Permissions：Block all public access 全开；Bucket policy 里 `AWS:SourceArn` 限定到这一个 distribution

**回答**

1. 为什么不直接用 S3 静态网站托管端点？
2. OAC 和 OAI 的区别？请求是谁签名的？
3. CloudFront 的 403/404 被映射到 `/index.html`，对单页应用意味着什么？
4. 桶策略里的 `AWS:SourceArn` 条件，防住了哪种攻击？

---

## Step 02：内容分发

**新增**：独立内容桶（版本化）、按 hash 命名的不可变路径、`/content/index.json` 禁缓存行为、
`/content/*` 长缓存行为。

**为什么**：Step 01 为了让页面先跑起来，题库是跟前端一起发布的。这一步把它拆开：
内容单独版本化，换题库不影响前端发布，旧版本的缓存也不会被击穿。

**验收**：浏览器能列出三门考试；题目文件第二次加载命中缓存；重新生成内容后 `index.json` 立即变。

**回答**

1. 为什么内容包用 `content/<exam>/<hash>/questions.json` 而不是 `?v=` 查询参数？
2. 同一个 CloudFront distribution 里，两个 S3 origin 如何区分？（看 behaviors）
3. 内容需要鉴权吗？如果不需要，靠什么控制成本？

---

## Step 03：API

**新增**：Lambda（health）、HTTP API、IAM 执行角色。

**为什么**：抽题、判分需要服务端逻辑；先只放一个 `/api/health`，把「CloudFront → API → Lambda」这条链路跑通。

**验收**：`/api/health` 200；CloudWatch 有日志；Lambda 角色只允许写日志。

**回答**

1. HTTP API 与 REST API 的差别？为什么这里选 HTTP API？
2. Lambda 代码怎么"上云"的？（看 S3 里的 SAM 产物桶）
3. 冷启动发生在什么时候？哪些初始化应该放到 handler 外？

---

## Step 04：数据

**新增**：DynamoDB 表（PK/SK + gsi1/gsi2）、会话/作答/统计接口。

**为什么**：记录要跨设备持久化；单表 + 访问模式驱动建模，是 SAA/DOP 的高频考点。

**验收**：完成一次练习后，DynamoDB 里出现 `PROFILE`、`SESSION#`、`ANSWER#`、`TAGSTAT#`、`DAY#`；重复提交同一题不翻倍。

**回答**

1. 为什么「作答」挂在 `USER#<sub>#SESSION#<id>` 下？
2. 「今天该复习」为什么用 GSI 而不是 FilterExpression？
3. 一次交卷要写几个条目？失败会怎样？

---

## Step 05：用户

**新增**：Cognito 用户池、App client、HTTP API 的 JWT 授权器；关闭匿名访问。

**为什么**：数据要按用户隔离；授权器放在 API 层，Lambda 里再校验 `sub`（双保险）。

**验收**：不带 token 401；登录后能刷题；不同用户数据互不可见。

**回答**

1. ID Token 与 Access Token 分别给谁用？
2. 为什么 SPA 的 client 不能有 secret？
3. 授权器校验失败时，请求会到达 Lambda 吗？

---

## Step 06：可观测性

**新增**：日志保留期、CloudWatch 告警（5xx、节流、错误率）、可选 X-Ray。

**验收**：人为制造 500，能在告警和日志里定位到具体 requestId。

---

## Step 07：CI/CD

**新增**：CodeStar Connection（GitHub）、CodePipeline、CodeBuild（`sam build` + 单测 + 部署）、人工审批。

**验收**：push 触发流水线；测试失败阻断部署；dev 自动、prod 需审批。

---

## 关于换掉 SAM

`devops/sam/` 里的模板只描述 AWS 资源，`app/` 不知道它的存在。
换 Terraform 时：

1. 在 `devops/terraform/` 里用 HCL 描述同样的资源
2. 环境变量名保持不变（`TABLE_NAME`、`CONTENT_BUCKET` …）
3. 部署脚本换成 `terraform apply`，`app/` 一行都不用改

这就是把应用和生产环境解耦的实际收益。
