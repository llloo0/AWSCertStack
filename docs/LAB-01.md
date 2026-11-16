# Lab 1：私有 S3 + CloudFront + 自动部署

预计 1.5 小时。目标：一个桶私有、只能经 CDN 访问、SPA 路由能回退、改完代码一条命令上线的静态站。

---

## 0. 前置检查（5 分钟）

```bash
aws sts get-caller-identity --profile certstack
aws configure get region --profile certstack      # 应该是 ap-northeast-1
node -v                                           # >= 22
(cd infra && npx cdk --version)
```

如果 `cdk` 报找不到，先在仓库根目录跑一次 `npm install`（此时 `web/` 还不存在也没关系，
npm 会先只链接 `infra`）。

> 现在执行 `cd infra && npx cdk synth` 会报 “This app contains no stacks”，这是正常的——
> 你还没有在 `bin/app.ts` 里实例化任何 Stack。

---

## 1. 建前端骨架（20 分钟）

在仓库根目录：

```bash
npm create vite@latest web -- --template react-ts
npm install                      # 在仓库根目录，让 web 成为 workspace 的一部分
npm install react-router-dom -w web
```

> 如果 `create-vite` 问你用不用 rolldown-vite，选 No（实验特性，先不碰）。

改两处：

1. `web/src/App.tsx`：用 `BrowserRouter` 放两个路由，`/` 显示「首页」，`/practice` 显示「练习页」。
2. 删掉 Vite 默认的 `App.css` 里用不上的样式（可选）。

本地验证：

```bash
npm run dev -w web     # 打开 http://localhost:5173 和 /practice 都能看到页面
npm run build -w web   # 生成 web/dist
```

> 记住：`web/dist` 是后面 CDK 打包上传的源目录。每次改前端都要重新 build。

---

## 2. 写第一个 Stack（40 分钟）

在 `infra/lib/` 新建 `static-site.ts`，导出一个 `Stack`。它需要做四件事：

### 2.1 私有桶

用 `aws-cdk-lib/aws-s3` 的 `Bucket`，属性至少包含：

| 属性 | 值 | 为什么 |
| --- | --- | --- |
| `blockPublicAccess` | `BlockPublicAccess.BLOCK_ALL` | 桶永远不公开 |
| `enforceSSL` | `true` | 拒绝 http 请求 |
| `autoDeleteObjects` | `true` | 删栈时自动清空（dev 方便） |
| `removalPolicy` | `RemovalPolicy.DESTROY` | dev 能一键删干净 |

### 2.2 CloudFront

用 `aws-cloudfront-origins` 的 `S3BucketOrigin.withOriginAccessControl(bucket)` 作为源，
它会自动帮你建 OAC 并写好桶策略——**不要**自己开静态网站托管，也不要把桶设成 public。

`Distribution` 的关键属性：

- `defaultRootObject: 'index.html'`
- `defaultBehavior`: 上面那个 origin + `viewerProtocolPolicy: REDIRECT_TO_HTTPS` + 一个缓存策略
- `priceClass: PriceClass.PRICE_CLASS_200`（美/欧/亚，东京够用且便宜）
- `functionAssociations`: 挂一个 CloudFront Function 做 SPA 回退

### 2.3 SPA 回退 Function

用 `cloudfront.Function` + `FunctionRuntime.JS_2_0`，代码大致是：

```js
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  // TODO: 三个分支
  // 1) 以 "/" 结尾          -> 拼上 index.html
  // 2) 路径里没有 "."       -> 改写成 /index.html
  // 3) 其他（有扩展名）     -> 原样返回
  return request;
}
```

判断「没有扩展名」可以用 `uri.lastIndexOf('.') < uri.lastIndexOf('/')`。

### 2.4 部署静态资源

用 `aws-cdk-lib/aws-s3-deployment` 的 `BucketDeployment`：

- `sources: [Source.asset(path.join(__dirname, '../../web/dist'))]`
- `destinationBucket: bucket`
- `distribution` + `distributionPaths: ['/*']`

最后加两个 `CfnOutput`：`DistributionDomain` 和 `BucketName`，后面验收要用。

### 2.5 接到 app 入口

在 `infra/bin/app.ts` 里实例化，栈名用 `CertStack-dev`，`env` 用文件里已经写好的那个对象。

---

## 3. 部署与验收（25 分钟）

```bash
npm run build -w web

cd infra
npx cdk diff        # 先看模板差异，确认只创建你预期的资源
npx cdk deploy
```

部署时观察终端里的资源顺序。CloudFront 创建通常要 3–8 分钟，这期间可以去控制台看 Distribution 的状态。

验收：

```bash
D=$(aws cloudformation describe-stacks --stack-name CertStack-dev --region ap-northeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomain'].OutputValue" --output text)
B=$(aws cloudformation describe-stacks --stack-name CertStack-dev --region ap-northeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)

echo "domain=$D bucket=$B"

curl -sI "https://$D/" | head -15                       # 200 + HSTS
curl -s -o /dev/null -w '%{http_code}\n' "https://$D/practice"   # 200，且是 index.html
curl -s -o /dev/null -w '%{http_code}\n' "https://$B.s3.ap-northeast-1.amazonaws.com/index.html"  # 403
```

再做一次「改文案 → 重新部署」：把首页标题改掉，`npm run build -w web && (cd infra && npx cdk deploy)`，
刷新浏览器看是否更新。如果没更新，先别改代码，想一想是**哪一层**在缓存。

---

## 4. 常见症状（只给方向，不给答案）

| 症状 | 先查什么 |
| --- | --- |
| `cdk synth` 报 `web/dist` 不存在 | 先 `npm run build -w web`；或检查 `Source.asset` 的相对路径 |
| CloudFront 返回 403 | OAC 是否真的绑到了 distribution；桶策略里 principal 是不是 `cloudfront.amazonaws.com` 且条件带了 distribution ARN |
| `/practice` 返回 403 而不是 index.html | Function 是否关联到 **default behavior**；改写逻辑是否漏了「无扩展名」分支 |
| 改了文案不生效 | `index.html` 的缓存 TTL、BucketDeployment 的 invalidation 路径 |
| `cdk deploy` 说没 bootstrap | 本账号已 bootstrap 过；如果换了 Region 需要重新 bootstrap |

---

## 5. 提交给我 review 的内容

```
1. 我做了什么（3 行）
2. `cdk diff` 里新增了哪些资源类型（列类型名即可）
3. 上面 4 条 curl 的状态码
4. 「先回答」5 题的答案
5. 卡住的点
```

## 6. 先回答（做完再写，别提前搜）

1. 为什么不用 S3 静态网站托管端点？
2. OAC 和 OAI 的区别是什么？请求是谁签名的？
3. `index.html` 默认会被 CloudFront 缓存多久？
4. `BucketDeployment` 的 `distribution` 和 `distributionPaths` 各做了什么？
5. 自定义域名需要 ACM 证书，证书必须建在哪个 Region？为什么？
