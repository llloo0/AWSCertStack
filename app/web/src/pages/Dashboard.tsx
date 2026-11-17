import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { getContentIndex } from '../content';
import { useLang } from '../i18n';
import { EmptyState, Spinner } from '../ui';

export function Dashboard() {
  const { lang } = useLang();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const index = useQuery({ queryKey: ['content-index'], queryFn: getContentIndex });

  if (me.isLoading) {
    return (
      <div className="py-16">
        <Spinner label={lang === 'zh' ? '加载中' : 'Loading'} />
      </div>
    );
  }
  if (me.error || !me.data) {
    return <EmptyState title={lang === 'zh' ? '加载失败' : 'Failed to load'} hint={String(me.error)} />;
  }

  const { profile, settings, stats: summary, recentSessions } = me.data;
  const days = (stats.data?.days ?? []).slice(-14);
  const maxDay = Math.max(1, ...days.map((d) => d.answered));
  const weak = [...(stats.data?.tagStats ?? [])]
    .filter((t) => t.answered >= 3)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 4);

  return (
    <div>
      <section className="border-b-2 border-[var(--ink)] pb-7">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="h-display text-[60px] sm:text-[72px]">{settings.targetExam}</h1>
            <p className="mt-4 max-w-md text-[13px] leading-relaxed text-[var(--muted)]">
              {lang === 'zh'
                ? `今天已答 ${summary.answeredToday} 题，目标 ${settings.dailyGoal} 题。${
                    summary.dueToday > 0 ? `有 ${summary.dueToday} 题到期。` : '暂无到期复习。'
                  }`
                : `${summary.answeredToday} answered today of ${settings.dailyGoal}. ${
                    summary.dueToday > 0 ? `${summary.dueToday} due for review.` : 'Nothing due.'
                  }`}
            </p>
          </div>
          <div className="flex gap-3">
            <Link to="/practice" className="btn btn-primary">
              {lang === 'zh' ? '开始练习' : 'Start practice'}
            </Link>
            <Link to="/practice?mode=exam" className="btn btn-outline">
              {lang === 'zh' ? '全真模考' : 'Mock exam'}
            </Link>
          </div>
        </div>
      </section>

      <dl className="grid grid-cols-2 border-b border-[var(--rule)] sm:grid-cols-4">
        {[
          { label: lang === 'zh' ? '累计答题' : 'Answered', value: profile.totalAnswered },
          { label: lang === 'zh' ? '正确率' : 'Accuracy', value: `${summary.accuracy}%` },
          { label: lang === 'zh' ? '今日已答' : 'Today', value: summary.answeredToday },
          { label: lang === 'zh' ? '待复习' : 'Due', value: summary.dueToday },
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

      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_250px]">
        <section>
          <div className="flex items-baseline justify-between border-b border-[var(--rule)] pb-2">
            <h2 className="text-[13px] font-semibold">{lang === 'zh' ? '最近练习' : 'Recent sessions'}</h2>
            <span className="text-[11px] text-[var(--muted)]">
              {lang === 'zh' ? `共 ${profile.sessionsFinished} 次` : `${profile.sessionsFinished} total`}
            </span>
          </div>

          {recentSessions.length === 0 ? (
            <EmptyState
              title={lang === 'zh' ? '还没有练习记录' : 'No sessions yet'}
              hint={lang === 'zh' ? '从 10 道题开始。' : 'Start with 10 questions.'}
            />
          ) : (
            <div className="ledger">
              {recentSessions.map((s) => (
                <div key={s.id} className="grid grid-cols-[86px_1fr_auto] items-baseline gap-4 py-3">
                  <span className="text-[11px] tabular-nums text-[var(--muted)]">
                    {new Date(s.startedAt).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
                      month: '2-digit',
                      day: '2-digit',
                    })}
                  </span>
                  <span className="text-[13px]">
                    {s.exam}
                    <span className="ml-2 text-[11px] text-[var(--muted)]">
                      {s.mode === 'exam' ? (lang === 'zh' ? '模考' : 'Exam') : lang === 'zh' ? '练习' : 'Practice'}
                      {s.status === 'active' ? (lang === 'zh' ? '（未完成）' : ' (open)') : ''}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="figure text-[15px]">
                      {s.status === 'finished' ? (s.score ?? '—') : '—'}
                    </span>
                    <span className="ml-2 text-[11px] tabular-nums text-[var(--muted)]">
                      {s.correctCount !== null ? `${s.correctCount}/${s.total}` : ''}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-9">
          <section>
            <div className="flex items-baseline justify-between border-b border-[var(--rule)] pb-2">
              <h2 className="text-[13px] font-semibold">{lang === 'zh' ? '题库' : 'Content'}</h2>
              {index.data ? (
                <span className="text-[11px] text-[var(--muted)]">
                  {Object.keys(index.data.exams).length} {lang === 'zh' ? '门' : 'exams'}
                </span>
              ) : null}
            </div>
            {index.data ? (
              <div className="ledger">
                {Object.entries(index.data.exams).map(([exam, entry]) => (
                  <div key={exam} className="flex items-baseline justify-between py-2.5 text-[12px]">
                    <span>{exam}</span>
                    <span className="tabular-nums text-[var(--muted)]">{entry.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-3">
                <Spinner />
              </div>
            )}
          </section>

          <section>
            <div className="flex items-baseline justify-between border-b border-[var(--rule)] pb-2">
              <h2 className="text-[13px] font-semibold">{lang === 'zh' ? '薄弱标签' : 'Weak tags'}</h2>
              <Link to="/stats" className="link text-[11px] text-[var(--muted)]">
                {lang === 'zh' ? '全部' : 'All'}
              </Link>
            </div>
            {weak.length === 0 ? (
              <p className="py-3 text-[11px] text-[var(--muted)]">
                {lang === 'zh' ? '答满 3 题后出现。' : 'Appears after 3 answers.'}
              </p>
            ) : (
              <ul className="ledger">
                {weak.map((t) => (
                  <li key={t.tag} className="py-2.5">
                    <div className="flex items-baseline justify-between text-[12px]">
                      <span>{t.tag}</span>
                      <span className="tabular-nums text-[var(--muted)]">{t.accuracy}%</span>
                    </div>
                    <div className="bar-track mt-1.5">
                      <div
                        className={`bar-fill ${t.accuracy < 60 ? '!bg-[var(--red)]' : t.accuracy < 80 ? '!bg-[var(--amber)]' : ''}`}
                        style={{ width: `${t.accuracy}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="border-b border-[var(--rule)] pb-2">
              <h2 className="text-[13px] font-semibold">{lang === 'zh' ? '近两周' : 'Last two weeks'}</h2>
            </div>
            <div className="mt-3 flex h-16 items-end gap-[3px]">
              {days.length === 0 ? (
                <p className="text-[11px] text-[var(--muted)]">{lang === 'zh' ? '暂无数据' : 'No data'}</p>
              ) : (
                days.map((d) => (
                  <div
                    key={d.date}
                    title={`${d.date} ${d.answered}`}
                    className="flex-1 bg-[var(--navy)] opacity-70"
                    style={{ height: `${Math.max(3, (d.answered / maxDay) * 64)}px` }}
                  />
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
