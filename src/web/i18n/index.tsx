import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Lang } from '@shared/types';
import en from './en.json';
import hi from './hi.json';
import mr from './mr.json';

const DICTS: Record<Lang, unknown> = { en, hi, mr };
const STORAGE_KEY = 'ratanmoti.lang';

function lookup(dict: unknown, path: string): string | undefined {
  let cur: unknown = dict;
  for (const part of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ''));
}

export function getStoredLang(): Lang | null {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'en' || v === 'hi' || v === 'mr' ? v : null;
}

interface LangContextValue {
  lang: Lang;
  setLang(lang: Lang): void;
}

const LangContext = createContext<LangContextValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => getStoredLang() ?? 'hi');

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLangState(l);
  }, []);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within LangProvider');
  return ctx;
}

/**
 * Every user visible string goes through this. No string literals in
 * components (AGENTS.md rule 5). Falls back to the English string, then to
 * the key itself, so a missing translation is visible rather than crashing.
 */
export function useT() {
  const { lang } = useLang();
  return useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const dict = DICTS[lang];
      const found = lookup(dict, key) ?? lookup(DICTS.en, key) ?? key;
      return interpolate(found, vars);
    },
    [lang],
  );
}
