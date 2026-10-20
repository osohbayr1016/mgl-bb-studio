import { useLanguage } from '@/shared/i18n';

/** Серверийн код → орчуулга; орчуулга байхгүй бол кодыг нь харуулна (`TOO_MANY_MEMBERS:7` → «Хэт олон таск (7)»). */
export function useCodeText() {
  const { t } = useLanguage();
  return (prefix: string, code: string): string => {
    const head = code.split(':')[0] ?? code;
    const key = `${prefix}.${head}`;
    const s = t(key);
    const tail = code.includes(':') ? ` (${code.slice(code.indexOf(':') + 1)})` : '';
    return s === key ? code : `${s}${tail}`;
  };
}
