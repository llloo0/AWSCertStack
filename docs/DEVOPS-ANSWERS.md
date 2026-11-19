# DevOps 学习记录

每一轮部署后，把问题和答案记在这里。答案保留原意，格式统一；我加的更正放在「评审」里。

> **约定**：你只需要在对应问题下面写答案，不用管格式。我校验时统一整理成
> 「我的回答 / 评审」两段：保留你的要点，把错误和补充放进评审。
> 如果答案里有明显的概念错误，我不会直接改掉你的原话，而是在评审里指出。

---

## Increment 0 · 第一个桶

### Q1 栈和资源是什么关系？删栈时桶会怎样？

**我的回答**

- 栈是管理资源生命周期的基本单位，模板里定义的所有资源作为一个逻辑单元统一管理。
- 创建、更新、删除栈，就是对栈内资源整体做创建、更新、删除。
- 创建时任一资源失败，整个栈回滚；删除时某个资源删不掉，栈的删除会卡住。
- 更新是增量的：只改动有差异的资源。
- 删桶取决于 `DeletionPolicy`：默认 `Delete`，但桶非空时删不掉，整个栈会卡住；显式 `Retain` 则保留桶和数据，继续计费。

```yaml
MyBucket:
  Type: AWS::S3::Bucket
  DeletionPolicy: Retain
```

**评审**

- 方向都对。补充一个容易混的点：`DeletionPolicy` 管的是「资源从栈里消失时」（删栈、或从模板里删掉这个资源）；资源被**替换**时管用的是 `UpdateReplacePolicy`。
- 桶非空导致删除失败时，栈会进入 `DELETE_FAILED`，不是自动回滚；清空桶后重新执行 `delete-stack` 即可。
- `DeletionPolicy: Snapshot` 只支持部分资源（RDS、EBS 等），S3 不支持。
- `Retain` 之后桶就脱离 CloudFormation 管理了，后面要么手动删，要么用 import 收回来。

### Q2 `Outputs` 除了给人看，还有什么用？

**我的回答**

- 跨栈引用：用 `Export` 导出、另一个栈用 `Fn::ImportValue` 引用，避免硬编码。
- 程序化获取：`describe-stacks` 拿值，接进脚本或 CI/CD。
- 不能放密码、密钥等敏感信息。

**评审**

- 正确。再补两点：
  - `Export` 名称在「账号 + 区域」内必须唯一；被别的栈 `Import` 期间不能修改或删除这个导出。
  - `Outputs` 是部署期元数据，不适合当应用运行时配置分发；运行时配置放 Parameter Store / AppConfig / S3 更合适。
- 嵌套栈之间传递值，也是靠 `Outputs`。

### Q3 `deploy` 怎么判断这次是创建还是更新？

**我的回答**

- 看栈名是否存在：存在就是更新，不存在就是创建；`samconfig.toml` 会记住栈名。

**评审**

- 判断逻辑对，但命令说错了：这一步用的是 `aws cloudformation deploy`，不是 `sam deploy`。两者都基于 CloudFormation，但 `sam deploy` 多一层打包。
- 更准确的过程：`deploy` 先创建 changeset，再执行。栈不存在 → CREATE 类型；存在 → UPDATE 类型。
- 栈级只有 Create/Update，**changeset 里每个资源**会标 `Add` / `Modify` / `Remove` / `Replace`。
- 模板没变化时 changeset 为空，`--no-fail-on-empty-changeset` 让它不报错。
- 想先看再决定：`--no-execute-changeset`，然后用 `describe-change-set` 查看。
- 更新失败会回滚到上一个稳定状态。

---

## Increment 1 · 把桶收紧

### Q1 四个 `PublicAccessBlock` 开关分别挡住什么？

**我的回答**

- `BlockPublicAcls`：拒绝为桶或对象设置公共 ACL（如 `public-read`）。
- `IgnorePublicAcls`：忽略已经存在的公共 ACL，即使之前设置过也不生效。
- `BlockPublicPolicy`：拒绝任何允许公共访问的桶策略（如 `Principal: "*"`）。
- `RestrictPublicBuckets`：即使存在公共策略，也只允许本账号内的主体和 AWS 服务访问，挡住跨账号访问。
- 四个组合起来相当于「四重锁」，是 AWS 推荐的默认配置。
- 只有确实要公开访问时才需要关闭：静态网站托管要关 `BlockPublicPolicy` / `RestrictPublicBuckets`；
  用对象 ACL 公开单个对象要关 `BlockPublicAcls` / `IgnorePublicAcls`（现在更推荐预签名 URL）。

**评审**

- 四个开关的职责都对。`RestrictPublicBuckets` 更准确的说法是：对「带公共策略的桶」，只允许
  桶所有者账号内的 IAM 主体和 AWS 服务访问，阻止公共策略带来的跨账号访问。
- 补充我们这条路线的前提：**这四个开关全程保持开启**。CloudFront 用 OAC 读私有桶，不需要公开桶；
  OAC 的桶策略只授权给一个具体的 distribution，不属于「公共策略」，所以不会被 `BlockPublicPolicy` 拦。
- 再补一层：Public Access Block 也可以设在**账号级别**，账号级设置会覆盖桶级。
  排查「桶策略为什么存不进去」时，先看账号级有没有开。
- 小校准：静态网站托管关的是 `BlockPublicPolicy` 和 `RestrictPublicBuckets`；
  `BlockPublicAcls` / `IgnorePublicAcls` 可以保持开启（只要不用 ACL 授权）。

### Q2 开版本化之后，删除对象是真删吗？成本怎么算？

**我的回答**

- 普通删除（不带版本 ID）不是真删，而是插入一个删除标记（Delete Marker）；
  对象看起来 404，但历史版本都还在。
- 指定版本 ID 删除才会永久移除那个版本，无法恢复；删掉删除标记可以让对象「复活」。
- 成本按所有版本累计。例：第 1 天 4 GB、第 16 天同名 5 GB，月底约 4×31/31 + 5×16/31 ≈ 6.58 GB-月。
- 不管理的话版本会无限增长，账单持续上升；用生命周期规则把非当前版本转到低成本存储类别，
  或到期永久删除。

**评审**

- 结论都对，例子里的算法也对（按 31 天算）。
- 补充：版本化有三种状态——未启用、`Enabled`、`Suspended`。开启后不能回到「未启用」，只能暂停。
  暂停后新对象版本名为 `null`，此时不带版本 ID 的删除会真的删掉 `null` 版本。
- 补充：生命周期里对应的是 `NoncurrentVersionExpiration` / `NoncurrentVersionTransition`；
  删除标记可以用 `ExpiredObjectDeleteMarker: true` 顺带清理。
- 补充：删除标记本身几乎不占存储，但每次删除都是一次 DELETE 请求，请求费照收。
- 安全相关：可以开 MFA Delete，防止误删版本或关闭版本化（需要 root 凭证）。


## Increment 2 · 加 CloudFront（第一次 403）

### Q1 为什么 CloudFront 读不到私有桶？

**我的回答**

- 没有 OAC/OAI 时，CloudFront 回源请求在 S3 看来就是一个匿名请求，不带任何身份信息。
- 桶是私有的，桶策略里没有允许这个匿名请求的规则，S3 直接返回 403。

**评审**

- 正确。更准确地说，S3 的判定顺序是：显式 Deny → 桶策略 Allow → ACL → 默认拒绝；
  这里没有任何 Allow，所以落到默认拒绝。
- 补充：此时 `PublicAccessBlock` 也在生效，即使想用公共 ACL/策略绕过去，也会被挡住。
- 补充：这个 403 是 S3 生成的（响应头 `server: AmazonS3`），不是 CloudFront 自己拒绝的。

### Q2 如果把桶改成公开，能解决吗？为什么不该这么做？

**我的回答**

- 能解决 403，因为 S3 不再拒绝匿名请求。
- 但任何人都能绕过 CloudFront 直接访问桶里的对象，也失去缓存、WAF、地理限制这些能力。

**评审**

- 正确。补两点：
  - 桶公开意味着要关掉 `BlockPublicPolicy` / `RestrictPublicBuckets`，这是给整个桶开口子，不是只给 CloudFront。
  - 公开后对象可能被直接枚举和下载，外部流量还会放大成本。
- 正确做法：桶保持私有，用 OAC 给 CloudFront 一个最小权限身份。

---

## Increment 3 · OAC + 桶策略

### Q1 OAC 和 OAI 的区别？

**我的回答**

- OAI 是旧方案：一个特殊的 CloudFront 身份，桶策略直接授权给它；
  不支持 2022-12 之后的新区域、SSE-KMS，以及对 S3 的 PUT/POST/DELETE。
- OAC 基于 IAM 服务主体 + SigV4，支持上述场景，是现在的最佳实践；新建直接用 OAC。
- 已有 OAI 可以通过双策略并存平滑迁移。

**评审**

- 基本正确。补充：
  - OAI 的 principal 形如 `arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity ...`；
    OAC 的 principal 是服务 `cloudfront.amazonaws.com`，再加 `AWS:SourceArn` 条件。
  - OAI 本质上是「用一个 CloudFront 专属的 IAM 身份」授权；OAC 是「服务主体 + 签名请求 + 条件」。
  - OAC 能支持 SSE-KMS，核心原因就是它会对请求做 SigV4 签名。
- 小修正：OAI 在部分新区域不可用，AWS 建议这些区域用 OAC；不是所有新区域都绝对不支持。

### Q2 `AWS:SourceArn` 条件防的是哪种攻击？

**我的回答**

- 防混淆代理（confused deputy）：桶策略信任 `cloudfront.amazonaws.com` 这个服务主体，
  如果没有 `SourceArn`，任何账户的 CloudFront 分配都可能利用这个授权读你的桶。
- `SourceArn` 把授权锁定到某个具体的 distribution，S3 会校验签名里的来源 ARN。

**评审**

- 正确。补充：
  - 还可以叠加 `AWS:SourceAccount` 条件，进一步限制到你自己的账号。
  - 条件不匹配时 S3 返回 403，不会执行请求。
  - 这个条件和「桶公开」是两件事：Principal 是服务而不是 `*`，所以 PublicAccessBlock 不会拦。

### Q3 桶策略里为什么用 distribution 的 ARN，而不是域名？

**我的回答**

- 域名不是稳定、可验证的身份；ARN 唯一标识账号下的 distribution，S3 能从签名里校验。
- IAM 条件键期望 ARN 格式，域名不满足。

**评审**

- 正确。补充：
  - 域名可以变（自定义域名、别名），ARN 不变。
  - ARN 里带账号 ID，能证明归属；域名本身不带归属信息。
  - 真正被校验的是 CloudFront 签名请求里的来源信息，S3 用它和策略条件比对。

---

## Increment 4 · 缓存行为

### Q1 为什么 `config.json` 不能缓存？

**我的回答**

- `config.json` 是运行时配置，改了要立刻在应用里生效；缓存会让新配置延迟。
- 它文件小、请求少，缓存带来的收益也低。

**评审**

- 正确。补充一个容易忽略的层次：CloudFront 的 `CachingDisabled` 只控制**边缘节点**，
  浏览器缓存是另一层。当前 `/config.json` 的响应里没有 `Cache-Control`，浏览器可能按
  `Last-Modified` 做启发式缓存，改了配置用户仍可能拿到旧值。
- 所以发布时要在 S3 对象上显式设置 `Cache-Control: no-cache`（Increment 5 会处理），
  不能只依赖 CloudFront 的缓存策略。
- 补充：`CachingDisabled` 的 min/default/max TTL 都是 0，所以每次请求都回源，
  `x-cache: Miss` 就是这个意思。config 请求量小，回源成本可以忽略。

### Q2 为什么失效要单独做？它收费吗？

**我的回答**

- CDN 默认只在 TTL 到期后更新；失效是主动、强制打破等待周期的手段。
- 它收费，但每月有免费额度。

**评审**

- 正确。具体数字：每月前 **1000 条失效路径免费**，超出后约 **$0.005/条**；
  `/*` 只算 1 条。生效通常几十秒到几分钟，不是全球瞬时。
- 失效只清 CloudFront 边缘缓存，**不清浏览器缓存**。
- 更优的策略是内容用带 hash 的不可变路径，换 URL 而不是失效；固定路径
  （`index.html`、`config.json`）才需要失效。
- `CachingOptimized` 默认 TTL 是 86400 秒；如果内容不改名，改完最多要等一天才自然生效。

---

## Increment 5 · 发布脚本

### Q1 为什么用 `aws s3 sync --delete`？不删会怎样？

**我的回答**

- `--delete` 让目标端成为源端的精确副本：目标里有、源里没有的文件会被删除。
- 不删的话，同名文件会被覆盖；如果桶开了版本化，覆盖会新增一个对象版本。

**评审**

- 方向对，但「不删也没事」不准确：残留的是旧 hash 资源和旧版本，会持续占存储；
  如果某个固定路径被复用，还可能新旧内容混在一起。
- `sync --delete` 只作用于当前同步的那个前缀。脚本分别同步 `assets/` 和 `content/`，
  所以根目录的 `index.html`、`config.json` 不会被这两个 sync 删掉——这也是分多次 sync 的原因之一。
- 关键一点：桶开了版本化，`--delete` 删除对象时产生的是**删除标记**，旧版本仍然占存储。
  要真正回收空间，得靠生命周期规则清理非当前版本（`NoncurrentVersionExpiration`、
  `ExpiredObjectDeleteMarker`）。所以「删了」在版本化桶里不等于空间立刻释放。

### Q2 `/*` 失效一次多少钱？多久生效？

**我的回答**

- 按路径计费，`/*` 算 1 条，计入每月 1000 条免费额度。
- 生效通常几秒到 15 分钟。

**评审**

- 正确。补充：
  - 免费额度是账号级、按月；超出后约 $0.005/条。
  - 失效只清 CloudFront 边缘缓存，不清浏览器缓存。
  - 只有固定路径（`index.html`、`config.json`、`content/index.json`）需要失效；
    带 hash 的资源换 URL 就够了。
  - `/*` 适合一次性全清；如果只是改一个文件，精确到那个路径更省额度。

---

## Step 02 · 02.1 第一个 Lambda 函数

### Q1 为什么这次必须 `sam build`，不能直接 `aws cloudformation deploy`？

**我的回答**

- `sam build` 处理源代码和依赖，生成 `sam local` / `sam deploy` 需要的构建产物。

**评审**

- 对，但没答到关键：`aws cloudformation deploy` 只接收模板，它**不理解本地路径**。
  Lambda 的代码必须已经在 S3（或 inline），否则 CloudFormation 不知道去哪拿代码。
- 完整链路是：`sam build` 把函数和层打包到 `.aws-sam/build`；`sam deploy` 把产物上传到 S3，
  把模板里的 `CodeUri` / `ContentUri` 改写成 S3 地址，再调用 CloudFormation 创建 changeset。
- 所以 `sam deploy` ≈ 打包 + 上传 + `aws cloudformation deploy`。
- 反过来说，如果代码已经打包好放在 S3，`aws cloudformation deploy` 也能部署 SAM 模板；
  不能用的只是本地 `CodeUri`。

### Q2 层的 zip 里为什么是 `python/certstack/...`，而不是直接 `certstack/...`？

**我的回答**

- `python/` 是 Lambda Python 运行时的查找路径约定；不按这个结构放，运行时就找不到库。

**评审**

- 对。具体机制：层解压到 `/opt`，Python 运行时会把 `/opt/python` 加进 `sys.path`；
  通过 pip 装到 `/opt/python/lib/python3.12/site-packages` 的依赖也会被加载。
- 这正是本地测试时用 `PYTHONPATH=app/lambda/common/python` 模拟的东西。
- 构建产物 `CommonLayer/python/certstack` 对应运行时的 `/opt/python/certstack`。

### Q3 SAM 给这个函数创建了什么 IAM 角色？权限从哪来？

**我的回答**

- Lambda 执行角色（Execution Role），让函数运行时能以该角色访问其他 AWS 服务，
  比如写 CloudWatch Logs、读 S3。

**评审**

- 对。具体到这次部署：
  - 角色名 `CertStack-dev-HealthFunctionRole-XnIN69B2TGPU`
  - 信任策略：`lambda.amazonaws.com` 可以 `sts:AssumeRole`
  - 附加的托管策略：`AWSLambdaBasicExecutionRole`（CloudWatch Logs 写入）
  - 模板里没写 `Policies`，所以**没有** S3 / DynamoDB 权限；health 函数也不需要
- 以后给函数加 `Policies`（如 `DynamoDBCrudPolicy`、`S3ReadPolicy`），SAM 会往这个角色上
  加内联策略；也可以传 `Role` 用现有角色。
- 查看方式：`aws lambda get-function-configuration` 看 `Role`，
  再用 `aws iam list-attached-role-policies` / `list-role-policies`。

---

## Step 02 · 02.2 暴露成 HTTP API

### Q1 SAM 的 `HttpApi` 事件创建了哪些资源？

**我的回答**

- 从变更集看：`AWS::Lambda::Permission`、`AWS::ApiGatewayV2::Stage`、`AWS::ApiGatewayV2::Api`。

**评审**

- 对。具体是：
  - `AWS::ApiGatewayV2::Api`：HTTP API。路由和 `AWS_PROXY` 集成写在它的 OpenAPI body 里，
    所以栈里看不到单独的 Route / Integration 资源。
  - `AWS::ApiGatewayV2::Stage`：`$default`，`AutoDeploy: true`。
  - `AWS::Lambda::Permission`：允许 `apigateway.amazonaws.com` 调用函数，
    `AWS:SourceArn` 精确到 `.../GET/api/health`。
- Lambda 的执行角色是 02.1 创建的，不在这次变更里。

### Q2 为什么 `curl` 直接打 `execute-api` 域名能通？它和 CloudFront 是什么关系？

**我的回答**

- `execute-api` 是 API Gateway 提供的公开 endpoint，目前还没接 CloudFront，两者没有关系。

**评审**

- 对。补充：
  - `execute-api` 域名本身就是公网入口；CloudFront 以后只是加在它前面的一层，
    负责同源、缓存策略、WAF。
  - 接入 CloudFront 后，直接打 `execute-api` 仍然能通，除非另外用 WAF、资源策略
    或共享密钥头限制它——这是后面要考虑的。
  - 现在没有自定义域名，浏览器跨域访问会涉及 CORS；之后让 `/api/*` 走 CloudFront 同源就没有这个问题。

### Q3 这个接口现在没有鉴权，下一步怎么加？

**我的回答**

- 可以用 Cognito 或者 Lambda token。

**评审**

- 方向对。三种常见方式：
  - **Cognito JWT authorizer**：HTTP API 原生支持，校验 ID/Access Token，最贴合我们的方案（下一步用这个）。
  - **Lambda authorizer**：自定义 token 校验，灵活，但要自己写逻辑和缓存。
  - **IAM 授权（SigV4）**：适合服务间调用，不适合浏览器 SPA。
- API key 只用于用量统计和限流，不是身份认证，不能当鉴权用。
- 加 authorizer 后，路由默认拒绝匿名请求；健康检查可以保留 `Auth: NONE`。
