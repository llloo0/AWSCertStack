import type { AppConfig } from '../types';

const STEPS = [
  { id: '01', title: '静态站点', detail: 'S3 私有桶 + CloudFront + OAC', note: '页面能打开、路由能回退、桶不能公开访问' },
  { id: '02', title: '内容分发', detail: '题目包上传到 S3，按 hash 版本化', note: '浏览器能拿到考试列表与题目，走 CDN 缓存' },
  { id: '03', title: 'API', detail: 'Lambda + API Gateway HTTP API', note: '/api/health 与 /api/me 可用' },
  { id: '04', title: '数据', detail: 'DynamoDB 单表 + 两个 GSI', note: '练习记录、交卷、统计能落库' },
  { id: '05', title: '用户', detail: 'Cognito 用户池 + JWT 授权器', note: '开放登录，接口默认拒绝匿名访问' },
  { id: '06', title: '可观测性', detail: 'CloudWatch 日志/指标/告警', note: '能看到 5xx、节流、慢请求' },
  { id: '07', title: 'CI/CD', detail: 'CodePipeline + CodeBuild', note: '推送即部署，人工审批上生产' },
];

function currentIndex(stage?: string): number {
  const num = Number((stage ?? '01').slice(0, 2));
  return Number.isFinite(num) && num >= 1 && num <= STEPS.length ? num - 1 : 0;
}

export function StagePage({ config }: { config: AppConfig }) {
  const current = currentIndex(config.stage);
  const stage = STEPS[current];

  return (
    <div className="min-h-screen px-5 py-14">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-baseline gap-3">
          <span className="grid h-7 w-7 place-items-center bg-[var(--navy)] text-[9px] font-semibold leading-none text-[var(--sheet)]">
            CS
          </span>
          <span className="wordmark text-[17px]">CertStack</span>
          <span className="text-[11px] text-[var(--muted)]">
            {config.env}　{config.region}
          </span>
        </div>

        <header className="mt-12 border-b-2 border-[var(--ink)] pb-5">
          <h1 className="h-page text-[30px]">部署进度</h1>
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            当前阶段 {stage.id}，{stage.title}。{stage.detail}
          </p>
        </header>

        <p className="mt-5 border-l-2 border-[var(--navy)] pl-4 text-[13px] leading-relaxed text-[var(--ink-soft)]">
          {stage.note}。登录、答题、统计会在后续阶段逐个开放。
        </p>

        <ol className="ledger mt-8">
          {STEPS.map((s, i) => {
            const done = i < current;
            const isCurrent = i === current;
            return (
              <li key={s.id} className="grid grid-cols-[32px_1fr_auto] items-baseline gap-4 py-3">
                <span
                  className={`text-[11px] tabular-nums ${
                    done ? 'text-[var(--green)]' : isCurrent ? 'text-[var(--navy)]' : 'text-[var(--muted-2)]'
                  }`}
                >
                  {s.id}
                </span>
                <span>
                  <span className={`block text-[13px] ${done || isCurrent ? '' : 'text-[var(--muted)]'}`}>
                    {s.title}
                  </span>
                  <span className="block text-[11px] text-[var(--muted)]">{s.detail}</span>
                </span>
                <span
                  className={`text-[11px] ${
                    done ? 'text-[var(--green)]' : isCurrent ? 'text-[var(--navy)]' : 'text-[var(--muted-2)]'
                  }`}
                >
                  {done ? '已完成' : isCurrent ? '当前' : '待开始'}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="mt-8 text-[11px] text-[var(--muted-2)]">
          下一步是 Step 0{Math.min(current + 2, 7)}，脚本会随该步骤一起提供。
        </p>
      </div>
    </div>
  );
}
