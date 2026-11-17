# devops —— 从 0 开始

这里现在是空的：只有一个还不能部署的模板骨架。

`docs/DEVOPS-FROM-ZERO.md` 是这一段的路线：每次只加一个资源，部署、验证、再继续。
不要一次写完整套资源——那样出了问题也说不清是哪一层。

## 参考实现

已经跑通过的一版放在 `solution/reference/`（被 gitignore）：

- `step-01-static-web/`：静态站点这一段的最终模板和发布脚本
- `later-steps/`：DynamoDB/Cognito 等后续步骤的模板与脚本

先自己写。卡住 20 分钟以上再看参考，或者让我给提示（不给整段代码）。

## 工具

- Increment 0–4 只需要 AWS CLI
- Increment 5 需要 `aws s3 sync` / `aws cloudfront create-invalidation`
- 到 Lambda 那一步才会引入 SAM（`sam build` / `sam deploy`）
