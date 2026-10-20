/**
 * «Гарсан бүртгэл» товчны НЭГДСЭН урсгал — Ирц хуудас ба Хяналтын самбарын
 * widget хоёулаа.  Дүрэм нь цэвэр `clockOutFlow.ts`-д; энд зөвхөн төлөв.
 *
 *   start()  — товч дарахад: төлвийг серверээс ШИНЭЭР уншиж бүх нөхцөлийг
 *              шалгана.  Бэлэн бол `proceed` (popup нээх), аль хэдийн гарсан
 *              бол `onConfirmedOut`, үгүй бол «Гарах бүртгэл хийгдээгүй байна»
 *              цонхонд БҮХ шалтгааныг монголоор харуулна.  Товч хэзээ ч
 *              чимээгүй идэвхгүй болохгүй.
 *   handleSubmitError(err) — `POST /attendance/clock-out` унасан үед: popup
 *              дотор засаж болох бол тэр мессежийг буцаана; бусад үед popup-ыг
 *              хаалгаж шалтгааныг цонхонд харуулна; үр дүн тодорхойгүй
 *              (сүлжээ, 5xx, давтан дарсан) бол төлвийг дахин уншиж, сервер
 *              дээр гарсан байвал АМЖИЛТ гэж үзнэ.
 */
import { useCallback, useState } from 'react';
import {
  clockOutPreflight,
  resolveClockOutError,
  type ClockOutBlock,
  type ClockOutStatus,
} from './clockOutFlow';

export function useClockOutFlow({
  exempt,
  pgpMissing,
  projectsUnavailable,
  refetchStatus,
  proceed,
  onConfirmedOut,
}: {
  exempt: boolean;
  pgpMissing: boolean;
  projectsUnavailable: boolean;
  refetchStatus: () => Promise<{ data?: ClockOutStatus | null; isError: boolean }>;
  /** Бүх нөхцөл хангагдсан — гарах popup-ыг нээх (admin tier-т шууд илгээх). */
  proceed: () => void;
  /** Өнөөдрийн гарах бүртгэл сервер дээр хийгдсэн нь баталгаажсан. */
  onConfirmedOut: (clockOut: string) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [blocks, setBlocks] = useState<ClockOutBlock[] | null>(null);

  const readFresh = useCallback(async (): Promise<ClockOutStatus | null> => {
    try {
      const r = await refetchStatus();
      return r.isError ? null : (r.data ?? null);
    } catch {
      return null;
    }
  }, [refetchStatus]);

  const start = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    let fresh: ClockOutStatus | null = null;
    try {
      fresh = await readFresh();
    } finally {
      setChecking(false);
    }
    const res = clockOutPreflight(fresh, { exempt, pgpMissing, projectsUnavailable });
    if (res.kind === 'ready') proceed();
    else if (res.kind === 'already_out') onConfirmedOut(res.clockOut);
    else setBlocks(res.blocks);
  }, [checking, readFresh, exempt, pgpMissing, projectsUnavailable, proceed, onConfirmedOut]);

  /** Popup дотор харуулах мессеж (засаж болох алдаа) эсвэл `null` (шийдэгдсэн). */
  const handleSubmitError = useCallback(
    async (err: unknown): Promise<string | null> => {
      const r = resolveClockOutError(err);
      if (r.kind === 'inline') return r.message;
      if (r.kind === 'block') {
        setBlocks([r.block]);
        return null;
      }
      const fresh = await readFresh();
      const out = fresh && !fresh.clocked_in ? fresh.session?.clock_out : null;
      if (out) {
        onConfirmedOut(out);
        return null;
      }
      setBlocks([fresh && !fresh.clocked_in ? { kind: 'not_clocked_in' } : r.fallback]);
      return null;
    },
    [readFresh, onConfirmedOut],
  );

  return {
    start,
    checking,
    blocks,
    /** Шалтгааныг гаднаас харуулах (жишээ нь popup нээлттэй үед PGP хаалт). */
    showBlocks: setBlocks,
    dismiss: () => setBlocks(null),
    handleSubmitError,
  };
}
