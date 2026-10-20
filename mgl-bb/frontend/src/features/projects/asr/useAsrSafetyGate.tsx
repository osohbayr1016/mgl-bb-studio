import { useCallback, useState } from 'react';
import { AsrReportTypeDialog } from './AsrReportTypeDialog';
import { AsrSafetyDialog } from './AsrSafetyDialog';
import type { AsrReportType } from './types';

/** «Шинэ тайлан»-гийн хаалгын үр дүн — ноорогт авч явна. */
export interface AsrNewReportStart {
  reportType: AsrReportType;
  /** ХАБ-ын баталгааны id — ЗӨВХӨН «Талбайн хяналт»-д; бусад төрөлд `null`. */
  safetyAckId: number | null;
}

/**
 * Гурван орох цэгийн («/app/asr» жагсаалт, төслийн харагдац, төслийн таб)
 * НЭГ хаалга.  `request(projectId, next)` нь:
 *   1. тайлангийн ТӨРӨЛ асууна (`AsrReportTypeDialog`, миграц 0362);
 *   2. «Талбайн хяналт» бол ХАБ-ын цонхыг нээнэ — баталгаа амжилттай бол
 *      `next({ reportType: 'site', safetyAckId })`;
 *   3. бусад төрөлд ХАБ-гүйгээр шууд `next({ reportType, safetyAckId: null })`
 *      (эзний шийдвэр 2026-09-29; сервер ч ижил дүрэмтэй — `routes/asrSafety.ts`).
 * Аль ч алхамд цуцалбал юу ч болохгүй.
 *
 * `key`-г хүсэлт бүрд солино — өмнөх удаагийн чагт/гарын үсэг үлдэхгүй,
 * дараагийн тайлан бүрд ШИНЭЭР зуруулна (нэг баталгаа = нэг тайлан).
 */
export function useAsrSafetyGate() {
  const [req, setReq] = useState<{
    projectId: number | null;
    nonce: number;
    /** `'type'` = төрлөө сонгож байна; `'safety'` = ХАБ-ын алхам (зөвхөн талбай). */
    stage: 'type' | 'safety';
    next: (start: AsrNewReportStart) => void;
  } | null>(null);

  const request = useCallback(
    (projectId: number | null, next: (start: AsrNewReportStart) => void) => {
      setReq({ projectId, nonce: Date.now(), stage: 'type', next });
    },
    [],
  );

  const close = (v: boolean) => {
    if (!v) setReq(null);
  };

  const element = !req ? null : req.stage === 'type' ? (
    <AsrReportTypeDialog
      key={req.nonce}
      open
      onOpenChange={close}
      onPicked={(reportType) => {
        if (reportType === 'site') {
          setReq({ ...req, stage: 'safety' });
          return;
        }
        const next = req.next;
        setReq(null);
        next({ reportType, safetyAckId: null });
      }}
    />
  ) : (
    <AsrSafetyDialog
      key={req.nonce}
      open
      projectId={req.projectId}
      onOpenChange={close}
      onConfirmed={(ackId) => {
        const next = req.next;
        setReq(null);
        next({ reportType: 'site', safetyAckId: ackId });
      }}
    />
  );

  return { request, element };
}
