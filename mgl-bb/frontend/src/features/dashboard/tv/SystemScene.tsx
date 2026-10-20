/**
 * «Системийн урсгал» — компанийн TV-ийн СҮҮЛИЙН кадр (30 сек, зөвхөн admin).
 *
 * System Workbench-ийн (`/app/admin/system-workbench`) амьд графыг TV-ийн
 * blueprint хэвээр, БҮТЭН өргөнөөр харуулна: бөөм бүр = НЭГ бодит хүсэлт.
 * GET бол өгөгдөл D1-ээс хэрэглэгч рүү, POST бол хэрэглэгчээс D1 рүү урсана;
 * Revit add-in-ийн хүсэлт «MGL Revit Add-in» зангилаанаас эхэлнэ (`routeMap.ts`).
 * Граф, бөөмийн хөдөлгүүр, урсгалын дүрэм нь workbench-тэй ИЖИЛ модулиуд
 * (`useGraphModel`, `LiveGraph`, `routeMap`) — хоёр харагдац зөрөхгүй.
 *
 * Хүсэлтийн тоо, сүүлийн хүсэлтийн жагсаалт ЗОРИУД байхгүй (эзэн 2026-10-07) —
 * TV-д зөвхөн урсгал.  Тоо нь workbench хуудсанд хэвээр.
 *
 * Зардал: WebSocket нь ЗӨВХӨН энэ кадр харагдах үед нээгдэнэ (mount → unmount),
 * өөрөөр хэлбэл ~170 секундын эргэлтийн 30 сек.  D1-д юу ч бичихгүй
 * (backend `lib/liveTraffic.ts`).
 *
 * Энэ файл `CompanyTvPage`-ээс `lazy()`-гаар ачаалагддаг тул workbench-ийн
 * граф TV-ийн үндсэн chunk-ийг томруулахгүй.
 */
import { LiveGraph } from '@/features/system-workbench/components/LiveGraph';
import { useGraphModel } from '@/features/system-workbench/live/useGraphModel';
import { useLiveTraffic } from '@/features/system-workbench/live/useLiveTraffic';
import { TONE_COLOR, type FlowTone } from '@/features/system-workbench/live/routeMap';
import { useLanguage } from '@/shared/i18n';
import { TV, metaStyle } from './theme';

const LEGEND: Array<[FlowTone, string]> = [
  ['read', 'companyTvPage.sysToneRead'],
  ['write', 'companyTvPage.sysToneWrite'],
  ['cache', 'companyTvPage.sysToneCache'],
  ['error', 'companyTvPage.sysToneError'],
];

export default function SystemScene() {
  const { t } = useLanguage();
  const live = useLiveTraffic(false, { replayRecent: 10 });
  const { graph, nodes, positions, hits } = useGraphModel(live);
  const noSignal = live.status === 'denied' || live.status === 'reconnecting';

  return (
    <section
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden"
      style={{ border: `1px solid ${TV.line}`, background: 'rgba(2,5,10,0.55)' }}
    >
      {/* Граф өөрийн мөрөнд — тайлбар доод мөрийн зангилаан дээр давхарлахгүй. */}
      <div className="relative min-h-0 flex-1">
        <LiveGraph
          ref={graph}
          nodes={nodes}
          positions={positions}
          selectedId={null}
          onSelect={noop}
          matchIds={null}
          hits={hits}
        />
      </div>
      <div
        className="pointer-events-none flex shrink-0 flex-wrap items-center gap-x-[1.4vw] gap-y-[0.6vh] px-[1.2vw] pb-[1.4vh] pt-[0.8vh]"
        style={{ ...metaStyle, color: TV.ink3, borderTop: `1px solid ${TV.line}` }}
      >
        {LEGEND.map(([tone, key]) => (
          <span key={tone} className="flex items-center gap-[0.4vw]">
            <span
              className="inline-block rounded-full"
              style={{
                width: '0.7vw',
                height: '0.7vw',
                background: TONE_COLOR[tone],
                boxShadow: `0 0 0.6vw ${TONE_COLOR[tone]}`,
              }}
            />
            {t(key)}
          </span>
        ))}
        <span style={{ letterSpacing: '0.08em', textTransform: 'none' }}>{t('companyTvPage.sysLegend')}</span>
      </div>
      <span
        className="absolute right-[1.2vw] top-[1.4vh] flex items-center gap-[0.4vw]"
        style={{ ...metaStyle, color: noSignal ? TV.gold : '#34d399' }}
      >
        <span
          className="inline-block rounded-full motion-safe:animate-pulse"
          style={{ width: '0.55vw', height: '0.55vw', background: 'currentColor' }}
        />
        {noSignal ? t('companyTvPage.sysNoSignal') : 'LIVE'}
      </span>
    </section>
  );
}

function noop() {}
