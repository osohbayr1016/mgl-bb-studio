/**
 * MGL AI · АЛДААНЫ АНГИЛАЛ (§20).
 *
 * ⚠️ ГОЛ ШИЙДВЭР: АЛДАА БҮР УЛААН БАЙХ ЁСГҮЙ.  Өмнө нь `send()`-ийн
 *    ганц `catch` нь БҮХ зүйлийг — timeout, «нотолгоо олдсонгүй»,
 *    цуцлалт хүртэл — `text-rose-600` болгож харуулдаг байв.  Хэрэглэгч
 *    «систем эвдэрсэн» гэж уншдаг байсан ч ихэнхдээ систем зөв
 *    ажилласан байдаг.
 *
 *    Тиймээс алдаа бүр `severity` авна:
 *      • `error`  — жинхэнэ гэмтэл.  Улаан.
 *      • `notice` — хүлээгдэж болох үр дүн (нотолгоо алга, цуцлагдсан).
 *                   ТӨВИЙГ САХИСАН өнгө.  Энэ нь БҮТЭЛГҮЙТЭЛ БИШ.
 *      • `offline`— локал үйлчилгээ ажиллахгүй.  Заавартай, үйлдэлтэй.
 *
 * ⚠️ `RETRIEVAL_NO_MATCH` ба `RETRIEVAL_TIMEOUT` НЬ ХОЁР ӨӨР ЗҮЙЛ (§17).
 *    Эхнийх нь «сан дотор байхгүй», хоёр дахь нь «сан хариулж амжсангүй».
 *    Хоёуланг нь «эх сурвалж олдсонгүй» гэж нэгтгэх нь хэрэглэгчийг
 *    ХУДАЛ мэдээлэлд хүргэнэ — тэр нь мэдлэгийн санд байхгүй гэж
 *    итгээд ажлаа буруу хийнэ.
 */

export const AI_ERROR_CODES = [
  'NETWORK_ERROR',
  'LOCAL_RUNTIME_OFFLINE',
  'MODEL_NOT_READY',
  'MODEL_ERROR',
  'ERP_TIMEOUT',
  'RETRIEVAL_TIMEOUT',
  'RETRIEVAL_NO_MATCH',
  'REVIT_UNAVAILABLE',
  'PERMISSION_DENIED',
  'NORM_EVIDENCE_MISSING',
  'GENERATION_FAILED',
  'GENERATION_REPETITION',
  'GENERATION_TIMEOUT',
  'CANCELLED',
  // ── Session C (2026-09-11) — мандат §18-ын ялгаа: нэвтрэлт ≠ эрх, backend
  //    унтарсан ≠ хайлт хугацаа, урсгал ТАСАРСАН ≠ дууссан, контекст хэтэрсэн.
  'AUTH_EXPIRED',
  'SERVICE_UNAVAILABLE',
  'BACKEND_OFFLINE',
  'GENERATION_INTERRUPTED',
  'CONTEXT_OVERFLOW',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export type AiErrorSeverity = 'error' | 'notice' | 'offline';

export interface AiErrorShape {
  code: AiErrorCode;
  severity: AiErrorSeverity;
  /** Хэрэглэгчид харагдах монгол мөр. */
  message: string;
  /** Товчны шошго — байвал UI үйлдэл санал болгоно. */
  action?: 'retry' | 'retry_generation' | 'start_runtime';
  hint?: string;
}

const TABLE: Record<AiErrorCode, Omit<AiErrorShape, 'code'>> = {
  NETWORK_ERROR: {
    severity: 'error',
    message: 'Серверт холбогдож чадсангүй.',
    hint: 'Интернэт холболтоо шалгаад дахин оролдоно уу.',
    action: 'retry',
  },
  LOCAL_RUNTIME_OFFLINE: {
    severity: 'offline',
    message: 'MGL AI local runtime ажиллахгүй байна.',
    hint: 'Ажлын хэсэгт «npm run ai:start» ажиллуулж, дараа нь дахин оролдоно уу.',
    action: 'start_runtime',
  },
  MODEL_NOT_READY: {
    severity: 'notice',
    message: 'MGL AI загварыг бэлдэж байна.',
    hint: 'Загвар ачаалагдмагц хариулт эхэлнэ.',
    action: 'retry',
  },
  MODEL_ERROR: {
    severity: 'error',
    message: 'Загвар хариулт үүсгэх үед алдаа гарлаа.',
    action: 'retry_generation',
  },
  ERP_TIMEOUT: {
    severity: 'notice',
    message: 'Компанийн мэдээлэл хугацаанд ирсэнгүй.',
    hint: 'Хариултыг амьд өгөгдөлгүйгээр бэлтгэв — тоо дутуу байж болно.',
    action: 'retry',
  },
  RETRIEVAL_TIMEOUT: {
    // ⚠️ ЭНЭ НЬ «ОЛДСОНГҮЙ» ГЭСЭН ҮГ БИШ.  §17-ийн хатуу шаардлага.
    severity: 'notice',
    message: 'Эх сурвалжийн хайлт хугацаанд дууссангүй.',
    hint: 'Сан дотор байхгүй гэсэн үг БИШ. Дахин оролдвол олдож магадгүй.',
    action: 'retry',
  },
  RETRIEVAL_NO_MATCH: {
    severity: 'notice',
    message: 'Энэ асуултад тохирох баталгаатай эх сурвалж олдсонгүй.',
  },
  REVIT_UNAVAILABLE: {
    severity: 'notice',
    message: 'Revit-ийн мэдээлэл алга байна.',
    hint: 'Revit нээлттэй, MGL нэмэлт суулгасан эсэхийг шалгана уу.',
  },
  PERMISSION_DENIED: {
    severity: 'error',
    message: 'Энэ мэдээллийг үзэх эрхгүй байна.',
  },
  NORM_EVIDENCE_MISSING: {
    // ⚠️ ДЭД БҮТЦИЙН ГЭМТЭЛ БИШ (§20).  Систем зөв ажиллаж, «мэдэхгүй»
    //    гэж ҮНЭНЭЭ хэлж байна — тэр нь зохиосон хариултаас ДЭЭР.
    severity: 'notice',
    message: 'Энэ шаардлагыг баталгаатай хэлэх эх сурвалж олдсонгүй.',
    hint: 'Норм дүрмийн хариултыг зөвхөн баталгаажсан эх сурвалжтай үед өгнө.',
  },
  GENERATION_FAILED: {
    severity: 'error',
    message: 'Хариулт үүсгэж чадсангүй.',
    action: 'retry_generation',
  },
  GENERATION_REPETITION: {
    /**
     * ⚠️ ЭНЭ НЬ ХЭРЭГЛЭГЧИЙН БУРУУ БИШ, ДЭД БҮТЦИЙН ГЭМТЭЛ Ч БИШ —
     *    загвар давталтад орсныг систем БАРЬЖ, үүсгэлтийг ЗОГСООСОН.
     *    Тиймээс `error` биш `notice`: систем зөв ажилласан.
     * ⚠️ Хариултыг ЗӨВ гэж үзэхгүй (§7) — «Дахин бичих» нь цорын ганц
     *    зөв үйлдэл, харин тэр нь АВТОМАТААР НЭГ Л удаа хийгдэнэ.
     */
    severity: 'notice',
    message: 'Хариулт давтагдаж эхэлсэн тул зогсоолоо.',
    hint: 'Энэ хариулт бүрэн бус. Дахин бичүүлж болно.',
    action: 'retry_generation',
  },
  GENERATION_TIMEOUT: {
    severity: 'notice',
    message: 'Хариулт үүсгэх хугацаа дууслаа.',
    hint: 'Загвар ердийнхөөс удаан ажиллаж байна.',
    action: 'retry_generation',
  },
  CANCELLED: {
    severity: 'notice',
    message: 'Зогсоолоо.',
  },
  AUTH_EXPIRED: {
    /** 401 нь «эрхгүй» БИШ — сесс дууссан.  Өмнө нь PERMISSION_DENIED болж
     *  «Энэ мэдээллийг үзэх эрхгүй» гэж хэлдэг байв (хэмжсэн, Session C). */
    severity: 'error',
    message: 'Нэвтрэлтийн хугацаа дууссан байна.',
    hint: 'Дахин нэвтэрч орно уу.',
  },
  SERVICE_UNAVAILABLE: {
    /** Сервер 503 — MGL AI түр зогсоосон / захиалагчийн горим унтраалттай.
     *  Интернэт шалгах зөвлөгөө ЭНД буруу. */
    severity: 'notice',
    message: 'MGL AI үйлчилгээ түр боломжгүй байна.',
    action: 'retry',
  },
  BACKEND_OFFLINE: {
    /** Серверт огт хүрсэнгүй (сүлжээ/DNS/worker унтарсан) — «эх сурвалжийн
     *  хайлт хугацаанд дууссангүй» гэсэн буруу мөр гардаг байв (хэмжсэн). */
    severity: 'error',
    message: 'Компанийн сервертэй холбогдож чадсангүй.',
    hint: 'Интернэт холболтоо шалгаад дахин оролдоно уу.',
    action: 'retry',
  },
  GENERATION_INTERRUPTED: {
    /** Урсгал ДУНДАА тасарсан (runtime унасан, `done` ирээгүй) — хариулт
     *  ДУТУУ.  Өмнө нь дутуу хариулт «бүрэн» мэт хадгалагддаг байв (хэмжсэн). */
    severity: 'notice',
    message: 'Хариулт дундаа тасарлаа.',
    hint: 'Локал MGL AI-тай холболт тасарсан тул энэ хариулт бүрэн бус. Дахин бичүүлж болно.',
    action: 'retry_generation',
  },
  CONTEXT_OVERFLOW: {
    /** Runtime 413 — prompt + хариулт цонхонд багтахгүй.  Хэрэглэгчийн
     *  хийж чадах зүйл нь асуултаа богиносгох / шинэ яриа эхлүүлэх. */
    severity: 'notice',
    message: 'Асуулт болон нотолгоо нь загварын контекстын цонхонд багтахгүй байна.',
    hint: 'Асуултаа богиносгох эсвэл шинэ яриа эхлүүлнэ үү.',
  },
};

/**
 * ХАРИУЛТ ХҮЧИНГҮЙ болгодог кодууд (Session C, 2026-09-11).
 *
 * ⚠️ Эдгээр хариултын текст ДАРААГИЙН ээлжийн `history`-д ОРОХГҮЙ: давталтад
 *    орсон, хугацаа дууссан, дундаа тасарсан, цуцлагдсан текст нь загварыг
 *    дахин ижил гажиг руу түлхдэг (CLAUDE.md «давталттай хариулт нь
 *    хадгалагдахгүй»).  Өмнө нь `severity === 'error'` л шүүгддэг байсан тул
 *    `notice`-тэй давталтын текст түүхэд орж байв (хэмжсэн).
 */
const INVALID_ANSWER_CODES: ReadonlySet<AiErrorCode> = new Set([
  'GENERATION_REPETITION',
  'GENERATION_TIMEOUT',
  'GENERATION_INTERRUPTED',
  'GENERATION_FAILED',
  'MODEL_ERROR',
  'CANCELLED',
  'CONTEXT_OVERFLOW',
]);

export function isInvalidAnswer(shape: Pick<AiErrorShape, 'code'> | null | undefined): boolean {
  return !!shape && INVALID_ANSWER_CODES.has(shape.code);
}

export function aiError(code: AiErrorCode, override?: Partial<AiErrorShape>): AiErrorShape {
  return { code, ...TABLE[code], ...override };
}

/**
 * Түүхий алдааг ангилна.
 *
 * ⚠️ `ApiNetworkError`-ийн timeout нь ҮЕ ШАТААС хамаарч ӨӨР утгатай:
 *    хайлтын үед `RETRIEVAL_TIMEOUT`, ERP-ийн үед `ERP_TIMEOUT`.  Тиймээс
 *    үе шатыг ЗААВАЛ дамжуулна — «нэг timeout, нэг алдаа» гэсэн хуучин
 *    загвар нь яг «20 секундэд хариу өгсөнгүй» гэсэн утгагүй мөрийг
 *    төрүүлж байсан.
 */
export function classifyError(err: unknown, stage: string): AiErrorShape {
  const name = (err as { name?: string } | null)?.name ?? '';
  const status = (err as { status?: number } | null)?.status;

  if (name === 'AbortError') return aiError('CANCELLED');
  // ⚠️ 401 ≠ 403 (Session C): сесс дууссан хүнд «эрхгүй» гэж хэлэх нь буруу зам заана.
  if (status === 401) return aiError('AUTH_EXPIRED');
  if (status === 403) return aiError('PERMISSION_DENIED');
  if (status === 503) {
    const msg = (err as Error | null)?.message;
    return aiError('SERVICE_UNAVAILABLE', msg ? { message: msg } : undefined);
  }

  const timedOut = (err as { timedOut?: boolean } | null)?.timedOut === true;
  const network = name === 'ApiNetworkError' || name === 'TypeError';

  if (timedOut) {
    if (stage === 'tools') return aiError('ERP_TIMEOUT');
    if (stage === 'norm_retrieval' || stage === 'context') return aiError('RETRIEVAL_TIMEOUT');
    if (stage === 'generation') return aiError('MODEL_ERROR');
    return aiError('NETWORK_ERROR');
  }
  if (network) {
    // ⚠️ Хугацаа дуусаагүй, ХОЛБОГДООГҮЙ: энэ нь «хайлт удаан» биш, сервер
    //    хүрэхгүй байна.  Хоёрыг холих нь «эх сурвалжийн хайлт дууссангүй»
    //    гэсэн буруу мөр гаргаж байв (хэмжсэн, Session C).
    if (stage === 'tools') return aiError('ERP_TIMEOUT');
    if (stage === 'norm_retrieval') return aiError('RETRIEVAL_TIMEOUT');
    if (stage === 'generation') return aiError('LOCAL_RUNTIME_OFFLINE');
    return aiError('BACKEND_OFFLINE');
  }

  if (stage === 'generation') return aiError('GENERATION_FAILED');
  return aiError('NETWORK_ERROR', {
    message: (err as Error | null)?.message || 'Тодорхойгүй алдаа гарлаа.',
  });
}
