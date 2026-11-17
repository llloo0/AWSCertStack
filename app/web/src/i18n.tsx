import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Lang, LocalizedText } from './types';

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangState>({ lang: 'zh', setLang: () => undefined });

const STORAGE_KEY = 'certstack:lang';

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  const value = useMemo<LangState>(
    () => ({ lang, setLang: (next) => setLangState(next) }),
    [lang],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangState {
  return useContext(LangContext);
}

/** 取本地化文本；缺失时回退英文，再回退空串。 */
export function pick(text: LocalizedText | undefined, lang: Lang): string {
  if (!text) return '';
  return text[lang] || text.en || '';
}

export function hasTranslation(text: LocalizedText | undefined): boolean {
  return Boolean(text?.zh);
}
