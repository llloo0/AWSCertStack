import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-serif/400.css';
import '@fontsource/ibm-plex-serif/500.css';
import '@fontsource/ibm-plex-serif/600.css';
import '@fontsource/noto-serif-sc/500.css';
import './index.css';
import { App } from './App';
import { configureAuth } from './auth';
import { loadConfig } from './content';
import { LangProvider } from './i18n';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

async function start() {
  const container = document.getElementById('root');
  if (!container) throw new Error('#root not found');
  const root = createRoot(container);

  try {
    const config = await loadConfig();
    if (!config.mock && config.userPoolId && config.userPoolClientId) {
      configureAuth(config);
    }
    root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <LangProvider>
              <App config={config} />
            </LangProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </StrictMode>,
    );
  } catch (err) {
    root.render(
      <div style={{ padding: 32, color: '#fca5a5', fontFamily: 'monospace', lineHeight: 1.6 }}>
        <p>应用启动失败</p>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{err instanceof Error ? err.message : String(err)}</pre>
      </div>,
    );
  }
}

void start();
