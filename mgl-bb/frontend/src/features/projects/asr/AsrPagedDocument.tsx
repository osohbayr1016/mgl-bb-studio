import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AsrDocument, AsrRunningHeader, type AsrDocumentProps } from './AsrDocument';
import { asrProjectName } from './asrProjectName';
import { ASR_SHEET_GAP_MM } from './asrPrintStyles';

/**
 * Зохиогчийн хяналтын баримтыг ДЭЛГЭЦ ДЭЭР A4 хуудсуудад хувааж харуулна —
 * хэвлэхэд гарах ЯГ тэр хуудаслалт (эзний хүсэлт 2026-09-28: тайлан нээхэд
 * засварлах маягт биш, шууд хэвлэгдэх баримт харагдана).
 *
 * Хуудаслалтыг ЭНЭ файл тооцоолдоггүй — браузер өөрөө хуваана
 * (`asrPrintStyles.ts`-ийн `SHEET_STYLES` тайлбарыг үз).  Энд зөвхөн гурван
 * тоо хэмжинэ:
 *   1) толгойн бодит өндөр — агуулгын талбайн өндөр түүнээс хамаарна;
 *   2) хуудасны тоо — multicol-ийн нийт өндрөөс (N×297 + (N−1)×завсар);
 *   3) багтаах масштаб — утас/таблетад 210мм өргөн цаас дэлгэцэнд багтах
 *      ёстой.  `transform: scale` (layout хөндөгдөхгүй) — мөр таслалт
 *      жижиг дэлгэцэн дээр ч хэвлэлттэй ИЖИЛ хэвээр.
 *
 * Хэмжилт бүр ResizeObserver-ээр: зураг, вэб фонт хожуу ачаалагдахад
 * хуудасны тоо өөрөө шинэчлэгдэнэ.  RO нь transform-ыг тооцдоггүй layout
 * хэмжээ өгдөг тул масштабаас хамаарахгүй.
 *
 * `column-wrap` дэмждэггүй хөтөч (Firefox, Safari, Chrome < 145) дээр хуучин
 * нэг урт цаас (`.asr-paper`) — агуулга нь ижил, зөвхөн хуудасны зааг алга.
 */

const PX_PER_MM = 96 / 25.4;
const PAGE_W_PX = 210 * PX_PER_MM;
const PAGE_H_PX = 297 * PX_PER_MM;
const GAP_PX = ASR_SHEET_GAP_MM * PX_PER_MM;

function supportsSheets(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  return CSS.supports('column-wrap', 'wrap') && CSS.supports('column-height', '10mm');
}

export function AsrPagedDocument(props: AsrDocumentProps) {
  const [paged] = useState(supportsSheets);
  if (!paged) {
    return (
      <div className="asr-paper">
        <AsrDocument {...props} />
      </div>
    );
  }
  return <AsrSheets {...props} />;
}

function AsrSheets(props: AsrDocumentProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sheetsRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  /** Дэлгэцэнд байгаа өргөн (px); 0 = хараахан хэмжээгүй. */
  const [avail, setAvail] = useState(0);
  const [stageH, setStageH] = useState(PAGE_H_PX);
  const [headH, setHeadH] = useState<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const sheets = sheetsRef.current;
    const head = headRef.current;
    if (!host || !sheets || !head) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const box = e.borderBoxSize?.[0];
        const block = box ? box.blockSize : e.contentRect.height;
        if (e.target === host) setAvail(e.contentRect.width);
        else if (e.target === sheets) setStageH(block);
        else if (e.target === head) setHeadH(block);
      }
    });
    ro.observe(host);
    ro.observe(sheets);
    ro.observe(head);
    return () => ro.disconnect();
  }, []);

  const pages = Math.max(1, Math.round((stageH + GAP_PX) / (PAGE_H_PX + GAP_PX)));
  const scale = avail > 0 ? Math.min(1, avail / PAGE_W_PX) : 1;
  const vars = {
    '--asr-scale': scale,
    '--asr-stage-h': `${stageH}px`,
    ...(headH != null ? { '--asr-head-h': `${headH}px` } : {}),
  } as CSSProperties;
  const headName = asrProjectName(props.projectName);

  return (
    // Эхний хэмжилт хүртэл нуух — утсан дээр масштабгүй 210мм цаас нэг
    // агшин гарч ирээд агшихаас сэргийлнэ.  Хэвлэхэд `visibility` нь
    // `ASR_DOC_STYLES`-ийн `body * { visibility: visible !important }`-оор дарагдана.
    <div
      ref={hostRef}
      className="asr-sheets-host"
      style={{ ...vars, visibility: avail > 0 ? undefined : 'hidden' }}
      data-asr-pages={pages}
    >
      <div className="asr-sheets-scaler">
        <div className="asr-sheets-stage">
          <div className="asr-sheet-layer" aria-hidden>
            {Array.from({ length: pages }, (_, i) => (
              <div
                key={i}
                className="asr-sheet-card"
                style={{ top: `calc(${i} * (297mm + ${ASR_SHEET_GAP_MM}mm))` }}
              >
                <div ref={i === 0 ? headRef : undefined} className="asr-doc asr-sheet-head">
                  <AsrRunningHeader entry={props.entry} projectName={headName} />
                </div>
              </div>
            ))}
          </div>
          <div ref={sheetsRef} className="asr-sheets">
            <AsrDocument {...props} />
          </div>
        </div>
      </div>
    </div>
  );
}
