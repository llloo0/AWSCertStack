import * as cdk from 'aws-cdk-lib';

/**
 * 这是你的 CDK 应用入口。
 *
 * Lab 1 要做的事：
 *   1. 在 infra/lib/ 下新建一个 Stack 文件
 *   2. 用它创建一个 S3 桶 + CloudFront + BucketDeployment
 *   3. 在下面实例化它，跑 `npx cdk synth` 看模板，再 `npx cdk deploy`
 *
 * CDK CLI 会自动把当前凭证对应的账号和 region 注入这两个环境变量，
 * 所以 stack 能拿到具体的 account/region（而不是 environment-agnostic）。
 */
const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
};

// TODO(Lab 1): 把你的 Stack 实例化在这里，例如：
// new StaticSiteStack(app, 'CertStack-dev', {
//   env,
//   stackName: 'CertStack-dev',
//   description: 'CertStack: static site on S3 + CloudFront',
// });

// 加完 Stack 之后可以删掉这两行（只是为了让脚手架通过类型检查）。
void app;
void env;
