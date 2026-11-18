# DevOps 学习记录

每一轮部署后，把问题和答案记在这里。答案保留原意，格式统一；我加的更正放在「评审」里。

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

（完成部署后补答案）
