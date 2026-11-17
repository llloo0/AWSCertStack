import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { getConfig } from '../content';
import { useLang } from '../i18n';
import type { Lang } from '../types';
import { Spinner } from '../ui';

interface FormState {
  language: Lang;
  targetExam: string;
  dailyGoal: number;
}

export function Settings() {
  const { lang } = useLang();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [form, setForm] = useState<FormState | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (me.data) {
      setForm({
        language: me.data.settings.language,
        targetExam: me.data.settings.targetExam,
        dailyGoal: me.data.settings.dailyGoal,
      });
    }
  }, [me.data]);

  const mutation = useMutation({
    mutationFn: (next: FormState) => api.updateMe(next),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (!form) {
    return (
      <div className="py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <header className="border-b-2 border-[var(--ink)] pb-5">
        <h1 className="h-page text-[30px]">{lang === 'zh' ? '设置' : 'Settings'}</h1>
        <p className="mt-2 text-[13px] text-[var(--muted)]">
          {lang === 'zh' ? '题目语言、目标考试和每日题量。' : 'Language, target exam and daily goal.'}
        </p>
      </header>

      <section className="mt-7">
        <h2 className="border-b border-[var(--rule)] pb-2 text-[13px] font-semibold">
          {lang === 'zh' ? '偏好' : 'Preferences'}
        </h2>

        <Field
          label={lang === 'zh' ? '题目语言' : 'Language'}
          desc={lang === 'zh' ? '题干、选项与解析的显示语言' : 'Applied to questions and explanations'}
        >
          <select
            value={form.language}
            onChange={(e) => setForm({ ...form, language: e.target.value as Lang })}
            className="input"
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </Field>

        <Field
          label={lang === 'zh' ? '目标考试' : 'Target exam'}
          desc={lang === 'zh' ? '首页与练习默认选中的考试' : 'Default exam on the home page'}
        >
          <select
            value={form.targetExam}
            onChange={(e) => setForm({ ...form, targetExam: e.target.value })}
            className="input"
          >
            <option value="SAA-C03">SAA-C03</option>
            <option value="DOP-C02">DOP-C02</option>
            <option value="DVA-C02">DVA-C02</option>
          </select>
        </Field>

        <Field
          label={lang === 'zh' ? '每日题量' : 'Daily goal'}
          desc={lang === 'zh' ? '首页按这个数字显示今日完成度' : 'Used for today progress on the home page'}
        >
          <input
            type="number"
            min={5}
            max={200}
            value={form.dailyGoal}
            onChange={(e) => setForm({ ...form, dailyGoal: Number(e.target.value) })}
            className="input w-24"
          />
        </Field>

        <div className="flex items-center gap-4 border-b border-[var(--rule)] py-5">
          <button
            type="button"
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending}
            className="btn btn-primary"
          >
            {mutation.isPending ? (lang === 'zh' ? '保存中' : 'Saving') : lang === 'zh' ? '保存' : 'Save'}
          </button>
          {saved ? <span className="text-[12px] text-[var(--green)]">{lang === 'zh' ? '已保存' : 'Saved'}</span> : null}
          {mutation.error ? (
            <span className="text-[12px] text-[var(--red)]">{String(mutation.error.message)}</span>
          ) : null}
        </div>
      </section>

      {getConfig().mock ? (
        <section className="mt-9">
          <h2 className="border-b border-[var(--rule)] pb-2 text-[13px] font-semibold">
            {lang === 'zh' ? '演示数据' : 'Demo data'}
          </h2>
          <p className="mt-3 max-w-lg text-[12px] leading-relaxed text-[var(--muted)]">
            {lang === 'zh'
              ? '当前是本地演示模式，答题记录只保存在这个浏览器，不会上传到任何地方。'
              : 'Demo mode: answers live in this browser only.'}
          </p>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem('certstack:mock:v1');
              localStorage.removeItem('certstack:active-session');
              window.location.reload();
            }}
            className="btn btn-outline mt-4"
          >
            {lang === 'zh' ? '重置演示数据' : 'Reset demo data'}
          </button>
        </section>
      ) : null}

      <section className="mt-9 border-t border-[var(--rule)] pt-5">
        <h2 className="text-[13px] font-semibold">{lang === 'zh' ? '关于这套环境' : 'About this environment'}</h2>
        <p className="mt-2 max-w-lg text-[12px] leading-relaxed text-[var(--muted)]">
          {lang === 'zh'
            ? '当前只有前端，数据是浏览器本地的演示数据。接入 API、DynamoDB 与 Cognito 后，这里会换成真实账号数据。'
            : 'Frontend only for now; data is local. The API, DynamoDB and Cognito will replace it.'}
        </p>
      </section>
    </div>
  );
}

function Field({
  label,
  desc,
  children,
}: {
  label: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 border-b border-[var(--rule)] py-5 sm:grid-cols-[180px_1fr] sm:gap-6">
      <div>
        <p className="text-[12px] font-medium">{label}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted)]">{desc}</p>
      </div>
      <div className="sm:max-w-[260px]">{children}</div>
    </div>
  );
}
