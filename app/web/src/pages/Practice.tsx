import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { getContentIndex, loadExam } from '../content';
import { hasTranslation, pick, useLang } from '../i18n';
import type { AnswerResult, CreatedSession, Question, SessionSummary } from '../types';
import { Icon, Spinner } from '../ui';

type Phase = 'setup' | 'running' | 'summary';

const COUNTS = [5, 10, 20, 40];
const ACTIVE_KEY = 'certstack:active-session';

interface ResumeInfo {
  id: string;
  exam: string;
  mode: string;
  answered: number;
  total: number;
}

interface AnswerRecord {
  selected: string[];
  correct?: boolean;
}

interface RawSession {
  id: string;
  exam: string;
  mode: 'practice' | 'exam';
  status: string;
  questionIds: string[];
  count: number;
  startedAt: string;
  deadlineAt?: string;
  durationSeconds: number;
  passingScore?: number;
}

export function Practice() {
  const { lang } = useLang();
  const [search] = useSearchParams();
  const initialMode = search.get('mode') === 'exam' ? 'exam' : 'practice';

  const index = useQuery({ queryKey: ['content-index'], queryFn: getContentIndex });

  const [exam, setExam] = useState('SAA-C03');
  const [mode, setMode] = useState<'practice' | 'exam'>(initialMode);
  const [count, setCount] = useState(10);
  const [tags, setTags] = useState<string[]>([]);
  const [showAllTags, setShowAllTags] = useState(false);

  const [phase, setPhase] = useState<Phase>('setup');
  const [resume, setResume] = useState<ResumeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [session, setSession] = useState<CreatedSession | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [indexNow, setIndexNow] = useState(0);
  const [answers, setAnswers] = useState<Map<string, AnswerRecord>>(new Map());
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [questionStart, setQuestionStart] = useState(0);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [now, setNow] = useState(Date.now());
  const finishing = useRef(false);

  const current = questions[indexNow];
  const total = questions.length;
  const answeredIds = useMemo(() => new Set(answers.keys()), [answers]);

  useEffect(() => {
    if (!index.data) return;
    const exams = Object.keys(index.data.exams);
    if (exams.length > 0 && !exams.includes(exam)) setExam(exams[0]);
  }, [index.data, exam]);

  useEffect(() => {
    const id = localStorage.getItem(ACTIVE_KEY);
    if (!id) return;
    let alive = true;
    (async () => {
      try {
        const data = await api.getSession(id);
        const s = data.session as Partial<RawSession>;
        if (!s || s.status !== 'active' || !s.id) {
          localStorage.removeItem(ACTIVE_KEY);
          return;
        }
        if (!alive) return;
        setResume({
          id: s.id,
          exam: s.exam ?? '',
          mode: s.mode ?? 'practice',
          answered: data.answers.length,
          total: s.count ?? 0,
        });
        setExam(s.exam ?? 'SAA-C03');
        setMode(s.mode === 'exam' ? 'exam' : 'practice');
      } catch {
        localStorage.removeItem(ACTIVE_KEY);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'running' || mode !== 'exam' || !session) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase, mode, session]);

  const remainingMs = session?.deadlineAt
    ? Math.max(0, new Date(session.deadlineAt).getTime() - now)
    : 0;

  const finish = useCallback(async () => {
    if (!session || finishing.current) return;
    finishing.current = true;
    setBusy(true);
    try {
      const res = await api.finish(session.id);
      localStorage.removeItem(ACTIVE_KEY);
      setSummary(res);
      setPhase('summary');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      finishing.current = false;
    }
  }, [session]);

  useEffect(() => {
    if (phase === 'running' && mode === 'exam' && session && remainingMs === 0) {
      void finish();
    }
  }, [phase, mode, session, remainingMs, finish]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createSession({
        exam,
        mode,
        count: mode === 'practice' ? count : undefined,
        tags: tags.length > 0 ? tags : undefined,
      });
      const content = await loadExam(exam);
      const byId = new Map(content.questions.map((q) => [q.id, q]));
      const picked = created.questionIds.map((id) => byId.get(id)).filter((q): q is Question => Boolean(q));
      if (picked.length === 0) throw new Error(lang === 'zh' ? '没有拿到题目内容' : 'no content for session');

      localStorage.setItem(ACTIVE_KEY, created.id);
      setSession(created);
      setQuestions(picked);
      setAnswers(new Map());
      setIndexNow(0);
      setSelected([]);
      setResult(null);
      setQuestionStart(Date.now());
      setNow(Date.now());
      setResume(null);
      setPhase('running');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const resumeSession = async (info: ResumeInfo) => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.getSession(info.id);
      const s = data.session as RawSession;
      const content = await loadExam(s.exam);
      const byId = new Map(content.questions.map((q) => [q.id, q]));
      const qs = (s.questionIds ?? []).map((id) => byId.get(id)).filter((q): q is Question => Boolean(q));
      const records = new Map<string, AnswerRecord>();
      for (const raw of data.answers) {
        const rec = raw as { questionId?: string; selected?: unknown; isCorrect?: unknown };
        const id = String(rec.questionId ?? '');
        if (!id) continue;
        records.set(id, {
          selected: Array.isArray(rec.selected) ? rec.selected.map(String) : [],
          correct: typeof rec.isCorrect === 'boolean' ? rec.isCorrect : undefined,
        });
      }
      const firstUnanswered = qs.findIndex((q) => !records.has(q.id));

      if (firstUnanswered === -1) {
        const done = await api.finish(info.id);
        localStorage.removeItem(ACTIVE_KEY);
        setSummary(done);
        setPhase('summary');
        return;
      }

      setSession({
        id: s.id,
        exam: s.exam,
        mode: s.mode,
        count: s.count,
        questionIds: s.questionIds,
        startedAt: s.startedAt,
        deadlineAt: s.deadlineAt ?? '',
        durationSeconds: s.durationSeconds,
        passingScore: s.passingScore ?? 720,
      });
      setQuestions(qs);
      setAnswers(records);
      setIndexNow(firstUnanswered);
      setSelected([]);
      setResult(null);
      setQuestionStart(Date.now());
      setNow(Date.now());
      setResume(null);
      setPhase('running');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const discardResume = () => {
    if (resume) localStorage.removeItem(ACTIVE_KEY);
    setResume(null);
  };

  const exitSession = () => {
    if (!session) {
      setPhase('setup');
      return;
    }
    setResume({
      id: session.id,
      exam: session.exam,
      mode: session.mode,
      answered: answeredIds.size,
      total,
    });
    setPhase('setup');
  };

  const jumpTo = (target: number) => {
    const question = questions[target];
    if (!question) return;
    setIndexNow(target);
    const record = answers.get(question.id);
    if (record) {
      setSelected(record.selected);
      setResult(
        record.correct === undefined
          ? { saved: true }
          : { saved: true, correct: record.correct, correctKeys: question.correct },
      );
    } else {
      setSelected([]);
      setResult(null);
    }
    setQuestionStart(Date.now());
  };

  const railStatus = (i: number): string => {
    const question = questions[i];
    const record = question ? answers.get(question.id) : undefined;
    if (!record) return '';
    if (mode === 'exam') return 'rail-cell-done';
    if (record.correct === true) return 'rail-cell-correct';
    if (record.correct === false) return 'rail-cell-wrong';
    return 'rail-cell-done';
  };

  const toggle = useCallback(
    (key: string) => {
      if (result || !current) return;
      if (current.type === 'single') {
        setSelected([key]);
      } else {
        setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
      }
    },
    [current, result],
  );

  const submit = useCallback(async () => {
    if (!session || !current || selected.length === 0 || result) return;
    setBusy(true);
    try {
      const res = await api.answer(session.id, current.id, selected, Date.now() - questionStart);
      setAnswers((prev) => new Map(prev).set(current.id, { selected, correct: res.correct }));
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [session, current, selected, result, questionStart]);

  const next = useCallback(async () => {
    setError(null);
    if (indexNow + 1 < total) {
      setIndexNow(indexNow + 1);
      setSelected([]);
      setResult(null);
      setQuestionStart(Date.now());
    } else {
      await finish();
    }
  }, [indexNow, total, finish]);

  useEffect(() => {
    if (phase !== 'running' || result) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const n = Number(event.key);
      if (Number.isInteger(n) && n >= 1 && n <= 6) {
        const option = current?.options[n - 1];
        if (option) {
          event.preventDefault();
          toggle(option.key);
        }
      }
      if (event.key === 'Enter' && selected.length > 0) {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, result, current, selected, toggle, submit]);

  if (phase === 'setup') {
    return (
      <SetupView
        lang={lang}
        index={index.data}
        exam={exam}
        setExam={setExam}
        mode={mode}
        setMode={setMode}
        count={count}
        setCount={setCount}
        tags={tags}
        setTags={setTags}
        showAllTags={showAllTags}
        setShowAllTags={setShowAllTags}
        resume={resume}
        onResume={resumeSession}
        onDiscard={discardResume}
        busy={busy}
        error={error}
        onStart={start}
      />
    );
  }

  if (phase === 'summary' && summary) {
    return (
      <SummaryView
        summary={summary}
        onRestart={() => {
          setPhase('setup');
          setSession(null);
          setQuestions([]);
          setSummary(null);
          setAnswers(new Map());
        }}
      />
    );
  }

  if (!current || !session) {
    return (
      <div className="py-16">
        <Spinner />
      </div>
    );
  }

  const revealKeys = result?.correctKeys ?? [];
  const correctlyAnswered = result?.correct === true;
  const isLast = indexNow + 1 >= total;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_150px]">
      <div>
        <div className="flex items-baseline justify-between gap-3 border-b border-[var(--rule)] pb-3 text-[12px] text-[var(--muted)]">
          <button type="button" onClick={exitSession} className="link">
            {lang === 'zh' ? '退出' : 'Exit'}
          </button>
          <span className="flex items-baseline gap-5">
            <span className="tabular-nums">
              {lang === 'zh' ? `第 ${indexNow + 1} 题，共 ${total} 题` : `${indexNow + 1} of ${total}`}
            </span>
            {mode === 'exam' ? (
              <span className="flex items-center gap-1.5 tabular-nums">
                <Icon name="clock" className="h-3.5 w-3.5" />
                {formatDuration(remainingMs)}
              </span>
            ) : null}
          </span>
        </div>

        {error ? <p className="mt-4 text-[12px] text-[var(--red)]">{error}</p> : null}

        <article className="mt-6">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
            <span>{current.type === 'multi' ? (lang === 'zh' ? '多选' : 'Multiple') : lang === 'zh' ? '单选' : 'Single'}</span>
            {current.tags.slice(0, 4).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
            {lang === 'zh' && !hasTranslation(current.stem.text) ? <span>暂无中文</span> : null}
          </div>

          <div
            className="stem mt-4"
            dangerouslySetInnerHTML={{ __html: pick(current.stem.html, lang) || current.stem.text.en || '' }}
          />

          <div className="mt-7 space-y-2">
            {current.options.map((option, i) => {
              const isSelected = selected.includes(option.key);
              const isCorrect = revealKeys.includes(option.key);
              const hasVerdict = result?.correct !== undefined;
              const wrongPick = hasVerdict && isSelected && !isCorrect;
              const className = hasVerdict
                ? isCorrect
                  ? 'option option-correct'
                  : wrongPick
                    ? 'option option-wrong'
                    : 'option'
                : isSelected
                  ? 'option option-selected'
                  : 'option';
              const letter = hasVerdict
                ? isCorrect
                  ? 'letter letter-correct'
                  : wrongPick
                    ? 'letter letter-wrong'
                    : 'letter'
                : isSelected
                  ? 'letter letter-active'
                  : 'letter';

              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => toggle(option.key)}
                  disabled={Boolean(result)}
                  className={className}
                >
                  <span className={letter}>{String.fromCharCode(65 + i)}</span>
                  {pick(option.html, lang) ? (
                    <span
                      className="stem text-[var(--ink)]"
                      dangerouslySetInnerHTML={{ __html: pick(option.html, lang) }}
                    />
                  ) : (
                    <span className="text-[14px] leading-relaxed text-[var(--ink)]">{option.text.en}</span>
                  )}
                </button>
              );
            })}
          </div>

          {result ? (
            <div className="mt-6 border-t border-[var(--rule)] pt-4">
              {result.correct === undefined ? (
                <p className="text-[12px] text-[var(--muted)]">
                  {lang === 'zh' ? '已记录，交卷后统一判分。' : 'Saved. Scored when you finish.'}
                </p>
              ) : (
                <div>
                  <p
                    className={`flex items-center gap-2 text-[13px] font-semibold ${
                      correctlyAnswered ? 'text-[var(--green)]' : 'text-[var(--red)]'
                    }`}
                  >
                    <Icon name={correctlyAnswered ? 'check' : 'x'} className="h-4 w-4" />
                    {correctlyAnswered
                      ? lang === 'zh'
                        ? '回答正确'
                        : 'Correct'
                      : lang === 'zh'
                        ? `回答错误，正确答案 ${(result.correctKeys ?? []).join(', ').toUpperCase()}`
                        : `Wrong, answer ${(result.correctKeys ?? []).join(', ').toUpperCase()}`}
                  </p>
                  <Explanation question={current} lang={lang} />
                </div>
              )}
            </div>
          ) : null}

          <div className="mt-7 flex items-center justify-between gap-4">
            <p className="text-[11px] text-[var(--muted)]">
              {lang === 'zh' ? '键盘 1–6 选择，Enter 提交' : 'Keys 1–6 select, Enter submits'}
            </p>
            {result ? (
              <button type="button" onClick={() => void next()} disabled={busy} className="btn btn-primary">
                {isLast ? (lang === 'zh' ? '交卷' : 'Finish') : lang === 'zh' ? '下一题' : 'Next'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || selected.length === 0}
                className="btn btn-primary"
              >
                {lang === 'zh' ? '提交' : 'Submit'}
              </button>
            )}
          </div>
        </article>
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-8 border-l border-[var(--rule)] pl-7">
          <p className="text-[11px] text-[var(--muted)]">{lang === 'zh' ? '答题卡' : 'Answer sheet'}</p>
          <div className="rail mt-3">
            {questions.map((q, i) => (
              <button
                key={q.id}
                type="button"
                onClick={() => jumpTo(i)}
                aria-current={i === indexNow ? 'true' : undefined}
                aria-label={`${lang === 'zh' ? '第' : ''}${i + 1}${lang === 'zh' ? '题' : ''}`}
                className={`rail-cell ${i === indexNow ? 'rail-cell-current' : ''} ${railStatus(i)}`}
              >
                {String(i + 1).padStart(2, '0')}
              </button>
            ))}
          </div>
          <p className="mt-4 text-[11px] tabular-nums text-[var(--muted)]">
            {lang === 'zh'
              ? `已答 ${answeredIds.size}，共 ${total}`
              : `${answeredIds.size} of ${total} answered`}
          </p>
          <div className="mt-3 flex items-center gap-3 text-[10.5px] text-[var(--muted)]">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 bg-[var(--green)]" />
              {lang === 'zh' ? '对' : 'right'}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 bg-[var(--red)]" />
              {lang === 'zh' ? '错' : 'wrong'}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 bg-[var(--navy)]" />
              {lang === 'zh' ? '已答' : 'done'}
            </span>
          </div>
          <p className="mt-3 text-[11px] text-[var(--muted-2)]">
            {lang === 'zh' ? '点击号码可跳题' : 'Click a number to jump'}
          </p>
        </div>
      </aside>
    </div>
  );
}

function Explanation({ question, lang }: { question: Question; lang: 'zh' | 'en' }) {
  const html = lang === 'zh' ? question.explanation.zhHtml : question.explanation.enHtml;
  const text = lang === 'zh' ? question.explanation.zh : question.explanation.en;

  if (!html && !text) {
    return (
      <p className="mt-3 text-[11px] text-[var(--muted)]">
        {lang === 'zh' ? '本题暂无解析。' : 'No explanation yet.'}
      </p>
    );
  }
  return (
    <div className="mt-3 border-l-2 border-[var(--rule)] pl-4">
      {html ? (
        <div
          className="stem !text-[14px] !leading-[1.75] text-[var(--ink-soft)]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className="text-[13px] leading-relaxed text-[var(--ink-soft)] whitespace-pre-line">{text}</p>
      )}
    </div>
  );
}

function SetupView(props: {
  lang: 'zh' | 'en';
  index: { exams: Record<string, { count: number; tags: Record<string, number> }> } | undefined;
  exam: string;
  setExam: (v: string) => void;
  mode: 'practice' | 'exam';
  setMode: (v: 'practice' | 'exam') => void;
  count: number;
  setCount: (v: number) => void;
  tags: string[];
  setTags: (v: string[]) => void;
  showAllTags: boolean;
  setShowAllTags: (v: boolean) => void;
  resume: ResumeInfo | null;
  onResume: (info: ResumeInfo) => void;
  onDiscard: () => void;
  busy: boolean;
  error: string | null;
  onStart: () => void;
}) {
  const {
    lang,
    index,
    exam,
    setExam,
    mode,
    setMode,
    count,
    setCount,
    tags,
    setTags,
    showAllTags,
    setShowAllTags,
    resume,
    onResume,
    onDiscard,
    busy,
    error,
    onStart,
  } = props;

  const entry = index?.exams[exam];
  const tagOptions = useMemo(() => Object.entries(entry?.tags ?? {}), [entry]);
  const visibleTags = showAllTags ? tagOptions : tagOptions.slice(0, 10);

  return (
    <div>
      <header className="border-b-2 border-[var(--ink)] pb-5">
        <h1 className="h-page text-[30px]">{lang === 'zh' ? '开始练习' : 'Start a session'}</h1>
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-[var(--muted)]">
          {lang === 'zh'
            ? '选择考试、模式和题量。作答会实时保存，中途退出可以从上次的题目继续。'
            : 'Pick an exam, mode and size. Progress is saved, so you can resume after exiting.'}
        </p>
      </header>

      {resume ? (
        <div className="mt-6 border-l-2 border-[var(--navy)] bg-[var(--navy-soft)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium">
                {lang === 'zh' ? '有一组未完成的练习' : 'Unfinished session'}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                {resume.exam}，{resume.mode === 'exam' ? (lang === 'zh' ? '模考' : 'exam') : lang === 'zh' ? '练习' : 'practice'}，
                {lang === 'zh' ? `已答 ${resume.answered} / ${resume.total}` : `${resume.answered} of ${resume.total} answered`}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <button type="button" onClick={() => void onResume(resume)} disabled={busy} className="btn btn-primary">
                {lang === 'zh' ? '继续' : 'Resume'}
              </button>
              <button type="button" onClick={onDiscard} className="link text-[12px] text-[var(--muted)]">
                {lang === 'zh' ? '放弃' : 'Discard'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-7">
        <Row label={lang === 'zh' ? '考试' : 'Exam'}>
          <div className="grid gap-2 sm:grid-cols-3">
            {index
              ? Object.entries(index.exams).map(([code, e]) => {
                  const active = exam === code;
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setExam(code)}
                      className={`flex items-center justify-between border px-3 py-2 text-[13px] transition ${
                        active
                          ? 'border-[var(--navy)] bg-[var(--navy-soft)]'
                          : 'border-[var(--rule)] hover:border-[var(--rule-strong)]'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="grid h-3 w-3 place-items-center border border-[var(--rule-strong)]">
                          {active ? <span className="h-1.5 w-1.5 bg-[var(--navy)]" /> : null}
                        </span>
                        {code}
                      </span>
                      <span className="text-[11px] tabular-nums text-[var(--muted)]">{e.count}</span>
                    </button>
                  );
                })
              : <Spinner />}
          </div>
        </Row>

        <Row label={lang === 'zh' ? '模式' : 'Mode'}>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              {
                value: 'practice' as const,
                title: lang === 'zh' ? '练习' : 'Practice',
                desc: lang === 'zh' ? '逐题作答，提交后立即判定并显示解析' : 'Instant feedback after each submit',
              },
              {
                value: 'exam' as const,
                title: lang === 'zh' ? '全真模考' : 'Mock exam',
                desc: lang === 'zh' ? '按官方题量与时长，交卷后统一判分' : 'Official size and time, scored at the end',
              },
            ].map((m) => {
              const active = mode === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  className={`border px-3 py-2.5 text-left transition ${
                    active
                      ? 'border-[var(--navy)] bg-[var(--navy-soft)]'
                      : 'border-[var(--rule)] hover:border-[var(--rule-strong)]'
                  }`}
                >
                  <span className="flex items-center gap-2.5 text-[13px]">
                    <span className="grid h-3 w-3 place-items-center border border-[var(--rule-strong)]">
                      {active ? <span className="h-1.5 w-1.5 bg-[var(--navy)]" /> : null}
                    </span>
                    {m.title}
                  </span>
                  <span className="mt-1 block pl-[22px] text-[11px] leading-relaxed text-[var(--muted)]">
                    {m.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </Row>

        {mode === 'practice' ? (
          <Row label={lang === 'zh' ? '题量' : 'Questions'}>
            <div className="flex flex-wrap gap-2">
              {COUNTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCount(c)}
                  className={`border px-3 py-1 text-[12px] tabular-nums transition ${
                    count === c
                      ? 'border-[var(--navy)] bg-[var(--navy)] text-[var(--sheet)]'
                      : 'border-[var(--rule)] text-[var(--muted)] hover:border-[var(--rule-strong)]'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </Row>
        ) : null}

        {tagOptions.length > 0 ? (
          <Row label={lang === 'zh' ? '标签' : 'Tags'}>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {visibleTags.map(([tag, n]) => {
                const active = tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setTags(active ? tags.filter((t) => t !== tag) : [...tags, tag])}
                    className={`text-[12px] ${active ? 'link text-[var(--navy)]' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}
                  >
                    {tag}
                    <span className="ml-1 text-[10px] text-[var(--muted-2)]">{n}</span>
                  </button>
                );
              })}
              {tagOptions.length > 10 ? (
                <button
                  type="button"
                  onClick={() => setShowAllTags(!showAllTags)}
                  className="link text-[12px] text-[var(--muted)]"
                >
                  {showAllTags ? (lang === 'zh' ? '收起' : 'Less') : lang === 'zh' ? '更多' : 'More'}
                </button>
              ) : null}
            </div>
          </Row>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-4 py-5">
          <p className="text-[11px] text-[var(--muted)]">
            {lang === 'zh'
              ? `${exam}，${mode === 'exam' ? '模考' : '练习'}${mode === 'practice' ? `，${count} 题` : ''}`
              : `${exam}, ${mode}${mode === 'practice' ? `, ${count} questions` : ''}`}
          </p>
          <div className="flex items-center gap-4">
            {error ? <p className="text-[12px] text-[var(--red)]">{error}</p> : null}
            <button type="button" onClick={onStart} disabled={busy || !entry} className="btn btn-primary">
              {busy ? <Spinner /> : null}
              {lang === 'zh' ? '开始' : 'Start'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 border-t border-[var(--rule)] py-5 sm:grid-cols-[110px_1fr] sm:gap-6">
      <p className="pt-1 text-[12px] text-[var(--muted)]">{label}</p>
      <div>{children}</div>
    </div>
  );
}

function SummaryView({ summary, onRestart }: { summary: SessionSummary; onRestart: () => void }) {
  const { lang } = useLang();
  const accuracy = summary.total > 0 ? Math.round((summary.correctCount / summary.total) * 100) : 0;

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-[var(--ink)] pb-5">
        <h1 className="h-page text-[30px]">{lang === 'zh' ? '本组练习完成' : 'Session complete'}</h1>
        <button type="button" onClick={onRestart} className="btn btn-outline">
          {lang === 'zh' ? '再来一组' : 'Again'}
        </button>
      </header>

      <div className="mt-8 flex flex-wrap items-end gap-x-14 gap-y-6 border-b border-[var(--rule)] pb-8">
        <div>
          <p className="text-[11px] text-[var(--muted)]">{lang === 'zh' ? '得分（100–1000）' : 'Score (100–1000)'}</p>
          <p className="h-display mt-1 text-[76px]">{summary.score}</p>
        </div>
        <div className="pb-2 text-[13px] leading-relaxed">
          <p className={summary.passed ? 'text-[var(--green)]' : 'text-[var(--red)]'}>
            {summary.passed
              ? lang === 'zh' ? '达到通过线' : 'Passed'
              : lang === 'zh' ? '未达通过线' : 'Below pass'}
            ，{lang === 'zh' ? '通过线' : 'pass mark'} {summary.passingScore}
          </p>
          <p className="mt-1 text-[var(--muted)]">
            {lang === 'zh'
              ? `正确 ${summary.correctCount} / ${summary.total}（${accuracy}%），用时 ${formatDuration(summary.durationSeconds * 1000)}`
              : `${summary.correctCount} of ${summary.total} (${accuracy}%), ${formatDuration(summary.durationSeconds * 1000)}`}
          </p>
        </div>
      </div>

      <section className="mt-8">
        <div className="flex items-baseline justify-between border-b border-[var(--rule)] pb-2">
          <h2 className="text-[13px] font-semibold">{lang === 'zh' ? '按标签' : 'By tag'}</h2>
          <span className="text-[11px] text-[var(--muted)]">{summary.tagBreakdown.length}</span>
        </div>
        <div className="ledger">
          {summary.tagBreakdown.slice(0, 12).map((t) => (
            <div key={t.tag} className="grid grid-cols-[120px_1fr_auto] items-center gap-4 py-2.5">
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
                {t.correct}/{t.total}，{t.accuracy}%
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
