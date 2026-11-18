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
