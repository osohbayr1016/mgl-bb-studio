import { useCallback, useEffect, useState } from 'react';
import {
  CircleCheck,
  Download,
  Loader2,
  RefreshCw,
  Settings2,
  TriangleAlert,
  Cpu,
} from 'lucide-react';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { apiFetch, apiFetchBlob } from '@/shared/api/client';

import {
  MODEL_STATE_LABEL,
  metrics as fetchMetrics,
  modelStateOf,
  setPerfProfile,
  type ModelState,
  type ProbeResult,
  type RuntimeMetrics,
} from '../lib/runtime';

/**
 * MGL AI · ЛОКАЛ ХӨДӨЛГҮҮРИЙН ХААЛГА (§5, §20, §38, §39).
 *
 * ⚠️ ХЭРЭГЛЭГЧ ПОРТ, ЗАМ, ТҮЛХҮҮР, ТОКЕН ХЭЗЭЭ Ч ХАРАХГҮЙ (§5).
 *    Техникийн бүх зүйл «Дэлгэрэнгүй»-н доор.  Энэ нь чимэглэл БИШ:
 *    ажилтан `39217` гэсэн тоог хараад ямар ч зөв үйлдэл хийж
 *    чадахгүй — зөвхөн айна.
 *
 * ⚠️ ТЕХНИКГҮЙ АЛДАА (§39).  «Холбогдож чадсангүй» гэсэн НЭГ мөр +
 *    ХОЁР товч ([Дахин оролдох] [Татах]).  `ECONNREFUSED`, stack trace
 *    нь «Дэлгэрэнгүй»-д.
 *
 * ⚠️ ЭНЭ КОМПОНЕНТ ЧАТЫГ ХААХГҮЙ.  Локал хөдөлгүүр байхгүй ч ERP-ийн
 *    хайлт, нормын эх сурвалж ажилласаар байна — тэр нь ХООСОН
 *    дэлгэцээс хамаагүй ашигтай.  Тиймээс энэ нь «хаалга» гэхээсээ
 *    илүү «төлөвийн мөр».
 */

interface InstallerInfo {
  available: boolean;
  version?: string;
  platform?: string;
  bytes?: number | null;
  release_note?: string | null;
  message?: string;
}

const TONE: Record<ModelState, string> = {
  NOT_INSTALLED: 'border-amber-500/40 text-amber-700 dark:text-amber-300',
  STARTING: 'border-border text-muted-foreground',
  MODEL_LOADING: 'border-border text-muted-foreground',
  READY: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  BUSY: 'border-border text-muted-foreground',
  UPDATING: 'border-sky-500/40 text-sky-700 dark:text-sky-300',
  ERROR: 'border-amber-500/40 text-amber-700 dark:text-amber-300',
};

function StateIcon({ state }: { state: ModelState }) {
  if (state === 'READY') return <CircleCheck className="size-3" aria-hidden />;
  if (state === 'NOT_INSTALLED' || state === 'ERROR')
    return <TriangleAlert className="size-3" aria-hidden />;
  return <Loader2 className="size-3 animate-spin" aria-hidden />;
}

export function RuntimeGate({
  probe,
  serverModel,
  onRefresh,
  onConnect,
}: {
  probe: ProbeResult | null;
  serverModel: { display_name: string } | null;
  onRefresh: () => void;
  onConnect: () => void;
}) {
  const state = modelStateOf(probe);
  const runtimeReason = probe && !probe.installed ? probe.reason : null;
  const [details, setDetails] = useState(false);
  const [installer, setInstaller] = useState<InstallerInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [live, setLive] = useState<RuntimeMetrics | null>(null);

  /**
   * ⚠️ ЖИВЭЭ ХЭМЖҮҮР — ЗӨВХӨН САМБАР НЭЭЛТТЭЙ ҮЕД (§28).
   *
   *    `/metrics` нь `nvidia-smi` асаадаг (~15 мс).  Түүнийг хаалттай
   *    байхад 3 секунд тутам дуудах нь ДИАГНОСТИК ӨӨРӨӨ ачаалал
   *    үүсгэнэ гэсэн үг — яг тэр нь энэ релизийн засаж буй асуудал.
   *    Тиймээс сонсогч нь `details` дээр ХАТУУ хамаарна.
   *
   * ⚠️ 3 СЕКУНД нь дур зоргоор биш: GPU-ийн ашиглалт нь ~1 секундэд
   *    хэлбэлздэг тул түүнээс богино нь чимээ, урт нь мэдээлэлгүй.
   */
  useEffect(() => {
    if (!details) {
      setLive(null);
      return;
    }
    let alive = true;
    const tick = () => {
      void fetchMetrics().then((m) => {
        if (alive) setLive(m);
      });
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [details]);

  /**
   * ⚠️ СУУЛГАГЧИЙН МЭДЭЭЛЛИЙГ ЗӨВХӨН ХЭРЭГТЭЙ ҮЕД АВНА.  Бэлэн байгаа
   *    ажилтны хувьд энэ хүсэлт ХЭРЭГГҮЙ — хуудас нээх бүрд дэмий
   *    дуудлага хийхгүй.
   */
  useEffect(() => {
    // Browser permission problems are not installer problems.
    if (state !== 'NOT_INSTALLED' || runtimeReason !== 'not_running' || installer !== null) return;
    let alive = true;
    apiFetch<InstallerInfo>('/mgl-ai/runtime/installer')
      .then((r) => {
        if (alive) setInstaller(r);
      })
      .catch(() => {
        if (alive) setInstaller({ available: false, message: 'Суулгагчийн мэдээлэл олдсонгүй.' });
      });
    return () => {
      alive = false;
    };
  }, [state, runtimeReason, installer]);

  /**
   * ⚠️ ТАТАЛТ НЬ ТОКЕНТОЙ.  Суулгагч нь `MEDIA_BUCKET`-Д БАЙХ ЁСГҮЙ —
   *    тэр нь нэвтрэлтгүй нийтийн зам (репогийн аюулгүй байдлын #2).
   *    Тиймээс энгийн `<a href>` биш, blob-оор татна.
   */
  const download = useCallback(async () => {
    setDownloading(true);
    try {
      /**
       * ⚠️ `<a href>`-ЭЭР ШУУД ТАТАХ БОЛОМЖГҮЙ.  Дээд түвшний шилжилт нь
       *    `Authorization` толгой авч явж чаддаггүй, мөн суулгагч нь
       *    ХУВИЙН bucket-д байна (нийтийн `/media/:key` нь нэвтрэлтгүй —
       *    репогийн аюулгүй байдлын #2).  Тиймээс blob-оор татаад
       *    object URL-ээр хадгална, `downloadPdf`-ийн ижил загвар.
       */
      const blob = await apiFetchBlob('/mgl-ai/runtime/installer/file');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MGL-AI-Setup${installer?.version ? `-${installer.version}` : ''}.exe`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // ⚠️ Алдааг ЧИМЭЭГҮЙ ЗАЛГИХГҮЙ, гэхдээ техникийн мөр үзүүлэхгүй.
      setInstaller((prev) => ({
        ...(prev ?? { available: true }),
        message: 'Татаж чадсангүй. Сүлжээгээ шалгаад дахин оролдоно уу.',
      }));
    } finally {
      setDownloading(false);
    }
  }, [installer?.version]);

  const changeProfile = useCallback(
    async (next: 'eco' | 'balanced' | 'performance') => {
      setProfileBusy(true);
      const r = await setPerfProfile(next);
      setProfileBusy(false);
      if (r.ok) onRefresh();
    },
    [onRefresh],
  );

  /* ── ЛОКАЛ RUNTIME ХОЛБОЛТ ─────────────────────────────────────── */
  if (state === 'NOT_INSTALLED') {
    const needsLoopbackPermission = runtimeReason === 'loopback_permission';
    const loopbackDenied = runtimeReason === 'loopback_denied';

    const title = needsLoopbackPermission
      ? 'MGL AI-тай холбох зөвшөөрөл хэрэгтэй'
      : loopbackDenied
        ? 'Chrome локал MGL AI-г хориглосон байна'
        : 'MGL AI локал үйлчилгээ ажиллахгүй байна';

    const description = needsLoopbackPermission
      ? 'Chrome-ийн “Apps on device” зөвшөөрлийг нэг удаа өгвөл энэ сайт таны компьютерт ажиллаж байгаа MGL AI-г шууд олно.'
      : loopbackDenied
        ? 'URL-ийн зүүн талын Site controls → Site settings → “Apps on device” хэсгийг Allow болгоод дахин шалгана уу.'
        : 'AI суусан боловч runtime асаагүй байж болно. Portable install одоо runtime-ийг автоматаар асаадаг.';

    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <TriangleAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
          <span className="font-medium">{title}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {needsLoopbackPermission ? (
            <Button size="sm" className="gap-1.5" onClick={onConnect}>
              <RefreshCw className="size-3.5" aria-hidden />
              MGL AI-тай холбох
            </Button>
          ) : loopbackDenied ? (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onRefresh}>
              <RefreshCw className="size-3.5" aria-hidden />
              Дахин шалгах
            </Button>
          ) : (
            <>
              <Button size="sm" className="gap-1.5" onClick={() => void download()} disabled={downloading}>
                {downloading ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Download className="size-3.5" aria-hidden />
                )}
                MGL AI татах
              </Button>
              <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={onRefresh}>
                <RefreshCw className="size-3" aria-hidden />
                Дахин шалгах
              </Button>
            </>
          )}
          {runtimeReason === 'not_running' && installer?.version && (
            <span className="text-[11px] text-muted-foreground">
              хувилбар {installer.version}
              {installer.bytes ? ` · ${(installer.bytes / 1048576).toFixed(0)} MB` : ''}
            </span>
          )}
          {runtimeReason === 'not_running' && installer && !installer.available && (
            <span className="text-[11px] text-amber-700 dark:text-amber-300">
              {installer.message}
            </span>
          )}
        </div>
      </div>
    );
  }

  /* ── БУСАД БҮХ ТӨЛӨВ — НЭГ МӨР ───────────────────────────────── */
  const info = probe?.installed && probe.authorized ? probe.info : null;
  const update = info?.update ?? null;
  const isEcho = info?.engine.engine === 'echo';

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className={`gap-1 ${TONE[state]}`}>
          <StateIcon state={state} />
          {state === 'READY'
            ? `${serverModel?.display_name ?? 'MGL AI'}${info?.adapter ? ` ${info.adapter.version}` : ''} · локал`
            : MODEL_STATE_LABEL[state]}
        </Badge>

        {/*
          ⚠️ ШИНЭЧЛЭЛТИЙН ЯВЦ — §20-ийн «MGL AI шинэчлэл татаж байна · 37%».
             Шидтэн БАЙХГҮЙ, товч БАЙХГҮЙ.  Хэрэглэгч юу ч хийхгүй.
        */}
        {update && update.message && update.phase !== 'idle' && (
          <span className="text-muted-foreground">
            {update.message}
            {update.percent != null && update.phase === 'downloading' ? ` · ${update.percent}%` : ''}
          </span>
        )}

        {/*
          ⚠️ ЗАГВАР СУУГААГҮЙГ НУУХГҮЙ.  Хэрэглэгч «MGL AI муу хариулж
             байна» гэж бодохын оронд «загвар суугаагүй» гэдгийг мэдэх
             ёстой — энэ нь техникийн дэлгэрэнгүй БИШ, шалтгаан.
        */}
        {isEcho && (
          <span className="text-amber-700 dark:text-amber-300">
            Загвар суугаагүй — олдсон эх сурвалжийг л харуулна.
          </span>
        )}

        {state === 'ERROR' && (
          <>
            <span className="text-muted-foreground">
              Энэ хаягнаас локал MGL AI руу хандах эрхгүй байна.
            </span>
            <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" onClick={onRefresh}>
              <RefreshCw className="size-3" aria-hidden />
              Дахин оролдох
            </Button>
          </>
        )}

        <button
          type="button"
          onClick={() => setDetails((v) => !v)}
          className="ml-auto text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {details ? 'Хураах' : 'Дэлгэрэнгүй'}
        </button>
      </div>

      {/*
        ⚠️ ЭНЭ ХЭСЭГ НЬ ХӨГЖҮҮЛЭГЧИЙН ДИАГНОСТИК (§28).  Өгөгдмөлөөр
           НУУГДСАН — хэвийн ажилтан үүнийг хэзээ ч харахгүй.
      */}
      {details && info && (
        <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <Cpu className="size-3" aria-hidden />
              {info.hardware.gpu ?? 'GPU илрээгүй'}
              {info.hardware.vramMb ? ` · ${(info.hardware.vramMb / 1024).toFixed(0)} GB VRAM` : ''}
            </span>
            {info.perf?.plan && (
              <span>
                контекст {info.perf.plan.contextTokens} · {info.perf.plan.threads} CPU урсгал
                {info.perf.plan.vramHeadroomMb != null
                  ? ` · нөөц ~${info.perf.plan.vramHeadroomMb} MB`
                  : ''}
              </span>
            )}
            <span>runtime {info.runtime_version}</span>
            {info.engine.quantization && <span>{info.engine.quantization}</span>}
          </div>

          {/*
            ⚠️ БУУЛТУУДЫГ ИЛ ХЭЛНЭ.  «Контекстыг 8192 → 4096 болгов» гэдэг
               нь хариултын ЧАНАРТ шууд нөлөөлнө — нуух нь хэрэглэгчийг
               төөрөгдүүлнэ.
          */}
          {(info.perf?.notices.length ?? 0) > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
              {info.perf!.notices.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}

          {/*
            ⚠️ ГҮЙЦЭТГЭЛИЙН ПРОФАЙЛ НЬ ДЭЛГЭРЭНГҮЙН ДОТОР (§13).
               Суулгах үед асуухгүй, автоматаар сонгоно; хүсвэл ЭНД
               өөрчилнө.
          */}
          {info.perf && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Settings2 className="size-3" aria-hidden />
              <span>Ачаалал:</span>
              {info.perf.options.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  disabled={profileBusy}
                  title={o.hint}
                  onClick={() => void changeProfile(o.key)}
                  className={
                    o.key === info.perf!.profile
                      ? 'rounded border border-primary/50 bg-primary/10 px-1.5 py-0.5 text-primary'
                      : 'rounded border border-transparent px-1.5 py-0.5 hover:border-border hover:bg-background'
                  }
                >
                  {o.name}
                </button>
              ))}
              {info.perf.source === 'auto' && <span className="opacity-70">(автоматаар сонгосон)</span>}
            </div>
          )}

          {/*
            ⚠️ ЖИВЭЭ НӨӨЦ (§28).  `null` = ХЭМЖИЖ ЧАДСАНГҮЙ, 0 ГЭСЭН ҮГ
               БИШ — тэр ялгааг мөрөнд нь хадгална.
          */}
          {live && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-1.5">
              <span>
                GPU{' '}
                {live.gpu?.utilPct != null ? `${live.gpu.utilPct}%` : '—'}
                {live.gpu?.vramUsedMb != null && live.gpu.vramFreeMb != null
                  ? ` · VRAM ${live.gpu.vramUsedMb} / ${live.gpu.vramUsedMb + live.gpu.vramFreeMb} MB`
                  : ''}
              </span>
              <span>
                RAM {live.runtime_process.rss_mb} MB · {Math.round(live.runtime_process.uptime_s / 60)} мин
              </span>
              <span>{live.busy ? 'үүсгэж байна' : 'сул'}</span>
              {live.idle_ms != null && live.idle_unload_ms > 0 && (
                <span>
                  сул зогсолт {Math.round(live.idle_ms / 60000)} /{' '}
                  {Math.round(live.idle_unload_ms / 60000)} мин
                </span>
              )}
              <span>{live.knowledge_installed ? 'норм суулгасан' : 'норм суулгаагүй'}</span>
            </div>
          )}

          {update?.error && (
            <p className="mt-1.5 text-amber-700 dark:text-amber-300">Шинэчлэлт: {update.error}</p>
          )}
          {info.engine_reason && <p className="mt-1.5 opacity-80">{info.engine_reason}</p>}
        </div>
      )}
    </div>
  );
}
