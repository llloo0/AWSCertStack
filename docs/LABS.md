# 重建 M1：实验课表

M1（登录 → 取题 → 作答 → 统计）已经在 AWS 上跑通过一次，现在**拆掉重来，由你亲手搭**。
课表按 1–1.5 小时一格设计，每格结束都有可验收的产物。

## 合作方式

- 命令你敲，代码你写；我只给目标、约束、验收标准和 review。
- 每格开始前先回答「先回答」里的问题（写下来，不用发给我也行）。
- 卡住超过 20 分钟再问。提问时贴：命令、报错全文、你的假设。
- 我不运行 `cdk deploy`，也不替你改代码。需要我改时，你明确说「你来改」。
- 每格结束后，按下面的模板发我一段，我来挑毛病。

## 每格提交模板

```
1. 我做了什么（3 行以内）
2. 关键输出（cdk diff / synth 摘要、curl 状态码）
3. 我对「先回答」的答案（一条一行）
4. 我卡住的点 / 我还不确定的点
```

## 进度

| Lab | 内容 | 预计 | 状态 |
| --- | --- | --- | --- |
| 0 | 拆掉现有栈，看清删除顺序 | 30 min | ☐ |
| 1 | 私有 S3 + CloudFront + 自动部署 | 1.5 h | ☐ |
| 2 | 内容管道：SQLite → JSON → S3，版本化与缓存 | 1.5 h | ☐ |
| 3 | Cognito 用户池与 SRP 登录 | 1.5 h | ☐ |
| 4 | DynamoDB 单表建模（先手工，再 CDK） | 1.5 h | ☐ |
| 5 | HTTP API + Lambda + JWT 授权器 | 1.5 h | ☐ |
| 6 | 练习闭环：会话 / 作答 / 幂等 / 判分 | 1.5 h | ☐ |
| 7 | 统计与间隔复习：GSI 查询与聚合 | 1.5 h | ☐ |
| 8 | 成本护栏与可重建性 | 45 min | ☐ |

---

## Lab 0：拆掉现状

**目标**：不是「点删除」，而是看懂 CloudFormation 删除时的依赖顺序。

**你要做的**

1. 先在控制台打开 CloudFormation → `CertStack-dev` → 资源列表，记录你认识 / 不认识的资源类型。
2. 执行删除，然后**盯着事件流**直到结束：

   ```bash
   aws cloudformation delete-stack --stack-name CertStack-dev --region ap-northeast-1
   aws cloudformation wait stack-delete-complete --stack-name CertStack-dev --region ap-northeast-1
   ```

3. 删除期间去 CloudFront 控制台看 Distribution 的状态（`Disabling` → `Deleting`）。
4. 结束后确认：

   ```bash
   aws cloudformation list-stacks --region ap-northeast-1 \
     --query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE`].StackName' --output text
   ```

**先回答**

1. 为什么 CloudFront 通常是最后一个删完的？
2. S3 桶里有 15 MB 内容，为什么能直接删掉？（提示：看 `Custom::CDKBucketDeployment` 和桶的 `autoDeleteObjects`）
3. 如果桶里有一份你不想丢的数据，应该改哪个参数？
4. 删除之后，CloudFront 的域名还能访问吗？为什么？

---

## Lab 1：私有 S3 + CloudFront + 自动部署

**目标**：一个「桶私有、只能通过 CDN 访问、路由能回退到 index.html」的静态站，改完代码一条命令上线。

**你会学到**：OAC（取代 OAI）、CloudFront 缓存与失效、SPA 路由回退、BucketDeployment。

**产出**

- `web/`：Vite + React + TS 的最小站点（两个路由：`/` 与 `/practice`）
- `infra/lib/static-site.ts`：一个 Stack
- `cdk deploy` 后拿到 CloudFront 域名

**验收**

| 检查 | 期望 |
| --- | --- |
| `curl -sI https://<domain>/` | 200，且带 `strict-transport-security` |
| 直接访问 `https://<bucket>.s3.ap-northeast-1.amazonaws.com/index.html` | **403** |
| `curl -s https://<domain>/practice` | 返回 index.html（不是 403/404） |
| 改一句文案重新部署 | 1 分钟内能看到 |
| 控制台看 Distribution | 有一个 OAC 关联到桶 |

**先回答**（Lab 1 结束前写下答案）

1. 为什么不用 S3 静态网站托管端点？
2. OAC 和 OAI 的区别是什么？请求是谁签名的？
3. `index.html` 默认会被 CloudFront 缓存多久？改文案后看不到更新，可能是什么原因？
4. `BucketDeployment` 的 `distribution` / `distributionPaths` 参数各自做了什么？
5. 如果明天要接自定义域名，需要在哪些 Region 准备什么？

详细步骤见 [LAB-01.md](LAB-01.md)。

---

## Lab 2：内容管道

**目标**：把 SQLite 题库变成浏览器能直接消费的静态内容，并且「换版本不影响旧缓存」。

**你会学到**：S3 对象键设计、不可变资源 + 长缓存、路径级缓存策略、客户端缓存。

**产出**

- 内容包上传到 S3（`content/<exam>/<hash>/questions.json`）
- 前端能列出三门考试、按考试加载题目
- `/content/index.json` 与 `/content/<exam>/<hash>/*` 使用**不同**的缓存策略

**验收**

- 同一 URL 第二次加载不再走网络（DevTools → Network / 或 IndexedDB 里能看到缓存）
- 重新生成内容后，`index.json` 立即变，旧 hash 的 URL 仍返回旧内容（验证不可变性）
- CloudFront 上 `/content/index.json` 的 TTL 明显短于题目文件

**先回答**

1. 为什么把 hash 放进路径，而不是用 `?v=` 查询参数？
2. 如果题目文件被缓存 1 年，你改了内容怎么让用户看到？
3. 内容包要不要鉴权？为什么？

---

## Lab 3：Cognito 与登录

**目标**：关闭自助注册，管理员建号，前端用 SRP 登录并拿到 ID Token。

**你会学到**：用户池 / 应用客户端 / 令牌（ID vs Access vs Refresh）、SRP 流程、令牌有效期。

**验收**

- 未登录时调 API 得到 401（Lab 5 之后）
- 登录成功后能打印出 ID Token 的 payload，并指出 `sub`、`aud`、`exp` 各是什么
- 用错密码得到明确的失败原因（且不泄露用户是否存在）
- 控制台里能看到该用户，且自助注册是关闭的

**先回答**

1. ID Token 和 Access Token 分别给谁用？这里为什么用 ID Token？
2. SPA 为什么不能有 client secret？
3. SRP 相比「用户名密码直接 POST」多解决了什么问题？
4. token 过期后前端应该怎么做？

---

## Lab 4：DynamoDB 单表

**目标**：先不写代码，在控制台建表、手工塞一条 `PROFILE`，把访问模式想清楚；再用 CDK 固化。

**你会学到**：PK/SK 设计、稀疏 GSI、Query vs Scan、容量模式与免费额度、条件写。

**验收**

- 表结构能支持这 4 个查询（每个都是一次 Query，不是 Scan）：
  1. 我的资料
  2. 我最近 20 次练习
  3. 某次练习的全部作答
  4. 今天该复习的题
- 重复写同一个「作答」不会产生两条记录
- 能在控制台解释：为什么预置 5 RCU/5 WCU 仍在免费额度内

**先回答**

1. 为什么题目内容不放进这张表？
2. 「今天该复习」为什么用 GSI 而不是 FilterExpression？
3. 单表设计里，什么情况下才需要第二个 GSI？
4. 一次交卷要更新会话 + 用户累计 + 标签统计，用事务还是分开写？各有什么代价？

---

## Lab 5：HTTP API + Lambda

**目标**：`GET /api/me` 打通「CloudFront → HTTP API → JWT 授权器 → Lambda → DynamoDB」。

**你会学到**：HTTP API 与 REST API 的差异、JWT 授权器、Lambda 执行角色、冷启动、结构化日志。

**验收**

- 无 token：401；带 token：200 且返回你的资料
- CloudWatch 日志里能看到 `requestId`，并能用它把一次请求串起来
- Lambda 的执行角色权限只有这张表的读写，没有 `*`

**先回答**

1. HTTP API 比 REST API 便宜多少？少了哪些能力？
2. 授权器在 API Gateway 侧校验，Lambda 里还要不要校验 `sub`？
3. Lambda 冷启动时，哪些初始化应该放在 handler 外面？
4. 为什么这个场景不需要 VPC？

---

## Lab 6：练习闭环

**目标**：建会话 → 逐题作答（幂等）→ 交卷判分。

**你会学到**：条件写、幂等键、DynamoDB 保留字、批量写与一致性的取舍。

**验收**

- 同一题提交两次，只计一次
- 交卷分数 = `100 + 正确率 × 900`，与你手算一致
- 交卷接口重复调用不会重复累加
- 练习模式即时返回对错；模考模式不回显

**先回答**

1. 幂等靠什么保证？如果客户端超时重试，服务端怎么识别？
2. 为什么「作答」放 `USER#<sub>#SESSION#<id>` 而不是 `USER#<sub>`？
3. 哪些字段名在 DynamoDB 表达式里必须加别名？

---

## Lab 7：统计与间隔复习

**目标**：标签正确率、近 30 天趋势、今日到期队列。

**你会学到**：稀疏索引、按日期排序键、计数查询、最终一致性。

**验收**

- 答错一题，10 分钟后出现在 `/api/srs/due`
- 标签正确率与手工统计一致
- 控制台里能看到 GSI 上的条目数是普通条目的一部分（稀疏）

**先回答**

1. 稀疏 GSI 省了什么？
2. GSI 是强一致还是最终一致？这会影响「今日待复习」吗？
3. 如果用户量到 10 万，哪些查询会变贵？

---

## Lab 8：成本护栏与可重建性

**目标**：把「删掉再建」变成一条命令，并且账单可解释。

**你会学到**：Budgets、成本标签、CloudFormation 删除策略、备份与恢复。

**验收**

- `npm run down`：先备份 DynamoDB，再销毁全部资源
- 重建后 15 分钟内恢复到可用状态
- Cost Explorer 按 `Project=CertStack` 标签能筛出全部花费
- 有一张自己的「什么资源按月计费」清单

**先回答**

1. 这套架构里，哪些资源即使没人用也按月收钱？
2. 如果忘了删实验资源，最可能烧钱的是哪三个？
3. CloudFormation 的 `RETAIN` 和 `SNAPSHOT` 分别适合什么数据？

---

## 卡住了怎么办

按顺序，每次只升一级：

1. **概念提示**：我告诉你该查哪个服务的哪个文档章节。
2. **结构提示**：我给伪代码或 API 名称，不给完整实现。
3. **对照**：打开 `solution/m1/` 的对应文件，只看 10 行，然后关掉自己写。

`solution/m1/` 是这次已部署实现的归档（已加入 `.gitignore`）。尽量别提前看——
你现在的目标不是「让代码跑起来」，是「能解释为什么它能跑起来」。
