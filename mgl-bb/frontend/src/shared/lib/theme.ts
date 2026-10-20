/**
 * Сэдвийн ЦЭВЭР (React-гүй) хэсэг.
 *
 * `ThemeContext.tsx` нь компонент экспортлодог тул Fast Refresh-ийн дүрмээр
 * (`react-refresh/only-export-components`) тэндээс тогтмол/функц гаргаж
 * болохгүй.  Түүнчлэн доорх туслахуудыг сэдвийг ТҮР ДАРЖ БИЧДЭГ маршрутууд
 * (LandingPage, LandingProjectDetailPage, ClientDashboardPage,
 * `useForceLightTheme`) хэрэглэдэг — тэдгээр нь `ThemeProvider`-оос хамааралгүй
 * тул энд байх нь бүтцийн хувьд ч зөв.
 */

export type Theme = 'dark' | 'dim' | 'light' | 'system';

/** Баримт бичигт ҮНЭХЭЭР тавигдах класс — `system` энд ХЭЗЭЭ Ч орохгүй. */
export type ResolvedTheme = 'dark' | 'dim' | 'light';

/**
 * `<html>`-д тавигдах боломжтой бүх сэдвийн класс.
 *
 * Класс сольж буй ГАЗАР БҮР эндээс уншина.  Өмнө нь дөрвөн газар
 * `classList.remove('dark', 'light')` гэж гараар бичдэг байсан бөгөөд
 * гуравдахь сэдэв нэмэгдэхэд тэд чимээгүй хоцорч, `.dim` арилалгүй
 * `.light`-тай ЗЭРЭГ таарах байв (`.dim` нь эх сурвалжид сүүлд байгаа тул
 * гэрэл горим руу шилжих ёстой газраа харанхуй хэвээр үлдэнэ).
 */
export const THEME_CLASSES: readonly ResolvedTheme[] = ['dark', 'dim', 'light'];

/**
 * `<html>`-ээс идэвхтэй сэдвийн классыг уншина (олдохгүй бол `light`).
 *
 * Сэдвийг түр дарж бичдэг маршрутууд буцаж сэргээхдээ үүнийг хэрэглэнэ:
 * mount дээр `currentThemeClass()`-ыг цээжилж, unmount дээр буцааж тавина.
 */
export function currentThemeClass(): ResolvedTheme {
  if (typeof document === 'undefined') return 'dark';
  const root = document.documentElement;
  return THEME_CLASSES.find((c) => root.classList.contains(c)) ?? 'light';
}

export const isTheme = (v: unknown): v is Theme =>
  v === 'dark' || v === 'dim' || v === 'light' || v === 'system';
