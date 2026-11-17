# M1 部署与观察手册

M1 的代码已经写好（SAM 模板 + Python Lambda + React 前端）。这一份手册只关心 **AWS 侧**：
怎么部署、部署后看什么、为什么这样选、怎么破坏再修好。

节奏建议：一次一节，30–45 分钟。每节结束，用自己的话回答末尾的问题；
答不上来的，就是下一节要补的。

---

## 0. 部署一次（30–45 分钟）

```bash
bash scripts/setup.sh      # 一次性：Python venv + SAM CLI + 前端依赖
bash scripts/deploy.sh
```

`deploy.sh` 做了 5 件事，逐段看终端输出：

| 步骤 | 命令 | 发生了什么 |
| --- | --- | --- |
| 1 | `python3 data/export_content.py` | SQLite 题库 → `data/dist/content` 静态包 |
| 2 | `sam build` | 把 Python 代码和 layer 复制到 `.aws-sam/build` |
| 3 | `sam deploy` | 上传构建产物到 S3 → 生成 CloudFormation **changeset** → 你确认 → 执行 |
| 4 | `npm --prefix web run build` | 前端打包，并写入 `config.json`（池 ID、API 地址） |
| 5 | `aws s3 sync` + `create-invalidation` | 上传前端/内容，刷新 CloudFront 缓存 |

**在控制台看什么**

1. CloudFormation → `CertStack-dev` → **Events**：注意资源创建顺序（S3 → Cognito/DynamoDB → API → CloudFront → BucketPolicy）。
2. 同一页 → **Resources**：数一下有多少资源，认出哪些是 Lambda、哪些是 CloudFront。
3. **Outputs**：`AppUrl`、`UserPoolId`、`ApiEndpoint`。

**回答**

1. `sam build` 和 `sam deploy` 分别在哪一步用到 S3？为什么 Lambda 代码必须先上传 S3？
2. changeset 里的 `Add` 列表，哪几个资源创建最慢？为什么？
3. 为什么 BucketPolicy 出现在 CloudFront 之后？（提示：策略里引用了什么）
4. 如果 `sam deploy` 中途失败，CloudFormation 会怎么处理已经创建的资源？

---

## 1. 资源巡览：每个东西为什么在这（30 分钟）

按这个顺序点一遍控制台，每到一个服务，先猜「它为什么需要」，再看模板里对应的代码。

| 控制台 | 看什么 | 对应模板 |
| --- | --- | --- |
| CloudFront → Distribution | Origins（3 个）、Behaviors（5 条）、OAC | `Distribution` |
| S3 → 两个桶 | 都是私有、版本化；桶策略只允许 CloudFront | `WebBucket` / `ContentBucket` |
| Cognito → 用户池 → App client | 自助注册关闭、SRP、无 secret | `UserPool` / `UserPoolClient` |
| API Gateway → APIs | 路由列表、JWT 授权器、默认授权 | `HttpApi` |
| Lambda → 4 个函数 | 运行时、架构、环境变量、执行角色 | `*Function` |
| DynamoDB → 表 | PK/SK、两个 GSI、预置容量 | `Table` |

**回答**

1. 这三个 S3 桶策略里，`AWS:SourceArn` 条件防住了什么攻击？
2. 为什么 Lambda 的环境变量里要放 `CONTENT_BUCKET`，而不是把题目塞进数据库？
3. API Gateway 的 JWT 授权器校验失败时，请求会到达 Lambda 吗？
4. DynamoDB 的 5 RCU/5 WCU 为什么仍然在免费额度内？两个 GSI 各占多少？

---

## 2. 分发与缓存（45 分钟）

```bash
D=$(aws cloudformation describe-stacks --stack-name CertStack-dev --region ap-northeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomain'].OutputValue" --output text)
B=$(aws cloudformation describe-stacks --stack-name CertStack-dev --region ap-northeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='WebBucketName'].OutputValue" --output text)

curl -sI "https://$D/" | grep -iE 'x-cache|age|cache-control|strict-transport'
curl -sI "https://$D/practice" | head -3
curl -s -o /dev/null -w '%{http_code}\n' "https://$B.s3.ap-northeast-1.amazonaws.com/index.html"
curl -sI "https://$D/content/index.json" | grep -i cache
curl -sI "https://$D/content/SAA-C03/<hash>/questions.json" | grep -i cache
```

**实验 A：不刷新缓存会怎样**

1. 记下首页 `x-cache`（第一次多半是 `Miss from cloudfront`），再请求一次变成 `Hit`。
2. 不改任何文件，等 5 分钟后看 `age` 是否增长。
3. 手动失效：`aws cloudfront create-invalidation --distribution-id <ID> --paths '/*'`，再请求一次。

**实验 B：OAC 到底做了什么**

```bash
aws s3api get-bucket-policy --bucket "$B" --query Policy --output text | python3 -m json.tool
```

把策略里的 `AWS:SourceArn` 条件临时删掉（在控制台改），再访问 CloudFront，观察是否仍然 200；
然后访问 `https://$B.s3.../index.html` 是否变成了 200。改完记得用 `bash scripts/deploy.sh` 恢复。

**回答**

1. `index.html` 默认缓存多久？`/content/index.json` 为什么单独禁用缓存？
2. 题目文件为什么可以缓存一年？内容更新时旧文件怎么办？
3. OAC 和「把桶设为 public」相比，安全边界差在哪？
4. CloudFront 的 403/404 被映射成 `/index.html`，这对单页应用意味着什么？代价是什么？

---

## 3. 认证链路（30 分钟）

```bash
POOL=$(aws cloudformation describe-stacks --stack-name CertStack-dev --region ap-northeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
CLIENT=$(aws cloudformation describe-stacks --stack-name CertStack-dev --region ap-northeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text)

bash scripts/create-user.sh li
bash scripts/smoke-test.sh li '<密码>'
```

**实验：把 ADMIN_USER_PASSWORD_AUTH 关掉**

控制台 → Cognito → 用户池 → App client → Authentication flows → 取消勾选 `ALLOW_ADMIN_USER_PASSWORD_AUTH`，
保存后立刻重跑 `smoke-test.sh`，记下报错。然后加回来。

**回答**

1. 浏览器登录用的是 SRP，`smoke-test.sh` 用的是 ADMIN_USER_PASSWORD_AUTH，两者差别是什么？
2. 冒烟脚本里的 ID Token 被 API Gateway 校验了哪些字段？（看授权器的 JWT 配置）
3. 为什么 SPA 的 App client 不能有 secret？
4. ID Token 和 Access Token，哪个适合给 API 用？为什么？

---

## 4. 数据层（45 分钟）

控制台 → DynamoDB → `certstack-dev` → Explore items / PartiQL。

先跑一组练习制造数据，然后：

```bash
# 看某个用户的所有条目
aws dynamodb query --table-name certstack-dev --region ap-northeast-1 \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"USER#<sub>"}}' \
  --query 'Items[].{sk:SK.S,entity:entity.S}' --output table

# 看 GSI1（到期队列）
aws dynamodb query --table-name certstack-dev --region ap-northeast-1 \
  --index-name gsi1 \
  --key-condition-expression "gsi1pk = :pk" \
  --expression-attribute-values '{":pk":{"S":"USER#<sub>#SRS"}}' --output table
```

**实验 A：手工改容量**

控制台把表改成 On-demand，再改回 Provisioned 5/5。然后用 `bash scripts/deploy.sh` 看 CloudFormation 是否把
你的手工修改"纠正"回来（这就是 drift）。

**实验 B：哪一步是条件写**

在 `sessions` Lambda 里打断点不现实，改看代码：`lambda/sessions/app.py` 搜 `ConditionExpression`。
重复提交同一题，观察统计是否翻倍（不应该）。

**回答**

1. 为什么「作答」放在 `USER#<sub>#SESSION#<id>` 下，而不是都塞进 `USER#<sub>`？
2. 「今天该复习」为什么用 GSI，而不是 `Scan` + `FilterExpression`？
3. 一次交卷会更新几个条目？如果中间失败，会出现什么不一致？
4. 单表设计里，什么情况下才值得加第二个 GSI？

---

## 5. 故障、漂移与回滚（45 分钟）

**看日志**

```bash
aws logs tail /aws/lambda/certstack-dev-sessions --follow --region ap-northeast-1
```

**实验 A：手工改坏环境变量**

```bash
aws lambda update-function-configuration --function-name certstack-dev-sessions \
  --environment "Variables={TABLE_NAME=wrong-table}" --region ap-northeast-1
```

再调用一次 API（浏览器或 smoke），看 500 与日志里的 `ResourceNotFoundException`。
然后 `bash scripts/deploy.sh`，CloudFormation 会把变量改回来——手工修改 vs IaC。

**实验 B：观察一次失败的部署**

把 `template.yaml` 里 `HealthFunction` 的 `MemorySize` 改成 `99`（低于最小值），`sam deploy`，
看 changeset 失败、栈回滚、旧资源是否保留。改回 128 再部署。

**回答**

1. Lambda 的 500 和 API Gateway 的 5xx，在 CloudWatch 里分别看哪个指标？
2. 为什么手工改 Lambda 环境变量后，下一次 `sam deploy` 会覆盖它？
3. 部署失败回滚时，已经更新成功的资源会怎样？
4. 想快速定位一次慢请求，应该看日志、指标还是 X-Ray？为什么？

---

## 6. 成本与销毁（30 分钟）

1. Cost Explorer 按 `Project=CertStack` 过滤（标签数据有延迟，第二天再看）。
2. 估算：CloudFront 出网、Lambda 调用、DynamoDB 读写各花了多少？哪个是 0？
3. 在 Billing → Budgets 建一个 $5 月度预算（需要邮箱）。
4. 销毁：

```bash
bash scripts/down.sh
aws cloudformation list-stacks --region ap-northeast-1 \
  --query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE`].StackName' --output text
```

**回答**

1. 删栈之后，还有哪些东西在收钱（或不收钱）？SAM 的产物桶、CloudWatch 日志、CDKToolkit 分别怎么处理？
2. 如果忘了删，哪三个资源最可能持续产生费用？
3. `down.sh` 先备份再删，备份的是什么格式？怎么恢复？

---

## 7. 下一步：CI/CD（M4）

现在部署是「本地跑脚本」。下一步要把它变成：

```
GitHub push → CodePipeline → CodeBuild（sam build + 单测）→ 部署 dev → 人工审批 → 部署 prod
```

在 M4 之前，先能回答：

1. CodeBuild 里跑 `sam deploy` 需要什么权限？和本地跑有什么不同？
2. 为什么流水线里的构建产物要放 S3，而不是每次重新打包？
3. dev 和 prod 两个栈如何隔离？（栈名、参数、IAM）
4. 回滚应该由谁触发——人还是流水线？CloudFormation 的回滚和代码回滚有什么不同？
