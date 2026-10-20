/**
 * TV самбарын жижиг форматлагчид.
 *
 * ⚠ Тусдаа файл байгаа шалтгаан: `SceneMeta.tsx` нь ЗӨВХӨН component
 * экспортлох ёстой (`react-refresh/only-export-components`) — тэнд функц
 * нэмбэл fast-refresh тухайн файлыг бүтнээр нь дахин ачаалдаг болно.
 */

/** `YYYY-MM-DD` → `MM/DD`.  Тэмдэгтийн урт тогтмол тул mono-д эгнэнэ. */
export function formatMd(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return '—';
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}
