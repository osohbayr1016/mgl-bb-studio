/**
 * Бичих хүсэлтийн `request_id` — ИЖИЛ ачааллын (payload) сүлжээний давталт ИЖИЛ id (сервер идемпотент: давхар
 * бичилт үүсэхгүй), ӨӨР ачаалал шинэ id.  `key` = ачааллыг дүрсэлсэн тогтвортой тэмдэгт мөр.
 */
import { useCallback, useRef } from 'react';

import { newRequestId } from './api';

export function useAttempt(): (key: string) => string {
  const ref = useRef<{ key: string; id: string } | null>(null);
  return useCallback((key: string) => {
    if (!ref.current || ref.current.key !== key) ref.current = { key, id: newRequestId() };
    return ref.current.id;
  }, []);
}
