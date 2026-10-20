/**
 * MGL AI · ХАРИУЛТЫН ТӨЛӨВИЙН МАШИН (§19).
 *
 * ⚠️ ЯАГААД `isLoading: boolean` ХҮРЭЛЦЭХГҮЙ ВЭ.  Хуучин хуудас нь
 *    `busy` гэсэн ганц тугтай байсан бөгөөд түүнээс «яг одоо юу болж
 *    байна» гэдгийг ГАРГАЖ АВАХ БОЛОМЖГҮЙ.  Тиймээс UI нь цорын ганц
 *    зүйл — анивчсан ▌ — үзүүлж чаддаг байв.  Бүх ялгаа энэ файлд:
 *    хайж байна уу, загвар бичиж байна уу, удаашралтай юу, тасарсан уу.
 *
 * ⚠️ ЭНЭ ФАЙЛ ЦЭВЭР.  Сүлжээ, React, таймер ЭНД БАЙХГҮЙ — `reduce` нь
 *    (төлөв, үйл явдал) → төлөв.  Ингэснээр §33-ийн бүх хувилбарыг
 *    хөтөчгүйгээр тестлэнэ (`frontend/scripts/check-ai-stream.mjs`).
 */
import {
  STAGE_LABEL,
  type AiStage,
  type AiStreamEvent,
  type AiSourceRef,
  isSourceEvent,
  isTokenEvent,
} from './aiEvents.ts';
import type { AiErrorShape } from './aiErrors.ts';

export type AiRunState =
  | 'IDLE'
  | 'SUBMITTING'
  | 'ACKNOWLEDGED'
  | 'PLANNING'
  | 'RETRIEVING'
  | 'USING_TOOLS'
  | 'VERIFYING'
  | 'GENERATING'
  | 'COMPLETED'
  | 'CANCELLING'
  | 'CANCELLED'
  | 'RECONNECTING'
  | 'FAILED';

/** UI-д харагдах нэг алхам. */
export interface ActivityStep {
  stage: AiStage;
  /** Тухайн үе шатны дотор олон алхам байж болно (хэрэгсэл бүр өөрийн). */
  key: string;
  label: string;
  status: 'running' | 'done' | 'failed' | 'skipped';
  durationMs: number | null;
  /** Удаашрал — ТӨВИЙГ САХИСАН тэмдэглэгээ, алдаа БИШ (§11). */
  slowNotice: string | null;
  startedAtMs: number;
}

export interface AiRun {
  requestId: string;
  state: AiRunState;
  steps: ActivityStep[];
  sources: AiSourceRef[];
  /** Урсаж буй хариултын текст. */
  answer: string;
  /** ⚠️ ҮҮСГЭЛТ ҮНЭХЭЭР ЭХЭЛСЭН эсэх — курсорыг ЗӨВХӨН энэ үед үзүүлнэ (§8). */
  generationStarted: boolean;
  firstTokenMs: number | null;
  totalMs: number | null;
  error: AiErrorShape | null;
  /** Сүүлийн цохилт ирснээс хойших мс — «амьд эсэх» (§10). */
  lastHeartbeatMs: number | null;
  /** ⚠️ §24 — үүсгэлт дундуур тасарсан бол хариулт ДУТУУ гэж тэмдэглэнэ. */
  incomplete: boolean;
  /** Асуултын санаа — UI-ийн шошго. */
  intent: string | null;
  regulatory: boolean;
  /** Ээлжийн тайлалын мөр («Өмнөх сэдвийг үргэлжлүүлж байна: A») — байвал. */
  turnNotice: string | null;
}

export function emptyRun(requestId: string): AiRun {
  return {
    requestId,
    state: 'SUBMITTING',
    steps: [],
    sources: [],
    answer: '',
    generationStarted: false,
    firstTokenMs: null,
    totalMs: null,
    error: null,
    lastHeartbeatMs: null,
    incomplete: false,
    intent: null,
    regulatory: false,
    turnNotice: null,
  };
}

/** Үе шат → төлөв.  ⚠️ ТӨЛӨВ нь үе шатнаас гардаг, тусад нь бичигдэхгүй. */
const STATE_OF: Record<AiStage, AiRunState> = {
  accept: 'ACKNOWLEDGED',
  plan: 'PLANNING',
  tools: 'USING_TOOLS',
  norm_retrieval: 'RETRIEVING',
  context: 'VERIFYING',
  generation: 'GENERATING',
  validate: 'VERIFYING',
  persist: 'VERIFYING',
};

function stepKey(e: AiStreamEvent): string {
  const sub = typeof e.metadata?.key === 'string' ? e.metadata.key : '';
  return `${e.stage ?? 'accept'}${sub ? `:${sub}` : ''}`;
}

/**
 * Үйл явдлыг төлөвт нэмнэ.
 *
 * ⚠️ ЭНЭ ФУНКЦ ХЭЗЭЭ Ч ЮУ Ч ЗОХИОХГҮЙ.  Ирсэн үйл явдалд байхгүй
 *    мэдээллийг нөхөж бичих нь §5-ийн «хуурамч явц гаргахгүй» дүрмийг
 *    зөрчинө — жишээ нь ирээгүй `source.found`-ыг таамаглах.
 */
export function reduce(run: AiRun, e: AiStreamEvent): AiRun {
  switch (e.type) {
    case 'request.accepted':
      return {
        ...run,
        state: 'ACKNOWLEDGED',
        steps: [
          {
            stage: 'accept',
            key: 'accept',
            label: e.safeUserMessage ?? STAGE_LABEL.accept.done,
            status: 'done',
            durationMs: e.durationMs ?? Math.round(e.atMs),
            slowNotice: null,
            startedAtMs: 0,
          },
        ],
      };

    case 'intent.detected':
      return {
        ...run,
        intent: typeof e.metadata?.intent === 'string' ? e.metadata.intent : run.intent,
        regulatory: e.metadata?.regulatory === true,
      };

    case 'language.detected':
      return run;

    case 'turn.interpreted':
      // ⚠️ Мөр нь СЕРВЕРИЙН тайлал — «Өмнөх сэдвийг үргэлжлүүлж байна: A».
      //    Мессеж байхгүй (шинэ сэдэв) бол юу ч нэмэхгүй.
      return e.safeUserMessage ? { ...run, turnNotice: e.safeUserMessage } : run;

    case 'stage.started': {
      const stage = e.stage ?? 'plan';
      const key = stepKey(e);
      // ⚠️ ИЖИЛ ТҮЛХҮҮР ДАВХАРДАХГҮЙ — дахин эхлүүлэх нь (retry) хуучин
      //    мөрийг ШИНЭЧИЛНЭ, доор нь хоёр дахь мөр НЭМЭХГҮЙ.
      const rest = run.steps.filter((s) => s.key !== key);
      return {
        ...run,
        state: STATE_OF[stage],
        steps: [
          ...rest,
          {
            stage,
            key,
            label: e.safeUserMessage ?? STAGE_LABEL[stage].running,
            status: 'running',
            durationMs: null,
            slowNotice: null,
            startedAtMs: e.atMs,
          },
        ],
      };
    }

    case 'stage.slow': {
      const key = stepKey(e);
      return {
        ...run,
        steps: run.steps.map((s) =>
          s.key === key && s.status === 'running'
            ? { ...s, slowNotice: e.safeUserMessage ?? null }
            : s,
        ),
      };
    }

    case 'stage.completed': {
      const key = stepKey(e);
      const skipped = e.metadata?.skipped === true;
      return {
        ...run,
        steps: run.steps.map((s) =>
          s.key === key
            ? {
                ...s,
                status: skipped ? 'skipped' : 'done',
                // ⚠️ ДУУССАН АЛХАМ ҮРГЭЛЖИЛСЭН ХЭЛБЭРТЭЙ ҮЛДЭЖ БОЛОХГҮЙ.
                //    `s.label` руу унах нь «Асуултыг ойлгож байна» гэсэн
                //    мөрийг ✓ тэмдэгтэй хамт үлдээж, ажил зогссон мэт
                //    харагдуулна.  Тодорхой шошго байхгүй бол тухайн үе
                //    шатны ДУУССАН хэлбэрийг ашиглана.
                label: e.safeUserMessage ?? STAGE_LABEL[s.stage].done,
                durationMs: e.durationMs ?? Math.round(e.atMs - s.startedAtMs),
                slowNotice: null,
              }
            : s,
        ),
      };
    }

    case 'source.search.started':
      return run;

    case 'source.found':
    case 'source.opened': {
      if (!isSourceEvent(e)) return run;
      // ⚠️ Давхардлыг id-гаар шүүнэ: ижил заалт хоёр хөлөөс ирж болно.
      if (run.sources.some((x) => x.id === e.source.id)) return run;
      return { ...run, sources: [...run.sources, e.source] };
    }

    case 'norm.rule.completed':
      return run;

    case 'tool.started':
    case 'tool.completed':
      return run;

    case 'generation.started':
      // ⚠️ КУРСОРЫН ГАНЦ ҮНЭН ЭХ СУРВАЛЖ (§8).  Үүнээс ӨМНӨ курсор
      //    үзүүлэх нь «бичиж байна» гэж ХУДЛАА хэлнэ.
      return { ...run, state: 'GENERATING', generationStarted: true };

    case 'answer.reset':
      // ⚠️ Зөвхөн ТЕКСТИЙГ цэвэрлэнэ.  Алхам, эх сурвалж, хугацаа нь
      //    ХЭВЭЭР — тэдгээр нь ҮНЭХЭЭР болсон үйлдлүүд (§5).
      return { ...run, answer: '' };

    case 'token':
      if (!isTokenEvent(e)) return run;
      return {
        ...run,
        state: 'GENERATING',
        answer: run.answer + e.text,
        firstTokenMs: run.firstTokenMs ?? Math.round(e.atMs),
        lastHeartbeatMs: e.atMs,
      };

    case 'heartbeat':
      // ⚠️ ШИНЭ МӨР НЭМЭХГҮЙ (§10) — зөвхөн «амьд» гэсэн тэмдэглэгээ.
      return {
        ...run,
        lastHeartbeatMs: e.atMs,
        state: run.state === 'RECONNECTING' ? 'GENERATING' : run.state,
      };

    case 'warning':
      // ⚠️ ХОЛБОЛТ ТАСАРСАН ба ӨГӨГДӨЛ АЛГА ХОЁР ӨӨР (§10, §23).  Цохилт
      //    ирэхээ болиход мессежийг УСТГАХГҮЙ — «сэргээж байна» гэж
      //    үзүүлээд, дараагийн цохилт/токен ирмэгц буцаж GENERATING
      //    болно.  Хуучин код нь энэ ялгааг мэддэггүй байсан тул
      //    түр зуурын завсарлага нь бүтэлгүйтэл мэт харагддаг байв.
      if (e.metadata?.connection === 'lost' && run.state === 'GENERATING') {
        return { ...run, state: 'RECONNECTING' };
      }
      return run;

    case 'completed':
      return {
        ...run,
        state: 'COMPLETED',
        totalMs: Math.round(e.atMs),
        steps: run.steps.map((s) =>
          s.status === 'running'
            ? {
                ...s,
                status: 'done',
                durationMs: Math.round(e.atMs - s.startedAtMs),
                slowNotice: null,
              }
            : s,
        ),
      };

    case 'cancelled':
      return {
        ...run,
        state: 'CANCELLED',
        totalMs: Math.round(e.atMs),
        // ⚠️ §24 — үүсгэлт эхэлсэн атлаа дуусаагүй бол ДУТУУ гэж тэмдэглэнэ.
        incomplete: run.generationStarted && run.answer.length > 0,
        steps: run.steps.map((s) =>
          s.status === 'running' ? { ...s, status: 'skipped', slowNotice: null } : s,
        ),
      };

    case 'failed':
      return {
        ...run,
        state: 'FAILED',
        totalMs: Math.round(e.atMs),
        incomplete: run.generationStarted && run.answer.length > 0,
        steps: run.steps.map((s) =>
          s.status === 'running' ? { ...s, status: 'failed', slowNotice: null } : s,
        ),
      };

    default:
      return run;
  }
}

/** Хураангуй мөр — «✓ 5 алхам · 1 эх сурвалж · 2.4 сек» (§28). */
export function summarize(run: AiRun): {
  steps: number;
  sources: number;
  totalMs: number | null;
} {
  return {
    steps: run.steps.filter((s) => s.status === 'done').length,
    sources: run.sources.length,
    totalMs: run.totalMs,
  };
}

/** Ажиллаж байгаа эсэх — оролтын талбар, «Зогсоох» товч үүгээр шийднэ. */
export function isRunning(state: AiRunState): boolean {
  return (
    state === 'SUBMITTING' ||
    state === 'ACKNOWLEDGED' ||
    state === 'PLANNING' ||
    state === 'RETRIEVING' ||
    state === 'USING_TOOLS' ||
    state === 'VERIFYING' ||
    state === 'GENERATING' ||
    state === 'RECONNECTING' ||
    state === 'CANCELLING'
  );
}
