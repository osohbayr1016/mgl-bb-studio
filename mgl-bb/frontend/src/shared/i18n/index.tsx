import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import mn from '@/shared/i18n/mn.json';

export type Language = 'en' | 'mn';
type Dict = Record<string, string>;

/**
 * `mn.json` is the default + fallback dict and mirrors `en.json` 1:1, so we
 * derive the known-key union from it for editor autocomplete (en is no longer
 * statically imported — see below). We still accept any `string` so a key that
 * hasn't been added yet degrades gracefully (shows the key text) instead of
 * breaking the strict TS build mid-migration.
 */
export type TranslationKey = keyof typeof mn | (string & {});
export type TParams = Record<string, string | number>;

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  /** Flip between the two supported languages. */
  toggle: () => void;
  /** Translate `key`, interpolating `{token}` placeholders from `params`. */
  t: (key: TranslationKey, params?: TParams) => string;
}

// `mn` ships eagerly (default language + universal fallback). `en` is loaded on
// demand the first time a user selects English, so the inactive language's
// ~180KB of JSON stays off the critical-path bundle. `loadEnDict` memoises the
// dynamic import so repeated mn↔en toggles never re-fetch.
const MN_DICT = mn as Dict;

let enDictPromise: Promise<Dict> | null = null;
function loadEnDict(): Promise<Dict> {
  if (!enDictPromise) {
    enDictPromise = import('@/shared/i18n/en.json').then((m) => m.default as Dict);
  }
  return enDictPromise;
}

/**
 * Replace `{name}` style tokens. Unknown tokens are left untouched.
 *
 * Exported because a few strings never pass through the dictionary at all:
 * the header ticker can carry admin-authored sentences straight from the DB
 * (`ticker_messages` / `ticker_builtin_prefs`, migration 0255) that still
 * need the server's `params` filled in. Those callers pick the language with
 * `pickLocalized` and then run the result through this.
 */
export function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem('i18n_lang') as Language;
    return saved === 'en' || saved === 'mn' ? saved : 'mn';
  });
  // Lazily-loaded English dict — null until the user actually selects English.
  const [enDict, setEnDict] = useState<Dict | null>(null);

  useEffect(() => {
    localStorage.setItem('i18n_lang', lang);
    // Keep the document language in sync for a11y / native form widgets.
    document.documentElement.lang = lang;
    // Pull in the English dict on demand. Until it resolves, `t()` falls back to
    // `mn`, so an English user briefly sees Mongolian rather than raw keys.
    if (lang === 'en' && !enDict) {
      let alive = true;
      void loadEnDict().then((d) => {
        if (alive) setEnDict(d);
      });
      return () => {
        alive = false;
      };
    }
  }, [lang, enDict]);

  const t = useCallback(
    (key: TranslationKey, params?: TParams): string => {
      const k = key as string;
      // Active language → Mongolian fallback → raw key. While `en` is still
      // loading (enDict === null) we fall straight through to `mn`.
      const active = lang === 'en' ? enDict : MN_DICT;
      const template = active?.[k] ?? MN_DICT[k] ?? k;
      return interpolate(template, params);
    },
    [lang, enDict],
  );

  const toggle = useCallback(() => setLang((l) => (l === 'en' ? 'mn' : 'en')), []);

  const value = useMemo<LanguageContextType>(
    () => ({ lang, setLang, toggle, t }),
    [lang, t, toggle],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

/**
 * Pick the right side of a bilingual data record (e.g. a team's `name_mn` /
 * `name_en`). Falls back to the Mongolian value when the English one is empty,
 * since `name_mn` is always populated but `name_en` is optional.
 */
export function pickLocalized(
  lang: Language,
  mnValue: string | null | undefined,
  enValue: string | null | undefined,
): string {
  if (lang === 'en') return (enValue && enValue.trim()) || mnValue || '';
  return mnValue || (enValue && enValue.trim()) || '';
}
