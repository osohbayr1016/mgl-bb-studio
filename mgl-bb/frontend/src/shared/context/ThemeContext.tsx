import { createContext, useContext, useEffect, useState } from 'react';

import { THEME_CLASSES, isTheme, type Theme, type ResolvedTheme } from '@/shared/lib/theme';

/** Төрлүүд нь `@/shared/lib/theme`-д амьдарна (энэ файл компонент экспортлодог
 *  тул тэндээс тогтмол/функц гаргаж болохгүй — react-refresh).  Хуучин
 *  дуудагчид эвдрэхгүйн тулд төрлийг эндээс дахин экспортлов. */
export type { Theme, ResolvedTheme };

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** The resolved mode actually applied to the document. */
  resolved: ResolvedTheme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** `system` (= тохируулаагүй өгөгдмөл) ҮРГЭЛЖ «Дундаж» (`dim`) рүү шийдэгдэнэ —
 *  ОС-ийн `prefers-color-scheme`-ээс ХАМААРАХГҮЙ. Бараан дэвсгэрийг зөвхөн
 *  хэрэглэгч өөрөө «Бараан» сэдвийг ИЛ сонгосон үед л ашиглана (эзний
 *  шийдвэр). */
function getSystemPreference(): ResolvedTheme {
  return 'dim';
}

/** index.css-ийн `--chrome` токентой таарсан утгууд
 *  (dark: 240 8% 6%, dim: 220 7% 21%, light: 0 0% 100%).
 *
 *  ⚠ Энэ бол `--chrome`-ийн ЦОРЫН ГАНЦ JS хуулбар бөгөөд `index.html`-ийн
 *  статик `theme-color` мета хоёрыг ажиллах үедээ дардаг.  Тиймээс
 *  `.dim`-ийн browser/PWA зурвасын өнгө ЗӨВХӨН эндээс гарна — index.css-ийн
 *  `--chrome`-ийг хөдөлгөх бүрд ЭНЭ МӨРИЙГ хамт зас, эс бөгөөс утасны
 *  статус мөр хуучин өнгөөрөө үлдэнэ. */
const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: '#0d0d11',
  dim: '#37393f',
  light: '#ffffff',
};

/**
 * Browser-ийн хаяг/статус мөрний өнгийг аппын БОДИТ сэдэвтэй тааруулна.
 *
 * index.html дахь хос `<meta name="theme-color" media="...">` нь
 * `prefers-color-scheme`-ээс хамаардаг ч энэ аппын сэдэв нь
 * `localStorage.theme`-ээр удирдагддаг — өөрөөр хэлбэл систем нь гэрэлтэй
 * атлаа апп нь бараан байж болно.  Тиймээс `media` шинжийг устган хоёуланг
 * нь болзолгүй болгож, хэрэглэгчийн сонгосон өнгийг л үлдээнэ.  PWA
 * standalone горимд энэ нь дэлгэцийн дээд/доод зурвасын өнгө болно.
 */
function applyThemeColorMeta(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const color = THEME_COLOR[resolved];
  const tags = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (tags.length === 0) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = color;
    document.head.appendChild(meta);
    return;
  }
  tags.forEach((tag) => {
    tag.removeAttribute('media');
    tag.setAttribute('content', color);
  });
}

function applyThemeMode(theme: Theme): ResolvedTheme {
  const resolved = theme === 'system' ? getSystemPreference() : theme;
  const root = document.documentElement;
  root.classList.remove(...THEME_CLASSES);
  root.classList.add(resolved);
  applyThemeColorMeta(resolved);
  return resolved;
}

function readStoredTheme(): Theme {
  try {
    const stored: unknown = localStorage.getItem('theme');
    if (isTheme(stored)) return stored;
  } catch {
    /* ignore */
  }
  // Өгөгдмөл (хэрэглэгч хараахан сэдэв сонгоогүй) = «Дундаж» (dim) —
  // `system` нь `getSystemPreference()`-ээр мөн `dim` рүү шийдэгдэнэ.
  return 'system';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  const [resolved, setResolved] = useState<ResolvedTheme>(() => applyThemeMode(readStoredTheme()));

  useEffect(() => {
    const r = applyThemeMode(theme);
    setResolved(r);
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = (next: Theme) => setThemeState(next);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolved }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
