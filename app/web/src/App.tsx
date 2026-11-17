import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { getSessionUser, signOutCurrent } from './auth';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Practice } from './pages/Practice';
import { Settings } from './pages/Settings';
import { Stats } from './pages/Stats';
import { StagePage } from './pages/StagePage';
import { Spinner } from './ui';
import type { AppConfig } from './types';

export function App({ config }: { config: AppConfig }) {
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const isMock = config.mock === true;
  const authEnabled = isMock || config.features?.auth === true;

  useEffect(() => {
    if (isMock) {
      setUser('demo');
      return;
    }
    if (!authEnabled) {
      setUser(null);
      return;
    }
    let alive = true;
    getSessionUser().then((name) => {
      if (alive) setUser(name);
    });
    return () => {
      alive = false;
    };
  }, [authEnabled, isMock]);

  if (!authEnabled) {
    return <StagePage config={config} />;
  }

  if (user === undefined) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="正在校验登录状态…" />
      </div>
    );
  }

  if (!user) {
    return <Login onSignedIn={(name) => setUser(name)} />;
  }

  return (
    <Layout
      demo={isMock}
      onSignOut={() => {
        if (isMock) return;
        void signOutCurrent().finally(() => setUser(null));
      }}
    >
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/practice" element={<Practice />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}

function NotFound() {
  return (
    <div className="py-24 text-center">
      <p className="h-display text-[64px]">404</p>
      <p className="mt-3 text-[13px] text-[var(--muted)]">这个页面还没做。</p>
    </div>
  );
}
