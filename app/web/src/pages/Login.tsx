import { useState, type FormEvent } from 'react';
import { signInWithPassword, setNewPassword } from '../auth';
import { Spinner } from '../ui';

export function Login({ onSignedIn }: { onSignedIn: (username: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPasswordValue] = useState('');
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await signInWithPassword(username.trim(), password);
      if (result.needsNewPassword) {
        setNeedsNewPassword(true);
      } else {
        onSignedIn(username.trim());
      }
    } catch (err) {
      setError(translateError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitNewPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await setNewPassword(newPassword);
      onSignedIn(username.trim());
    } catch (err) {
      setError(translateError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
      <aside className="hidden flex-col justify-between border-r border-[var(--rule)] p-12 lg:flex">
        <div className="flex items-baseline gap-3">
          <span className="grid h-7 w-7 place-items-center bg-[var(--navy)] text-[9px] font-semibold leading-none text-[var(--sheet)]">
            CS
          </span>
          <span className="wordmark text-[18px]">CertStack</span>
        </div>

        <div>
          <h1 className="h-display text-[78px]">SAA-C03</h1>
          <p className="mt-3 text-[14px] text-[var(--muted)]">Solutions Architect Associate</p>
          <div className="mt-8 h-px w-24 bg-[var(--ink)]" />
          <p className="mt-5 max-w-xs text-[13px] leading-relaxed text-[var(--ink-soft)]">
            2381 道真题，中英对照。练习、模考、按标签看正确率，都在一个页面上。
          </p>
          <p className="mt-8 text-[11px] text-[var(--muted-2)]">DOP-C02　DVA-C02</p>
        </div>

        <p className="text-[11px] text-[var(--muted-2)]">本地演示版本</p>
      </aside>

      <main className="flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-[320px]">
          <div className="mb-10 flex items-baseline gap-2 lg:hidden">
            <span className="grid h-6 w-6 place-items-center bg-[var(--navy)] text-[9px] font-semibold leading-none text-[var(--sheet)]">
              CS
            </span>
            <span className="wordmark text-[16px]">CertStack</span>
          </div>

          <h2 className="h-page text-[28px]">{needsNewPassword ? '设置新密码' : '登录'}</h2>
          <p className="mt-2 text-[12px] text-[var(--muted)]">
            {needsNewPassword ? '首次登录需要修改临时密码。' : '账号由管理员创建，未开放注册。'}
          </p>

          <form onSubmit={needsNewPassword ? submitNewPassword : submit} className="mt-9 space-y-6">
            {!needsNewPassword ? (
              <>
                <label className="block">
                  <span className="block text-[11px] text-[var(--muted)]">用户名</span>
                  <input
                    autoFocus
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="block text-[11px] text-[var(--muted)]">密码</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input mt-1"
                  />
                </label>
              </>
            ) : (
              <label className="block">
                <span className="block text-[11px] text-[var(--muted)]">新密码</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPasswordValue(e.target.value)}
                  className="input mt-1"
                />
                <span className="mt-2 block text-[11px] text-[var(--muted-2)]">
                  至少 12 位，包含大小写字母和数字。
                </span>
              </label>
            )}

            {error ? <p className="text-[12px] text-[var(--red)]">{error}</p> : null}

            <button type="submit" disabled={busy} className="btn btn-primary w-full">
              {busy ? <Spinner /> : null}
              {needsNewPassword ? '设置并登录' : '登录'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

function translateError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? '';
  const message = err instanceof Error ? err.message : String(err);
  if (name === 'NotAuthorizedException') return '用户名或密码不正确';
  if (name === 'UserNotFoundException') return '用户不存在';
  if (name === 'UserNotConfirmedException') return '账号尚未验证，请联系管理员';
  if (name === 'PasswordResetRequiredException') return '需要重置密码';
  if (name === 'InvalidPasswordException') return '密码不符合复杂度要求';
  return `登录失败：${message}`;
}
