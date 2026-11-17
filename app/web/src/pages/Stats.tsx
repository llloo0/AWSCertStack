import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useLang } from '../i18n';
import { EmptyState, Spinner } from '../ui';

export function Stats() {
  const { lang } = useLang();
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });

  if (stats.isLoading) {
    return (
      <div className="py-16">
        <Spinner />
      </div>
    );
  }
  if (stats.error || !stats.data) {
    return <EmptyState title={lang === 'zh' ? '加载失败' : 'Failed to load'} hint={String(stats.error)} />;
  }

  const { tagStats, days } = stats.data;
  const maxDay = Math.max(1, ...days.map((d) => d.answered));
  const activeDays = days.filter((d) => d.answered > 0).length;
  const weakest = [...tagStats].filter((t) => t.answered >= 3).sort((a, b) => a.accuracy - b.accuracy);

  return (
    <div>
      <header className="border-b-2 border-[var(--ink)] pb-5">
        <h1 className="h-page text-[30px]">{lang === 'zh' ? '学习情况' : 'Your progress'}</h1>
        <p className="mt-2 text-[13px] text-[var(--muted)]">
          {lang === 'zh'
            ? `累计 ${me.data?.profile.totalAnswered ?? 0} 题，整体正确率 ${me.data?.stats.accuracy ?? 0}%。`
            : `${me.data?.profile.totalAnswered ?? 0} answered, ${me.data?.stats.accuracy ?? 0}% accuracy.`}
        </p>
      </header>

      <dl className="grid grid-cols-2 border-b border-[var(--rule)] sm:grid-cols-4">
        {[
          { label: lang === 'zh' ? '累计答题' : 'Answered', value: me.data?.profile.totalAnswered ?? 0 },
          { label: lang === 'zh' ? '正确率' : 'Accuracy', value: `${me.data?.stats.accuracy ?? 0}%` },
          { label: lang === 'zh' ? '学习天数' : 'Active days', value: activeDays },
          { label: lang === 'zh' ? '待复习' : 'Due', value: me.data?.stats.dueToday ?? 0 },
        ].map((item, i) => (
          <div
            key={item.label}
            className={`py-5 ${i > 0 ? 'sm:border-l sm:border-[var(--rule)] sm:pl-5' : ''} ${
              i % 2 === 1 ? 'border-l border-[var(--rule)] pl-5' : ''
            } ${i > 1 ? 'border-t border-[var(--rule)] sm:border-t-0' : ''}`}
          >
            <dt className="text-[11px] text-[var(--muted)]">{item.label}</dt>
            <dd className="figure mt-1.5 text-[26px] leading-none">{item.value}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-10">
        <div className="flex items-baseline justify-between border-b border-[var(--rule)] pb-2">
          <h2 className="text-[13px] font-semibold">{lang === 'zh' ? '近 30 天答题量' : 'Answers, last 30 days'}</h2>
          <span className="text-[11px] tabular-nums text-[var(--muted)]">
            {lang === 'zh' ? `峰值 ${maxDay} 题` : `peak ${maxDay}`}
          </span>
        </div>
        {days.length === 0 ? (
          <EmptyState title={lang === 'zh' ? '还没有数据' : 'No data yet'} />
        ) : (
          <>
            <div className="mt-5 flex h-32 items-end gap-[3px] border-b border-[var(--ink)]">
              {days.map((d) => (
                <div key={d.date} className="group relative flex-1" title={`${d.date}  ${d.answered}`}>
                  <div
                    className="w-full bg-[var(--navy)] opacity-80 transition group-hover:opacity-100"
                    style={{ height: `${Math.max(2, (d.answered / maxDay) * 126)}px` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[11px] tabular-nums text-[var(--muted-2)]">
              <span>{days[0]?.date ?? ''}</span>
              <span>{days[days.length - 1]?.date ?? ''}</span>
            </div>
          </>
        )}
      </section>

      <section className="mt-10">
        <div className="flex items-baseline justify-between border-b border-[var(--rule)] pb-2">
          <h2 className="text-[13px] font-semibold">{lang === 'zh' ? '按标签' : 'By tag'}</h2>
          <span className="text-[11px] text-[var(--muted)]">
            {lang === 'zh' ? `${tagStats.length} 个标签` : `${tagStats.length} tags`}
          </span>
        </div>
        {tagStats.length === 0 ? (
          <EmptyState title={lang === 'zh' ? '还没有作答记录' : 'No answers yet'} />
        ) : (
          <div className="ledger">
            {tagStats.slice(0, 24).map((t) => (
              <div key={t.tag} className="grid grid-cols-[110px_1fr_auto] items-center gap-4 py-2.5">
                <span className="truncate text-[12px]">{t.tag}</span>
                <div className="bar-track">
                  <div
                    className={`bar-fill ${
                      t.accuracy >= 80
                        ? '!bg-[var(--green)]'
                        : t.accuracy >= 60
                          ? '!bg-[var(--amber)]'
                          : '!bg-[var(--red)]'
                    }`}
                    style={{ width: `${t.accuracy}%` }}
                  />
                </div>
                <span className="w-20 text-right text-[11px] tabular-nums text-[var(--muted)]">
                  {t.correct}/{t.answered}，{t.accuracy}%
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {weakest.length > 0 ? (
        <section className="mt-10 border-t border-[var(--rule)] pt-5">
          <h2 className="text-[13px] font-semibold">{lang === 'zh' ? '优先补这些' : 'Prioritise these'}</h2>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            {lang === 'zh' ? '至少答过 3 题、正确率最低的标签' : 'lowest accuracy with 3 or more answers'}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {weakest.slice(0, 8).map((t) => (
              <span key={t.tag} className="text-[12px]">
                {t.tag}
                <span className="ml-1.5 text-[11px] tabular-nums text-[var(--red)]">{t.accuracy}%</span>
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
