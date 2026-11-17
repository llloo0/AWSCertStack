import { NavLink, Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useLang } from '../i18n';

const links = [
  { to: '/', zh: '首页', en: 'Home' },
  { to: '/practice', zh: '练习', en: 'Practice' },
  { to: '/stats', zh: '统计', en: 'Stats' },
  { to: '/settings', zh: '设置', en: 'Settings' },
];

export function Layout({
  children,
  onSignOut,
  demo = false,
}: {
  children: ReactNode;
  onSignOut: () => void;
  demo?: boolean;
}) {
  const { lang, setLang } = useLang();

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--rule)] bg-[var(--paper)]">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="flex items-center justify-between gap-6 py-4">
            <Link to="/" className="flex items-baseline gap-3">
              <span className="grid h-6 w-6 place-items-center bg-[var(--navy)] text-[9px] font-semibold leading-none text-[var(--sheet)]">
                CS
              </span>
              <span className="wordmark text-[17px]">CertStack</span>
              <span className="hidden text-[11px] text-[var(--muted)] sm:inline">AWS 认证练习</span>
            </Link>

            <nav className="hidden items-center gap-7 sm:flex">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.to === '/'}
                  className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
                >
                  {lang === 'zh' ? l.zh : l.en}
                </NavLink>
              ))}
            </nav>

            <div className="flex items-center gap-4 text-[11px] text-[var(--muted)]">
              {demo ? <span className="text-[var(--amber)]">本地演示</span> : null}
              <button type="button" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} className="link">
                {lang === 'zh' ? 'English' : '中文'}
              </button>
              {demo ? null : (
                <button type="button" onClick={onSignOut} className="link">
                  退出
                </button>
              )}
            </div>
          </div>

          <nav className="flex items-center gap-7 border-t border-[var(--rule)] py-2 sm:hidden">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
              >
                {lang === 'zh' ? l.zh : l.en}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-5 pb-24 pt-10 sm:px-8">{children}</main>
    </div>
  );
}
