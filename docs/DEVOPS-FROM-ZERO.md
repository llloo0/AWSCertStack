# 部署模板是怎么来的

先回答标题里的问题：**CloudFormation / SAM 模板是手写的。** 没有哪个工具能看一眼前端代码
就自动生成一套符合你需求的资源定义。工具能做的是「脚手架」和「预览」，不是「设计」。

## 模板的四种来源

| 来源 | 谁写 | 产物 | 适合 |
| --- | --- | --- | --- |
| 手写 CloudFormation / SAM | 人 | YAML | 学习、小项目、要精确控制 |
| `sam init` | 工具生成 hello-world 脚手架，人再改 | YAML + 示例函数 | 从零搭 serverless |
| CDK | 人写 TypeScript/Python，`cdk synth` 生成 | 生成的 CFN 模板 | 资源多、要复用和类型检查 |
| IaC Generator | 扫描账号里已有资源，生成模板 | 需要人工整理的 CFN | 接管历史遗留资源 |

补充两点：

- **在控制台点出来的资源不会自动变成模板。** 只有通过 CloudFormation 创建的栈才有模板可看。
- **Terraform 同理**：`.tf` 是人写的，`terraform plan` 只是预览，不是生成。

所以正常的流程不是「先生成模板」，而是：

```
需求 → 写最小模板 → 部署 → 观察结果 → 加一个资源 → 再部署 → 验证 → 提交
```

## 为什么一次只加一个资源

- 每次只引入一个新的失败面，出问题能立刻定位到刚加的东西。
- 每加一个资源，你都要回答：它为什么存在、它的哪个属性对应哪条需求。
- 一次写全不是不行，但那是「照抄」，不是「会写」。

模板里的每一行，要么对应一条需求，要么对应一次踩坑：

| 模板里的东西 | 它从哪来 |
| --- | --- |
| S3 桶 | 「前端文件要有个地方放」 |
| BlockPublicAccess | 「桶不能被公开访问」 |
| OAC + 桶策略 | 「CloudFront 要能读私有桶」 |
| 缓存行为 | 「改了配置，用户不能看到旧版本」 |
| Outputs | 「部署完要拿到域名和桶名」 |

## Step 01 的七个 Increment

模板在 `devops/sam/steps/01-static-web/template.yaml`。Increment 0 已完成，答案记录在 [DEVOPS-ANSWERS.md](DEVOPS-ANSWERS.md)。

---

### Increment 0：一个桶（已完成）

**解决什么**：让 CloudFormation 里出现第一个属于你的资源。

**需要新增**

- `Resources` 下加一个 `AWS::S3::Bucket`，逻辑 ID 叫 `WebBucket`
- `Outputs` 里输出桶名（`!Ref WebBucket`）

**部署**

```bash
aws cloudformation deploy \
  --template-file devops/sam/steps/01-static-web/template.yaml \
  --stack-name CertStack-dev \
  --region ap-northeast-1 --profile certstack \
  --parameter-overrides Env=dev \
  --no-fail-on-empty-changeset
```

**验收**

```bash
aws cloudformation describe-stacks --stack-name CertStack-dev --region ap-northeast-1 \
  --query 'Stacks[0].Outputs' --output table
aws s3api head-bucket --bucket <输出的桶名>
```

**回答**

1. 栈和资源是什么关系？删栈时桶会怎样？
2. `Outputs` 除了给人看，还有什么用？
3. `deploy` 怎么判断这次是创建还是更新？

**回答记录**：[DEVOPS-ANSWERS.md](DEVOPS-ANSWERS.md)

---

### Increment 1：把桶收紧（已完成）

**解决什么**：默认创建的桶不够安全，也不够可追溯。

**需要新增的属性**

- `PublicAccessBlockConfiguration`（四个开关全开）
- `BucketEncryption`（SSE-S3 即可）
- `VersioningConfiguration`（Enabled）
- `Tags`（Project / Env / Stage）

**验收**

```bash
aws s3api get-public-access-block --bucket <桶名>
aws s3api get-bucket-versioning --bucket <桶名>
aws s3api get-bucket-encryption --bucket <桶名>
```

**回答**

1. 四个 PublicAccessBlock 开关分别挡住什么？
2. 开版本化之后，删除对象是真删吗？成本怎么算？

**回答记录**：[DEVOPS-ANSWERS.md](DEVOPS-ANSWERS.md)

---

### Increment 2：加 CloudFront（已完成，403 已验证）

**解决什么**：需要 HTTPS、CDN 和单页应用的路由回退。

**需要新增**

- `AWS::CloudFront::Distribution`
- `Origins`：指向桶的 Regional Domain Name，并且必须声明 origin 类型：
  S3 源要写 `S3OriginConfig: { OriginAccessIdentity: '' }`（先占位，OAC 在下一步加）
- `DefaultCacheBehavior`：`TargetOriginId`、`ViewerProtocolPolicy: redirect-to-https`，
  还要指定缓存策略：`CachePolicyId`（托管的 CachingOptimized）或旧式的 `ForwardedValues`，二选一
- `DefaultRootObject: index.html`
- `PriceClass`（东京用 `PriceClass_200`）

**先放一个测试文件**

部署 CloudFront 之前，先往桶里放一个 `index.html`。这样后面的 403 才能证明是「CloudFront 没权限」，
而不是「文件不存在」：

```bash
echo '<h1>hello certstack</h1>' > /tmp/index.html
aws s3 cp /tmp/index.html "s3://<桶名>/index.html" --region ap-northeast-1
```

**部署**：CloudFront 创建通常 5–8 分钟。等它的状态变成 `Deployed`：

```bash
aws cloudfront wait distribution-deployed --id <DistributionId> --region ap-northeast-1
```

**验收**

```bash
D=$(aws cloudformation describe-stacks --stack-name CertStack-dev --region ap-northeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomain'].OutputValue" --output text)
curl -sI "https://$D/"
```

**这里会失败**：CloudFront 返回 403，即使 `index.html` 确实在桶里。看响应头：
`server: AmazonS3` 说明是 S3 拒绝了请求，`x-cache: Error from cloudfront` 说明 CloudFront 只是把 S3 的错误转回来。
想清楚为什么，再进下一步。

**回答**

1. 为什么 CloudFront 读不到私有桶？
2. 如果这时候把桶改成公开，能解决吗？为什么不该这么做？

---

### Increment 3：OAC + 桶策略（修好 403）（已完成）

**解决什么**：让 CloudFront 以「服务身份」读私有桶，而不是把桶公开。

**需要新增**

- `AWS::CloudFront::OriginAccessControl`（SigningBehavior: always，SigningProtocol: sigv4）
- 在 distribution 的 origin 上引用 `OriginAccessControlId`
- `AWS::S3::BucketPolicy`：Principal 是 `cloudfront.amazonaws.com`，
  Action `s3:GetObject`，Condition `AWS:SourceArn` 限定到你这个 distribution

**验收**

CloudFront 更新和 OAC 生效需要几分钟；而且上一步的 403 可能被 CloudFront 缓存，
测之前先失效一次：

```bash
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths '/*' --region ap-northeast-1
```

```bash
curl -sI "https://$D/" | head -5                                   # 200
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://<桶名>.s3.ap-northeast-1.amazonaws.com/index.html"      # 403
```

**回答**

1. OAC 和 OAI 的区别？
2. `AWS:SourceArn` 条件防的是哪种攻击？
3. 桶策略里为什么用 distribution 的 ARN，而不是域名？

**回答记录**：[DEVOPS-ANSWERS.md](DEVOPS-ANSWERS.md)

---

### Increment 4：缓存行为（已完成）

**解决什么**：`config.json` 改了要立刻生效，题库文件却可以缓存很久。

**需要新增**

- `CacheBehaviors` 三条：
  - `/config.json` → 禁用缓存
  - `/content/index.json` → 禁用缓存
  - `/content/*` → 长缓存
- 用 AWS 托管缓存策略的 ID（在 CloudFront 控制台「Cache policies」能看到）：
  - CachingDisabled：`4135ea2d-6df8-44a3-9df3-4b5a84be39ad`
  - CachingOptimized：`658327ea-f89d-4fab-a63d-7e88639e58f6`

**先放几个测试对象**

让三条行为都有东西可测（部署前、部署后上传都可以）：

```bash
echo '{"stage":"cache-test","v":1}' > /tmp/config.json
aws s3 cp /tmp/config.json "s3://<桶名>/config.json" --region ap-northeast-1

mkdir -p /tmp/content/SAA-C03/test
echo '{"exams":{}}' > /tmp/content/index.json
echo '{"q":1}' > /tmp/content/SAA-C03/test/questions.json
aws s3 cp /tmp/content/index.json "s3://<桶名>/content/index.json" --region ap-northeast-1
aws s3 cp /tmp/content/SAA-C03/test/questions.json "s3://<桶名>/content/SAA-C03/test/questions.json" --region ap-northeast-1
```

**部署后先失效一次**

```bash
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths '/*' --region ap-northeast-1
```

**验收**

```bash
# 连打两次，应该都是 Miss，且没有 age（TTL 为 0，不缓存）
curl -sI "https://$D/config.json" | grep -iE 'x-cache|age'
curl -sI "https://$D/config.json" | grep -iE 'x-cache|age'

# 第一次 Miss，第二次 Hit，并且 age 会增加
curl -sI "https://$D/content/SAA-C03/test/questions.json" | grep -iE 'x-cache|age'
curl -sI "https://$D/content/SAA-C03/test/questions.json" | grep -iE 'x-cache|age'
```

**再做两个实验**

1. 改 `config.json` 的内容重新上传，再请求：应该立刻看到新内容，不需要失效。
2. 改 `questions.json` 的内容重新上传，再请求：应该还是旧内容，直到你手动失效或 TTL 到期。

这两个实验就是「为什么配置不能缓存、内容可以缓存」的答案。

**回答**

1. 为什么 `config.json` 不能缓存？
2. 失效（invalidation）为什么要单独做？它收费吗？

**回答记录**：[DEVOPS-ANSWERS.md](DEVOPS-ANSWERS.md)

---

### Increment 5：发布脚本（脚本已写好，待执行）

**解决什么**：手工上传不可重复，换台机器就做不出来。

脚本：`devops/step-01-static-web.sh`。按顺序做四件事：

1. 构建前端（`npm --prefix app/web run build`）
2. 把题库复制进发布目录，写 `config.json`
3. `aws s3 sync --delete` 上传
4. `aws cloudfront create-invalidation --paths '/*'`

**验收**：改首页一句文案，跑脚本，60 秒内线上能看到。

**发布时注意浏览器缓存**

CloudFront 的 `CachingDisabled` 不管浏览器缓存。上传 `config.json` 时显式带上：

```bash
aws s3 cp app/web/dist/config.json "s3://<桶名>/config.json" \
  --cache-control "no-cache" --content-type application/json --region ap-northeast-1
```

带 hash 的静态资源（`/assets/...`）反过来，可以给 `public, max-age=31536000, immutable`。

**回答**

1. 为什么用 `sync --delete`？不删会怎样？
2. `/*` 失效一次多少钱？多久能生效？

---

### Increment 6（可选）：自定义域名

- ACM 证书必须建在 **us-east-1**（CloudFront 只认这个区域的证书）
- Distribution 加 `Aliases` 和 `ViewerCertificate`
- DNS 侧做 CNAME / Route 53 Alias

**回答**：为什么证书区域必须是 us-east-1？

---

## 部署命令速查

```bash
# 部署（创建或更新）
aws cloudformation deploy \
  --template-file <template.yaml> \
  --stack-name CertStack-dev \
  --region ap-northeast-1 --profile certstack \
  --parameter-overrides Env=dev \
  --no-fail-on-empty-changeset

# 先看变更再决定（不执行）
aws cloudformation deploy ... --no-execute-changeset

# 排查失败
aws cloudformation describe-stack-events --stack-name CertStack-dev \
  --region ap-northeast-1 --max-items 25 \
  --query 'StackEvents[].{t:Timestamp,s:ResourceStatus,r:LogicalResourceId,reason:ResourceStatusReason}' \
  --output table

# 删掉重来（CDN 删除也比较慢）
aws cloudformation delete-stack --stack-name CertStack-dev --region ap-northeast-1
```

## 每次提交前

1. 本地校验：`aws cloudformation validate-template --template-body file://<file>`（不花钱、不创建资源）
2. 看一眼变更集，确认只动了预期的资源
3. `git commit` 里写清楚「为什么加这个资源」，而不只是「加了什么」

## 卡住时

1. 先看 stack events，错误通常在 `ResourceStatusReason` 里
2. 再看对应服务的控制台
3. 20 分钟以上没头绪，去 `solution/reference/step-01-static-web/` 对照——只看跟你当前 increment 有关的那一段
