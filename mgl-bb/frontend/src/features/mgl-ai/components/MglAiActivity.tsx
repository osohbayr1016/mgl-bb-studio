/**
 * MGL AI · ГҮЙЦЭТГЭЛИЙН САМБАР (§6, §7, §28, §31, §32).
 *
 * ⚠️ ЭНЭ НЬ ГҮЙЦЭТГЭЛИЙН МӨШГӨЛТ, ЗАГВАРЫН БОДОЛ БИШ (§36).  Энд
 *    харагдах мөр бүр нь БОДИТ дуудлагатай нэг-нэгээр таарна: D1-ийн
 *    хүсэлт, локал SQLite-ийн хайлт, ERP-ийн хэрэгсэл.  «Гүнзгий бодож
 *    байна» гэх мэт чимэглэл нэмэх нь энэ бүрэлдэхүүн хэсгийн бүх
 *    үнэ цэнийг устгана — хэрэглэгч мөрүүдэд итгэхээ болино.
 *
 * ⚠️ ДУУССАНЫ ДАРАА ХУРААГДАНА (§28).  Ажиллаж байх үед дэлгэрэнгүй,
 *    дууссаны дараа «✓ 5 алхам · 1 эх сурвалж · 2.4 сек» болно —
 *    самбар нь хариултыг дарж болохгүй.
 *
 * ⚠️ `m.*` АШИГЛАНА, `motion.*` БИШ.  `app/providers.tsx` нь `LazyMotion`
 *    + `domMax`-тай — `motion.*` нь бүтэн багцыг татаж, lazy горимыг
 *    утгагүй болгоно.
 */
import { useId, useState } from 'react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { ChevronRight, Check, Loader2, FileText, X, AlertTriangle } from 'lucide-react';
import { formatMs, type AiSourceRef } from '@mgl/mglai-common/turn';
import { summarize, isRunning, type AiRun, type ActivityStep } from '@mgl/mglai-common/turn';

interface Props {
  run: AiRun;
  /** Эх сурвалж дээр дарахад — үзэгч хараахан байхгүй бол `undefined`. */
  onOpenSource?: (source: AiSourceRef) => void;
}

/* ================================================================== */
/*  НЭГ АЛХАМ                                                          */
/* ================================================================== */

function StepIcon({ status }: { status: ActivityStep['status'] }) {
  // ⚠️ ӨНГӨ БАЙ ГЭЖ ГАНЦААРАА МЭДЭЭЛЭХГҮЙ (§31).  Дүрс өөрөө төлөвийг
  //    хэлнэ — өнгө ялгаж чаддаггүй хэрэглэгч ч уншина.
  switch (status) {
    case 'done':
      return <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />;
    case 'failed':
      return <X className="size-3.5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />;
    case 'skipped':
      return <span className="size-3.5 shrink-0 text-center text-muted-foreground" aria-hidden>○</span>;
    default:
      return <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden />;
  }
}

const STATUS_WORD: Record<ActivityStep['status'], string> = {
  running: 'явагдаж байна',
  done: 'дууссан',
  failed: 'амжилтгүй',
  skipped: 'алгассан',
};

function StepRow({ step, reduced }: { step: ActivityStep; reduced: boolean }) {
  return (
    <m.li
      initial={reduced ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.18, ease: 'easeOut' }}
      className="flex items-start gap-2 py-0.5"
    >
      <span className="mt-0.5">
        <StepIcon status={step.status} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={step.status === 'skipped' ? 'text-muted-foreground' : undefined}>
          {step.label}
        </span>
        {/* ⚠️ Дэлгэц уншигчид төлөвийг ҮГЭЭР хэлнэ — дүрс нь тэдэнд алга. */}
        <span className="sr-only"> — {STATUS_WORD[step.status]}</span>
        {step.slowNotice !== null && (
          /* ⚠️ УДААШРАЛ = ТӨВИЙГ САХИСАН (§11).  Улаан БИШ, анхааруулга БИШ. */
          <span className="mt-0.5 block text-[11px] text-muted-foreground">{step.slowNotice}</span>
        )}
      </span>
      {step.durationMs !== null && step.status === 'done' && (
        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
          {formatMs(step.durationMs)}
        </span>
      )}
    </m.li>
  );
}

/* ================================================================== */
/*  ЭХ СУРВАЛЖ                                                         */
/* ================================================================== */

function sourceLabel(s: AiSourceRef): string {
  // ⚠️ БАЙХГҮЙ ХУУДСЫГ ЗОХИОХГҮЙ (§6).  `page` нь `null` бол мөр гарахгүй.
  const bits = [
    s.clause ? `заалт ${s.clause}` : null,
    s.page != null ? `хуудас ${s.page}` : null,
  ].filter(Boolean);
  return bits.join(' · ');
}

function SourceRow({
  source,
  onOpen,
}: {
  source: AiSourceRef;
  onOpen?: (s: AiSourceRef) => void;
}) {
  const sub = sourceLabel(source);
  const body = (
    <>
      <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        {/* ⚠️ ЖИЖИГ ДЭЛГЭЦЭД ТАСАРНА (§32) — `title` нь бүтнээр нь үзүүлнэ. */}
        <span className="block truncate" title={source.document ?? source.title}>
          {source.document ?? source.title}
        </span>
        {sub.length > 0 && (
          <span className="block truncate text-[11px] text-muted-foreground" title={sub}>
            {sub}
          </span>
        )}
      </span>
    </>
  );

  if (!onOpen) return <li className="flex items-start gap-2 py-0.5">{body}</li>;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(source)}
        className="flex w-full items-start gap-2 rounded py-0.5 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {body}
      </button>
    </li>
  );
}

/* ================================================================== */
/*  САМБАР                                                             */
/* ================================================================== */

export function MglAiActivity({ run, onOpenSource }: Props) {
  const reduced = useReducedMotion() ?? false;
  const running = isRunning(run.state);
  const panelId = useId();

  /**
   * ⚠️ АЖИЛЛАЖ БАЙХАД НЭЭЛТТЭЙ, ДУУСМАГЦ ХУРААГДАНА (§28).  Гэхдээ
   *    хэрэглэгч ГАРААР сольсон бол түүнийг ХҮНДЭТГЭНЭ — автомат хураалт
   *    нь хүний шийдвэрийг дарж болохгүй.
   */
  const [manual, setManual] = useState<boolean | null>(null);
  // ⚠️ ЭФФЕКТГҮЙ, ЗОРИУД.  Нээлттэй эсэх нь ГАРГАЖ АВАХ утга —
  //    `useEffect` + `setState`-ээр давхарлах нь каскад render үүсгэнэ
  //    (react-hooks/set-state-in-effect).  Хэрэглэгч гараар сольтол
  //    самбар нь ажиллаж байгааг ДАГАНА.
  const open = manual ?? running;

  const sum = summarize(run);

  // ⚠️ ЦОХИЛТ ИРЭХГҮЙ БОЛСОН ЭСЭХ (§10, §23).  «Өгөгдөл алга» ба
  //    «холболт тасарсан» ХОЁР ӨӨР ТӨЛӨВ.
  const reconnecting = run.state === 'RECONNECTING';

  const headline = running
    ? reconnecting
      ? 'Холболтыг сэргээж байна…'
      : 'MGL AI ажиллаж байна…'
    : [
        sum.steps > 0 ? `${sum.steps} алхам` : null,
        sum.sources > 0 ? `${sum.sources} эх сурвалж` : null,
        sum.totalMs !== null ? formatMs(sum.totalMs) : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Гүйцэтгэлийн мөшгөлт';

  if (run.steps.length === 0) return null;

  return (
    <div className="rounded-md border border-border/60 bg-background/50 text-xs">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setManual(!open)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <m.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: reduced ? 0 : 0.15 }}
          className="inline-flex"
        >
          <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
        </m.span>
        {running ? (
          <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
        ) : (
          <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{headline}</span>
      </button>

      {/*
        ⚠️ `aria-live="polite"` нь САМБАР ДЭЭР, мөр бүр дээр БИШ (§31).
           Мөр бүрд тавибал дэлгэц уншигч алхам бүрийг тасалдуулан
           уншиж, ашиглах боломжгүй болно.
      */}
      <div className="sr-only" aria-live="polite" aria-atomic="false">
        {run.steps.filter((s) => s.status === 'running').map((s) => s.label).join(', ')}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <m.div
            id={panelId}
            key="panel"
            initial={reduced ? { opacity: 1 } : { height: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 1 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-border/60 px-2.5 py-2">
              {run.turnNotice && (
                /* Ээлжийн тайлал — «Өмнөх сэдвийг үргэлжлүүлж байна: A».  Сервер
                   шийдсэн, бид бичсэн мөр; загварын бодол БИШ (§81). */
                <p className="text-[11px] text-muted-foreground">{run.turnNotice}</p>
              )}
              <ul className="space-y-0">
                <AnimatePresence initial={false}>
                  {run.steps.map((s) => (
                    <StepRow key={s.key} step={s} reduced={reduced} />
                  ))}
                </AnimatePresence>
              </ul>

              {run.sources.length > 0 && (
                <div className="border-t border-border/40 pt-1.5">
                  <p className="pb-0.5 text-[11px] font-medium text-muted-foreground">
                    {run.sources.length} эх сурвалж ашиглав
                  </p>
                  <ul className="space-y-0">
                    {run.sources.map((s) => (
                      <SourceRow key={s.id} source={s} onOpen={onOpenSource} />
                    ))}
                  </ul>
                </div>
              )}

              {run.incomplete && (
                /* ⚠️ §24 — дутуу хариултыг ИЛ тэмдэглэнэ. */
                <p className="flex items-start gap-1.5 border-t border-border/40 pt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                  Хариулт дуусаагүй байна — дундуур зогссон.
                </p>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
