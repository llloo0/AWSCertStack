# CertStack 规划书

> 一个以 AWS 服务为主干搭建的刷题应用：既是 SAA-C03 / DOP-C02 的备考工具，也是把考试知识点
> 逐个「跑一遍」的实验台。

- 主 Region：`ap-northeast-1`（东京）
- 账号：已有，Free Tier 阶段，费用敏感
- 前端：React + TypeScript + Vite SPA
- IaC / 流水线：AWS SAM（CloudFormation）+ CodePipeline / CodeBuild
- 单人使用（Cognito 里就 1~2 个用户），数据可随时重建

---

## 1. 目标与约束

### 1.1 三层目标

| 层级 | 目标 | 验收方式 |
| --- | --- | --- |
| 产品层 | 能替代现有的「看题-对答案」流程，支持练习、模考、错题复习、按标签统计 | 每天真的用它刷题 |
| 学习层 | 把 SAA-C03 与 DOP-C02 考纲里的服务，在真实项目里各用一次 | 每个里程碑写明「本阶段吃透的考点」 |
| 工程层 | 全部基础设施可代码化重建、可一键销毁、成本可观测 | `sam deploy` / 删栈 双向可逆 |

### 1.2 硬约束

1. **成本**：核心栈待机成本必须接近 0；贵的东西（ALB / Fargate / Aurora / NAT）只放在可随时销毁的实验栈里。
2. **可逆**：任何资源都能用一条命令销毁；用户数据在销毁前自动备份到本地。
3. **东京区**：主 Region 固定 `ap-northeast-1`，避免跨区迁移成本。
4. **单人**：不做运营后台、不做社区、不做付费；但数据模型按多用户设计，未来不用重构。
5. **不重复造轮子**：题目内容不手抄，全部由 SQLite 导出流水线生成。

### 1.3 非目标（明确不做）

- 移动端原生 App（用 PWA 覆盖）
- 多租户 / 组织 / 计费
- 题目编辑器（要改题直接改 SQLite 再重新导出）
- 与真实考试题库同步抓取（只使用现有 DB）

---

## 2. 现有数据分析（实测结果）

对 `aws-quiz.db` 做了完整探查，以下数字都是实际查询结果，不是估计：

| 指标 | 数值 |
| --- | --- |
| 题目总数 | 2,381 |
| 考试 | DVA-C02 931 / SAA-C03 1,019 / DOP-C02 431 |
| 题库集 | 4 个（`aws-dva-original-390`、`dva-c02-examtopics-questions`、`saa-c03-examtopics-questions`、`dop-c02-examtopics-questions`） |
| 单选 / 多选 | 2,033 / 344（另有 4 条 `assessment_type` 为空，已按正确答案数推断） |
| 选项数分布 | 4 项 2,037 题 / 5 项 275 题 / 6 项 69 题 |
| 中文翻译 | 2,378 题（zh-CN） |
| 有解析 | DVA 656 / SAA **0** / DOP **0** |
| 标签 | 109 个标签，7,144 条关联，100 题无标签 |
| 全文索引 | FTS5，可用 |
| 内容体积（导出后） | 14.2 MB 未压缩；gzip 后 SAA 734 KB / DVA 1,087 KB / DOP 396 KB |

### 2.1 这些数字对设计的影响

1. **内容足够小 → 不需要搜索服务。** 单考试 gzip 后 <1.1 MB，直接作为静态 JSON 走 CloudFront，
   浏览器端建索引（MiniSearch）。这样可以省掉 OpenSearch（每月最少 $175 起）和 Aurora 的固定开销，
   同时把 CloudFront 缓存、S3 版本化、PWA 离线这几个考点练扎实。
2. **SAA/DOP 没有解析 → 需要 AI 补全。** 1,450 道题缺解析，这是 Bedrock 最自然的用武之地，
   也让「异步任务 + 队列 + 重试 + 幂等」这一套 DOP 高频考点有了真实场景。
3. **答案来自社区投票 → 必然有错题。** 题里保留了 `community_answer_votes`（如 `A 49 (85%), D 4 (7%)`）。
   设计上要允许「标记存疑 / 纠正答案」，并在 M3 用模型对低票数题目做交叉校验。
4. **`section` 几乎全是 `Topic 1` → 无法直接按考纲域统计。** SAA 的 4 个域、DOP 的 6 个域需要重新归类，
   先用标签 + 关键词规则，再让 Bedrock 按域分类（M3），产出 `studyDomain` 字段。
5. **多选最多 3 个正确项**，选项 4~6 个 → UI 与判分逻辑要支持「少选/多选」两种错法（部分正确提示）。

### 2.2 内容契约（已落地）

`data/export_content.py` 把 SQLite 转成应用使用的不可变内容包：

```
data/dist/content/
├── index.json                     # 有哪些考试、各多少题
├── manifest.json                  # 每个考试的文件、hash、条数、覆盖率
└── SAA-C03/questions.json         # 题目 + 选项 + 中英文本 + 正确答案 + 标签
```

单题结构（节选）：

```jsonc
{
  "id": "130000001",              // 源库稳定 ID，跨版本不变
  "exam": "SAA-C03",
  "type": "single",               // single | multi
  "stem":   { "html": { "en": "...", "zh": "..." }, "text": { "en": "...", "zh": "..." } },
  "options": [{ "key": "a", "html": { "en": "...", "zh": "..." }, "text": { "en": "...", "zh": "..." } }],
  "correct": ["a"],
  "explanation": { "en": "...", "zh": "...", "zhHtml": "..." },
  "tags": ["S3", "Performance"],
  "source": { "url": "...", "answerSource": "Community answer vote", "communityVotes": "A 49 (85%)" },
  "translation": { "available": true, "translator": "assistant" },
  "hash": "…"                     // 内容指纹，用于增量更新与缓存击穿
}
```

导出脚本自带校验：选项数 ≥2、正确答案必须落在选项内、单选恰好 1 个、多选 ≥2 个、
重复题 ID、空题干。当前 **2381 题全部通过**。

内容包放在 S3 的**按 hash 命名的不可变路径**下（`content/<exam>/<hash8>/questions.json`），
天然适合 CloudFront 长缓存，更新时只换 URL，不做全量 invalidation。

---

## 3. 产品范围

### 3.1 M1 就要有的（MVP）

- 登录（Cognito，禁自助注册，管理员建号）
- 首页：今日复习数、连续天数、各考试正确率、最近模考
- 练习模式：按考试 / 题库集 / 标签 / 章节筛选；随机抽题；即时判对错 + 解析 + 中英切换
- 答题记录落库（每道题的作答事件）
- 题型支持：单选、多选（多选必须选满正确项才算对）
- 内容离线缓存（第二次打开不再下载）
- 成本护栏：Budget 告警 + 一键销毁 + 数据备份/恢复

### 3.2 M2 补齐

- 全真模考：65 题 / 130 分钟（SAA），75 题 / 180 分钟（DOP），按域抽题、标记待定、
  交卷判分（100–1000 分制，720 / 750 通过线）、按域得分分析
- 错题本 + 间隔复习（SM-2 简化版）：今天该复习哪些题由服务端算
- 统计：按标签/域的正确率、趋势、薄弱点排行
- 全库搜索（题目文本、解析）
- 题目详情页（含来源与社区投票，便于判断答案可信度）

### 3.3 M3 之后

- AI 解析：为 1,450 道无解析题生成中英解析，人工抽检后入库
- AI 追问：针对某题问「为什么不是 C」，带题面上下文
- 每日推送：EventBridge Scheduler 定时发 SES 邮件「今天 10 题」
- 答案存疑标记与 AI 交叉校验
- 按考纲域自动分类

---

## 4. 架构总览

### 4.1 两条栈：常驻的「核心栈」与可销毁的「实验栈」

这是控制成本的核心设计。**核心栈全部是无固定费用的按量服务，待机 ≈ $0**；
所有按月计费的东西（ALB、Fargate、Aurora、NAT、OpenSearch）只在实验栈里出现，用完就删。

```
                        ┌──────────────────────────────────────────────┐
                        │  浏览器：React SPA + PWA（离线缓存内容）        │
                        └───────────────┬──────────────────────────────┘
                                        │ HTTPS
                        ┌───────────────▼──────────────────────────────┐
                        │  CloudFront（OAC，PriceClass_200）            │
                        └───┬───────────────────────────────┬──────────┘
             /api/*         │                               │  /content/*
        ┌───────────────────▼────────────┐        ┌─────────▼──────────┐
        │ API Gateway HTTP API           │        │ S3 内容桶（私有）    │
        │  JWT 授权器（Cognito）          │        │ 按 hash 不可变路径   │
        └───────────────────┬────────────┘        └─────────┬──────────┘
                            │                               │ 只读
        ┌───────────────────▼────────────┐                  │
        │ Lambda（Node 22 / arm64）       │◄─────────────────┘
        │  sessions / answers / stats    │
        │  srs / bookmarks / content     │
        └───┬───────────┬────────────┬───┘
            │           │            │
   ┌────────▼───┐ ┌─────▼──────┐ ┌───▼──────────────┐
   │ DynamoDB   │ │ SQS + DLQ  │ │ Bedrock          │
   │ 单表 + GSI  │ │ 异步 AI 任务 │ │ （解析生成/追问）  │
   └─────┬──────┘ └─────┬──────┘ └──────────────────┘
         │ Streams      │ 消费者
   ┌─────▼──────────────▼───┐
   │ Lambda 聚合 / 告警       │
   └─────┬──────────────────┘
         │
   ┌─────▼──────────────────────────────────────────┐
   │ CloudWatch：日志 / 指标 / 告警 / Dashboard     │
   └───────────────────────────────────────────────┘
```

**M3 的内容发布流水线**（把 DOP 的 SDLC 考点真正用起来）：

```
S3 上传题库/内容包
   └─► EventBridge ─► Step Functions（内容发布编排）
                        ├─ 校验（Schema + 引用完整性）
                        ├─ Map：逐题补解析（Bedrock，限制并发，失败重试 + 进 DLQ）
                        ├─ 生成 manifest / 分类标签
                        ├─ 发布到 content/<exam>/<hash>/（S3）
                        └─ 更新 DynamoDB 内容指针 + CloudWatch 指标
```

**M4 的 CI/CD**：

```
GitHub ──(CodeStar Connection)──► CodePipeline
      ├─ Source
      ├─ Build  : CodeBuild（sam build / 单测 / 模板校验）
      ├─ Deploy : CodeBuild（sam deploy dev）+ 冒烟测试
      └─ 人工审批 ─► Deploy prod（Lambda 金丝雀 / ECS 蓝绿）
```

### 4.2 关键选型与理由

| 选择 | 理由 | 被否掉的方案 |
| --- | --- | --- |
| **题目内容走静态 JSON + CloudFront** | 15 MB 数据、只读、带 hash 可长缓存；省掉数据库与搜索服务 | OpenSearch（$175+/月起）、Aurora（0.5 ACU 起，约 $43/月） |
| **用户状态走 DynamoDB 单表** | 按量几乎免费、天然按用户分区、Streams 可做实时聚合；单表设计是 SAA/DOP 高频考点 | RDS（固定费用 + 连接管理）、SQLite on EFS（运维重） |
| **API Gateway HTTP API** | $1/百万请求，JWT 授权器开箱即用；REST API 是 $3.5/百万 | REST API（贵、功能用不上）、Lambda Function URL（更便宜但少了路由/授权器/节流，考试相关性低） |
| **Lambda（arm64）** | 免运维、免费额度大；Graviton 比 x86 便宜 20% | Fargate 常驻（实验栈里再对比） |
| **Cognito User Pool** | 考纲必考；托管登录页 + OIDC/PKCE 一次学透 | 自建 JWT 认证（学到的东西少） |
| **SAM / CloudFormation** | 部署即 CFN，和 SAA/DOP 考点完全重合；模板可读、可 diff | CDK（要多一层编译）、Terraform（DOP 考 CFN） |
| **CodePipeline + CodeBuild** | DOP 的 SDLC 域核心 | GitHub Actions（更顺手，但没有 Code* 服务练习） |

### 4.3 为什么不用 AppSync / Amplify / ECS（在主链路里）

- **AppSync**：GraphQL 是加分项，但会让数据访问绕开 DynamoDB 的分区设计，反而学不到单表建模。
- **Amplify Hosting**：抽象层太厚，CloudFront/S3/OAC 的细节被藏起来，而 SAA 恰恰考这些细节。
- **ECS Fargate 常驻**：ALB + 2 个任务约 $30/月起，作为**实验栈**在 M5 里做蓝绿部署对比，不常驻。

---

## 5. AWS 服务清单 × 学习映射

| 服务 | 在本项目里的职责 | 对应考点 | 阶段 |
| --- | --- | --- | --- |
| S3 | 静态站点 + 内容包 + 版本化 + 生命周期 | SAA 存储/安全；DOP IaC 产物 | M1 |
| CloudFront | 前端与 API 统一入口、OAC、缓存策略 | SAA 内容分发、安全 | M1 |
| Cognito | 用户池、托管 UI、JWT 授权器 | SAA 身份认证；DVA 安全 | M1 |
| API Gateway (HTTP API) | 路由、JWT 授权、节流、CORS | SAA 无服务器架构 | M1 |
| Lambda | 全部业务逻辑、arm64、别名 | SAA/DVA 计算 | M1 |
| DynamoDB | 单表设计、GSI、事务、条件写、TTL | SAA 数据库；DOP 弹性 | M1 |
| IAM | 每个函数独立最小权限角色 | 全考纲 | M1 |
| CloudWatch | 结构化日志、自定义指标、告警、Dashboard | DOP 监控与日志 | M1 |
| AWS Budgets + Cost Anomaly Detection | 费用护栏 | 成本优化 | M1 |
| DynamoDB Streams | 答题事件 → 实时聚合 | DOP 事件响应 | M2 |
| SQS + DLQ | AI 任务解耦、重试、死信 | DOP 弹性 | M3 |
| Step Functions | 内容发布编排、Map 并发 | DOP 自动化 | M3 |
| Bedrock | 解析生成、题目分类、追问 | AI 集成（SAA/DOP 新考点） | M3 |
| EventBridge Scheduler + SES | 每日推送 | SAA 集成模式 | M3 |
| X-Ray | 分布式追踪（采样） | DOP 监控 | M2 |
| CodePipeline / CodeBuild | CI/CD | DOP SDLC | M4 |
| CodeDeploy | Lambda 金丝雀 / ECS 蓝绿 | DOP 部署策略 | M4/M5 |
| ECS Fargate + ALB | 实验栈：容器化对比 | DOP 弹性/部署 | M5 |
| Aurora Serverless v2 | 实验栈：关系型对照 | SAA 数据库选型 | M5 |
| Route 53 / DynamoDB Global Tables | 实验栈：多区容灾 | SAA 弹性 | M5 |
| WAF / GuardDuty / Security Hub / Config | 实验栈：安全基线 | DOP 安全合规 | M5 |
| CloudTrail | 审计（默认事件历史免费） | DOP 安全 | M2 |

> 说明：不在主链路里硬塞服务。每个服务都必须有真实职责，否则就是「为了用而用」，
> 反而记不住。

---

## 6. 数据设计

### 6.1 为什么内容不进 DynamoDB

- 内容是**只读、版本化、可重建**的，放 S3 最便宜，且天然 CDN 友好。
- 浏览器拿到的内容包已含答案与解析（个人刷题无防作弊需求），可离线。
- DynamoDB 只存**会变的东西**：用户、会话、作答、复习卡片、书签、统计。
- 服务端对答案时会重新从 S3 读内容包做校验（不信任客户端提交的对错），
  这样既有离线体验，又保证统计可信。

### 6.2 DynamoDB 单表设计

表名：`certstack`，`PK` / `SK` 均为字符串；预置容量 5 RCU / 5 WCU（落在免费额度 25/25 内）
+ Application Auto Scaling 上限 25。GSI 两个，均**稀疏**（只有需要的实体才写属性）。

| 实体 | PK | SK | 说明 |
| --- | --- | --- | --- |
| 用户资料 | `USER#<sub>` | `PROFILE` | 昵称、目标考试、连续天数、总答题数 |
| 用户设置 | `USER#<sub>` | `SETTINGS` | 语言、每日题量、模考偏好 |
| 会话元数据 | `USER#<sub>` | `SESSION#<ulid>` | 考试、模式、开始/结束时间、得分、状态 |
| 作答明细 | `USER#<sub>#SESSION#<ulid>` | `ANSWER#<qid>` | 选项、是否正确、耗时、是否标记 |
| 复习卡片 | `USER#<sub>` | `SRS#<qid>` | 到期时间、间隔、ease、lapses |
| 书签/笔记 | `USER#<sub>` | `BOOKMARK#<qid>` | 备注、创建时间 |
| 标签统计 | `USER#<sub>` | `TAGSTAT#<tag>` | 正确数、总数、最近错题时间 |
| 域统计 | `USER#<sub>` | `DOMAINSTAT#<exam>#<d>` | 同上，按考纲域 |
| 每日活动 | `USER#<sub>` | `DAY#<yyyy-mm-dd>` | 当日答题数、正确率、时长 |
| 内容指针 | `META` | `CONTENT#<exam>` | 当前内容 hash、发布版本、题数 |
| 考试日聚合 | `EXAM#<exam>` | `DAY#<yyyy-mm-dd>` | 全局日统计（由 Streams 写） |

GSI：

| 索引 | 分区键 | 排序键 | 用途 |
| --- | --- | --- | --- |
| `gsi1`（到期队列） | `USER#<sub>#SRS` | `<dueAt ISO>#<qid>` | 查「今天该复习的题」，按到期时间范围查询；只有 SRS 实体写这两个属性，所以是稀疏索引 |
| `gsi2`（按考试取实体） | `<EXAM>#<TYPE>` | `<ts>#<id>` | 每日聚合、全局统计、内容指针扫描 |

**访问模式清单**（先写清单再写代码，是单表设计的正确顺序）：

| # | 需求 | 操作 |
| --- | --- | --- |
| AP1 | 打开首页 | GetItem `USER#sub`/`PROFILE` + Query `SK begins_with DAY#` 取最近 30 天 |
| AP2 | 我的会话列表 | Query `PK=USER#sub, SK begins_with SESSION#`，倒序，Limit |
| AP3 | 某次会话的答题明细 | Query `PK=USER#sub#SESSION#<id>, SK begins_with ANSWER#` |
| AP4 | 今日待复习 | Query GSI1 `PK=USER#sub#SRS, SK <= <今天 23:59>` |
| AP5 | 某题历史 | GetItem `SRS#<qid>` + Query 会话索引？（暂不做，M2 再加） |
| AP6 | 交卷 | TransactWrite：写会话状态 + 更新 PROFILE 计数 + 更新 3~5 条 TAGSTAT |
| AP7 | 标签薄弱点 | Query `PK=USER#sub, SK begins_with TAGSTAT#` 后客户端排序（<109 条） |
| AP8 | 内容版本 | GetItem `META`/`CONTENT#<exam>` |
| AP9 | 全局日统计 | Query GSI2 `PK=EXAM#<exam>#DAY` |

**一致性与幂等**：

- 提交单题作答用 `PutItem` + `ConditionExpression: attribute_not_exists(SK)`，重复提交直接返回 200（幂等）。
- 交卷用事务，避免「会话完成但统计没更新」。
- 所有写操作带 `updatedAt`，便于排查。
- 客户端每次请求带 `Idempotency-Key`（M2 起），服务端存 24h 去重。

### 6.3 复习算法（SRS）

SM-2 简化版，字段：`ease`（初始 2.5，范围 1.3–2.8）、`intervalDays`（1, 3, 7, 16…）、
`dueAt`、`lapses`。

| 结果 | 规则 |
| --- | --- |
| 答对且用时 < 中位数 | `interval *= ease`，`ease += 0.05` |
| 答对但慢 | `interval *= 1.2`，`ease` 不变 |
| 答错 | `interval = 1`，`ease -= 0.2`，`lapses += 1`，当天再次出现 |

M2 先跑通，M5 可以对比 FSRS 的召回率——顺便练离线评估。

---

## 7. API 设计

统一前缀 `/api`，全部走 Cognito JWT（`Authorization: Bearer <id_token>`）。

| 方法 | 路径 | 作用 | 备注 |
| --- | --- | --- | --- |
| GET | `/me` | 资料 + 设置 + 汇总统计 | 首屏一次拿全 |
| PATCH | `/me` | 改语言/目标考试/每日题量 | |
| GET | `/content/index` | 可用考试与内容版本 | 实际内容仍从 CloudFront 静态拿 |
| POST | `/sessions` | 创建练习或模考 | 服务端按筛选条件抽题，返回题目 ID 列表与截止时间 |
| GET | `/sessions?limit=20` | 历史会话 | |
| GET | `/sessions/{id}` | 会话详情（含答案） | |
| PUT | `/sessions/{id}/answers/{qid}` | 提交一题（幂等） | 返回是否正确 + 正确答案 + 解析 |
| POST | `/sessions/{id}/finish` | 交卷 | 事务写统计，返回得分与按域分析 |
| GET | `/srs/due?exam=SAA-C03&limit=20` | 今日待复习 | GSI1 查询 |
| GET | `/stats?exam=SAA-C03` | 标签/域/趋势 | |
| GET/PUT/DELETE | `/bookmarks/{qid}` | 书签与笔记 | |
| POST | `/ai/explain` | 生成/获取解析（带缓存） | 有缓存直接返回，无则入队（M3） |
| POST | `/ai/ask` | 针对某题追问 | M3 |
| GET | `/health` | 健康检查 | 冒烟测试用 |

**错误约定**：`{ "error": { "code": "NOT_FOUND", "message": "…", "requestId": "…" } }`，
HTTP 状态码语义化；所有响应带 `x-request-id`。

**授权**：每个路由都挂 JWT 授权器；Lambda 内再按 `sub` 过滤数据（双保险）。

---

## 8. 前端设计

### 8.1 技术栈

React 19 + TypeScript + Vite + React Router + TanStack Query + Tailwind CSS + Zustand（少量全局状态）
+ `idb-keyval`（内容缓存）+ `minisearch`（本地全文搜索）+ `aws-amplify/auth`（Cognito 登录）。

### 8.2 页面

| 路由 | 页面 | 关键点 |
| --- | --- | --- |
| `/` | 首页 | 今日复习、连续天数、正确率、最近模考 |
| `/practice` | 练习 | 筛选器 + 一题一屏 + 即时反馈 |
| `/exam` | 模考 | 计时器、题目导航、标记、交卷确认 |
| `/exam/:id/result` | 成绩 | 总分、按域、错题清单 |
| `/review` | 复习 | SRS 队列、错题本 |
| `/stats` | 统计 | 标签正确率、趋势图、薄弱点 |
| `/bank` | 题库 | 列表 + 全文搜索 + 标签筛选 |
| `/settings` | 设置 | 中英、目标考试、每日题量、销毁/备份说明 |

### 8.3 体验要点

- **中英切换**是全站级的：题干、选项、解析都读 `<lang>` 字段，缺失时回退英文并提示。
- **作答即持久化**：每题提交后写本地队列，失败自动重试，断网也不丢。
- **键盘优先**：`1-6` 选项、`Enter` 提交、`→` 下一题、`F` 标记。
- **移动端可用**：单手操作，底部固定操作条。
- **题目状态**：未答 / 已答对 / 已答错 / 已标记，导航条色块显示。

### 8.4 内容加载与缓存

1. 启动时 `GET /content/index` 拿到各考试当前 hash。
2. 若 IndexedDB 中已有该 hash 的题目，直接读本地；否则从 CloudFront 拉取并写入。
3. 首次构建 MiniSearch 索引（约 1k 题 <100ms），之后缓存索引 JSON。
4. Service Worker 预缓存 App Shell，实现「断网也能刷昨天加载过的题」。

---

## 9. 成本模型与护栏

### 9.1 核心栈稳态成本（单人，假设每月 2 万次 API 调用）

| 服务 | 用量假设 | 月成本 |
| --- | --- | --- |
| CloudFront | 20 GB 出网 / 50 万请求 | **$0**（永久免费额度 1 TB + 1000 万请求） |
| S3 | 30 MB 存储 + 少量请求 | < $0.01 |
| Lambda | 2 万次调用，arm64 128 MB × 200 ms | **$0**（永久免费 100 万次 + 40 万 GB-s） |
| DynamoDB | 预置 5/5，存储 <1 GB | **$0**（永久免费 25 GB + 25/25） |
| API Gateway HTTP API | 2 万请求 | ~$0.02 |
| Cognito | 1–2 个 MAU | **$0**（≤1 万 MAU） |
| CloudWatch | 10 个指标 / 10 个告警 / 1 GB 日志 | ~$0.60 |
| SQS / SNS / Step Functions（M3） | 几万次 | < $0.10 |
| Bedrock（M3，一次性） | 1,450 题补解析 | **一次性 $3–6**（用 Haiku 级模型；批量推理可再省一半） |
| **合计** | | **每月 < $1** |

> Free Tier 有两种：2025-07-15 之前创建的账号是「12 个月试用 + 永久免费清单」，
> 之后创建的是「$200 信用额度 / 6 个月 + 永久免费清单」。上表中 CloudFront、Lambda、
> DynamoDB、SQS、SNS、CloudWatch 对两种账号都永久免费；S3、API Gateway、SES 的免费额度
> 与账号类型有关，但本项目用量下即使不免费也只有几美分。建议部署前在
> Billing → Free Tier 页面确认账号类型。

### 9.2 为什么实验栈必须可销毁

| 资源 | 待机月成本 | 一次 2 小时实验的成本 |
| --- | --- | --- |
| ALB | ~$18 | ~$0.05 |
| ECS Fargate（0.5 vCPU / 1 GB） | ~$19 | ~$0.05 |
| Aurora Serverless v2（0.5 ACU） | ~$43 | ~$0.12 |
| NAT Gateway | ~$33 | ~$0.09 |
| CodePipeline | ~$1/流水线 | 常驻（可接受） |
| CodeBuild（general1.small） | 按分钟 $0.005 | 100 次构建 × 3 分钟 ≈ $1.5 |

### 9.3 五层护栏（部署第一周就全开）

1. **AWS Budgets**：`CertStack` 月度预算 $5，50% / 80% / 100% 三档邮件告警。
2. **Cost Anomaly Detection**：免费，按服务维度检测异常。
3. **标签**：所有资源 `Project=CertStack`、`Env=dev|prod`、`Owner=li`，Cost Explorer 按标签筛选。
4. **架构约束**：核心栈不允许出现 ALB / NAT / Aurora / OpenSearch；模板里用 cfn-lint 或自定义
   aspect 做「禁用资源清单」检查，synth 阶段就报错。
5. **一键销毁 + 备份**：
   - `npm run down`：先备份 DynamoDB 到 `var/backups/<ts>.json.gz`，再删除 CloudFormation 栈。
   - `bash scripts/deploy.sh`：重建 + 恢复数据。
   - 实验栈单独 `npm run lab:up` / `npm run lab:down`。

---

## 10. 交付路线图

**应用与部署分离**：`app/` 只认环境变量和构建产物，`devops/` 描述 AWS 资源。
M1 的部署不是一次完成，而是按 `devops/step-0N-*.sh` 逐步长出来（见 [DEPLOY-STEPS.md](DEPLOY-STEPS.md)）：
静态站点 → 内容分发 → API → 数据 → 用户 → 可观测性 → CI/CD。
这样每一步只引入一个新的失败面，也便于换掉 IaC 工具而不碰应用代码。

每个里程碑都以「能部署、能验收、能讲清原理」为准，不追求一次做完。
M1 的具体实验步骤见 [LABS.md](LABS.md)。

### M0 仓库与内容管道（已完成）

- 仓库骨架、`data/export_content.py`、内容包生成与校验、规划文档
- 额外完成：内容包导出脚本与校验（SAM 模板与 Python Lambda 由归档实现提供参考）
- **验收**：`python3 data/export_content.py` 输出 2381 题、0 校验错误；`npm test` 4/4 通过；`npm run synth` 本地合成成功
- 成本：$0（未上云）

### M1 核心闭环（已实现，SAM + Python；部署由你执行，见 docs/LABS.md）

- SAM：**单栈 `CertStack-dev`**（template.yaml 描述全部资源）
- Lambda：`me`、`sessions`、`answers`、`finish`、`health`（TypeScript + Powertools）
- 前端：登录、练习模式、首页统计、内容缓存
- 运维：Budget 告警、CloudWatch 告警、`up/down/backup` 脚本
- **验收**：
  1. `sam deploy` 成功，拿到 CloudFront 域名；
  2. 用 Cognito 管理员创建的账号登录；
  3. 完成 10 道练习，刷新后统计仍在；
  4. `npm run down` 后资源全清，`npm run up` 能恢复；
  5. 当月账单新增 < $1。
- 学到：CloudFront + OAC、Cognito 授权码流、JWT 授权器、Lambda 冷启动、
  DynamoDB 单表 + 稀疏 GSI、条件写、IAM 最小权限、CloudFormation 变更集。

### M2 模考、复习与可观测性

- 模考（服务端抽题、计时、交卷判分）、SRS、错题本、统计页、全库搜索
- DynamoDB Streams → 聚合 Lambda；CloudWatch Dashboard + 告警；X-Ray 采样
- **验收**：模考能复现「730 分」这类结论；人为制造 5xx 能在 Dashboard 看到；
  告警邮件能收到。
- 学到：流处理幂等、指标与告警设计、分布式追踪、容量模式。

### M3 AI 内容管道

- S3 上传 → Step Functions → Bedrock 补解析（Map + 并发 + 重试 + DLQ）
- 解析结果人工抽检 → 发布新内容版本
- SQS 异步任务 + 死信队列；EventBridge Scheduler + SES 每日推送
- **验收**：1,450 道无解析题中至少 1,200 道产出可用解析；注入一条坏数据后
  能在 DLQ 里看到并重放；每天 8:00 收到邮件。
- 学到：异步编排、幂等、退避重试、模型调用成本控制、批量推理。

### M4 CI/CD 与多环境

- GitHub → CodeStar Connection → CodePipeline（Source / Build / Deploy dev / 审批 / Deploy prod）
- CodeBuild 跑 `sam build` + `sam deploy`；构建缓存；产物走 S3
- Lambda 金丝雀（CodeDeploy，10% → 5 分钟 → 100%）
- **验收**：推一个 PR 触发流水线；故意让测试失败能阻断部署；金丝雀阶段能回滚。
- 学到：DOP 的 SDLC 自动化、部署策略、制品与版本、环境隔离。

### M5 DOP 深水区（实验栈，用完即删）

- ECS Fargate + ALB 版「解析服务」，CodeDeploy 蓝绿部署，与 Lambda 版对比
- Aurora Serverless v2 装同一批题，跑 SQL 分析，对比 DynamoDB 的查询模式
- 韧性演练：多可用区、DynamoDB 全局表、S3 跨区复制、Route 53 故障转移
- 安全与事件响应：CloudTrail + GuardDuty + Security Hub + Config 规则，
  EventBridge 自动修复「S3 被公开」；WAF 加在 CloudFront 上
- **验收**：每个实验都能在 2 小时内完成并销毁；写一份「演练记录」文档。
- 学到：DOP 的弹性、事件响应、安全合规、成本取舍。

---

## 11. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 忘记销毁实验栈 | 每月多出几十美元 | 预算告警 + 实验栈专用标签 + 可选「TTL 自动销毁」（EventBridge Scheduler 触发 Lambda，24h 后 destroy 并邮件确认） |
| 社区答案本身有错 | 学错知识点 | 展示社区投票；低票数题标「存疑」；M3 用模型交叉校验；允许手动纠正（存到 DynamoDB，不改内容包） |
| Bedrock 模型/区域不支持 | M3 卡住 | 部署时用 `aws bedrock list-foundation-models` 动态发现；东京没有就开跨区推理配置（需评估数据合规） |
| 冷启动导致首屏慢 | 体验差 | Lambda arm64 + 精简依赖 + 预置并发（按需，成本极低）；前端乐观 UI |
| DynamoDB 单表设计返工 | 迁移痛苦 | 先写访问模式清单（本文档 6.2），M1 只实现 AP1–AP4、AP6，M2 再扩展 |
| 成本失控于日志 | CloudWatch 费用 | 日志保留 7 天；只记录结构化必要字段；生产日志采样 |

---

## 12. 现在需要你做的事（M1 前置）

> ⚠️ **Free plan 账号不要为了 SSO 去创建 AWS Organizations。** 官方文档明确：Free account plan
> 会在加入/创建 Organizations 时**自动升级为按量付费计划**（[Choosing a plan](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html)），
> IAM Identity Center 文档更直接写明免费额度会立即失效
> （[Enable IAM Identity Center](https://docs.aws.amazon.com/singlesignon/latest/userguide/enable-identity-center.html)）。
>
> 而单账号、不开 Organizations 时，Identity Center 只能创建 **account instance**，它**不支持
> multi-account permissions / 账号访问门户**（[实例类型对比](https://docs.aws.amazon.com/singlesignon/latest/userguide/identity-center-instances.html)），
> 没有 permission set 可分配给账号，所以 `aws configure sso` 一定会报
> `No AWS accounts are available to you`。这不是配置错误，是能力限制。

推荐改用 CLI 自带的 `aws login`：用控制台凭证换临时凭证，**不需要 Organizations、不落地长期 AK/SK**，
每 15 分钟自动续期，会话最长 12 小时（[官方文档](https://docs.amazonaws.cn/en_us/cli/latest/userguide/cli-configure-sign-in.md)）。
要求 CLI ≥ 2.32，当前是 2.40.3，满足。

1. **建一个专用 IAM 用户（推荐，不要用 root 日常操作）**
   - IAM → Users → Create user，勾选 console access，设置强密码 + MFA
   - 附加两个托管策略：`AdministratorAccess`（个人实验账号够用）和 `SignInLocalDevelopmentAccess`（`aws login` 必需）
   - 若临时用 root 登录 `aws login`，则无需额外策略，但仅建议用于创建上面的 IAM 用户

2. **登录并验证**
   ```bash
   aws configure set region ap-northeast-1 --profile certstack
   aws login --profile certstack          # WSL 里浏览器没弹出就加 --remote，复制 URL 到 Windows 浏览器
   aws sts get-caller-identity --profile certstack
   ```
   登录后 `~/.aws/config` 里会出现 `login_session = arn:aws:iam::<account>:user/<name>`；
   退出用 `aws logout --profile certstack`。

3. **确认 Region**：`aws configure get region --profile certstack` 应为 `ap-northeast-1`

4. **看一次 Free Tier 状态**：Console → Billing → 确认是 Free plan 还是 Paid plan、剩余 credits。
   Free plan 会在 6 个月或额度用尽时到期并自动关号；本项目核心栈每月 < $1，到期前升级 paid 即可继续。

5. **告诉我是否要自定义域名**（默认用 CloudFront 免费域名，$0；自定义域名需要 Route 53 托管区约 $0.5/月 + ACM 证书）。

**如果你已经创建了 Organizations**（那 free plan 可能已经升级）：先看 Billing 确认；
然后按正常 SSO 修复——Identity Center → Permission sets → Create（AdministratorAccess）→
AWS accounts → 选账号 → Assign users → 选用户 + 该 permission set → 等 1~2 分钟生效。
删除 Organization 不会把账号退回 Free plan，升级是单向的。
