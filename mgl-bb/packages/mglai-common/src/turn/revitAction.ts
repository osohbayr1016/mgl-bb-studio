/**
 * REVIT ACTION CANDIDATE — ЗАГВАРЫН ГАРАЛТЫН ИТГЭМЖЛЭГДЭЭГҮЙ ГЭРЭЭ (Session R, R4.2 §5–§7).
 *
 * Qwen нь `RevitActionEnvelope` (гүйцэтгэх эрхтэй, итгэмжлэгдсэн) ХЭЗЭЭ Ч үүсгэхгүй.  Загвар зөвхөн
 * ЭНЭ саналыг хариултынхаа төгсгөлд нэг блокоор гаргаж болно:
 *
 *   <<<MGLAI-ACTION>>>{"schema_version":1,"action_type":"SET_PARAMETER","target":{"reference":"CURRENT_SELECTION"},
 *                     "arguments":{"parameter":"Comments","value":"..."},"reason_mn":"...","confidence":"medium"}<<<END-MGLAI-ACTION>>>
 *
 * Энэ объект нь САНАЛ — гүйцэтгэх эрхгүй.  Итгэмжлэгдсэн талбар (action_id, binding_hash, баримтын/өмнөх
 * төлөвийн хурууны хээ, нотолгоо, worksharing, баталгаа, аудит) ЭНД БАЙЖ БОЛОХГҮЙ — байвал бүхэлд нь ХАЯГДАНА.
 * Зорилт нь ЗӨВХӨН `CURRENT_SELECTION` — элементийн id-г загвар нэрлэхгүй; Revit-ийн детерминист binder
 * (`RevitActionBinder`, C#) шинэ snapshot-оос бодит ElementId/UniqueId, параметр, төрөл, байршлыг авч
 * `RevitActionEnvelope` үүсгэнэ, дараа нь preview + хэрэглэгчийн ИЛ баталгаа.
 *
 * Блок нь хариултын ТЕКСТЭЭС үүсгэлтийн ДАРАА ШУУД (хэлний засвар, давхардал, гэрээний өмнө) салгагдана —
 * JSON доторх тоо/латин үсэг validator-т хэзээ ч орохгүй.
 */

export const ACTION_BLOCK_START = '<<<MGLAI-ACTION>>>';
export const ACTION_BLOCK_END = '<<<END-MGLAI-ACTION>>>';

export type RevitActionCandidateType = 'SET_PARAMETER' | 'MOVE_ELEMENT' | 'CHANGE_TYPE';
export type RevitActionCandidateConfidence = 'low' | 'medium' | 'high';

export interface RevitActionCandidate {
  schema_version: 1;
  action_type: RevitActionCandidateType;
  target: { reference: 'CURRENT_SELECTION' };
  arguments: Record<string, string>;
  reason_mn: string;
  confidence: RevitActionCandidateConfidence;
}

/** Хатуу схем: төрөл бүрийн ЗӨВШӨӨРӨГДӨХ аргумент — өөр түлхүүр = хаягдана. */
export const CANDIDATE_ARGUMENT_KEYS: Record<RevitActionCandidateType, readonly string[]> = {
  SET_PARAMETER: ['parameter', 'value'],
  MOVE_ELEMENT: ['dx_mm', 'dy_mm', 'dz_mm'],
  CHANGE_TYPE: ['type_name'],
};
/** SET_PARAMETER-ийн параметрийн цагаан жагсаалт — Revit-ийн `ActionPreconditions.WritableParameterAllowlist`-ийн хос. */
export const CANDIDATE_PARAMETER_ALLOWLIST: readonly string[] = ['Comments', 'Mark', 'Description'];
const TOP_KEYS = ['schema_version', 'action_type', 'target', 'arguments', 'reason_mn', 'confidence'];
/** Итгэмжлэгдсэн талбар — загварын гаралтад байвал бүхэлд нь ХАЯНА. */
const FORBIDDEN_KEYS = /^(action_id|binding_hash|preview_id|doc_fingerprint|document_fingerprint|before|before_fingerprint|evidence|worksharing|preconditions|confirmed|confirmation|confirmed_by|audit|audit_seq|safety_level|proposal_source|requested_by|target_element_ids|target_unique_ids|element_id|unique_id)$/i;

export interface CandidateExtraction {
  /** Хариултын ХАРАГДАХ текст — блок хасагдсан. */
  text: string;
  /** Схемд тэнцсэн санал, эсвэл null. */
  candidate: RevitActionCandidate | null;
  /** Блок байсан ч хаягдсан бол шалтгаан (оношилгоо; хэрэглэгчид «санал зөвшөөрөгдөөгүй» гэж л). */
  rejected: string | null;
  /** Блок огт байсан эсэх. */
  found: boolean;
}

function num(s: unknown): boolean {
  return typeof s === 'string' && /^-?\d+(\.\d+)?$/.test(s.trim());
}

/** Түүхий объектыг хатуу схемээр шалгана — амжилт = candidate, эс бөгөөс шалтгаан. */
export function validateCandidate(raw: unknown): { candidate: RevitActionCandidate | null; reason: string | null } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { candidate: null, reason: 'not_object' };
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (FORBIDDEN_KEYS.test(k)) return { candidate: null, reason: `forbidden_field:${k}` };
    if (!TOP_KEYS.includes(k)) return { candidate: null, reason: `unknown_field:${k}` };
  }
  if (o.schema_version !== 1) return { candidate: null, reason: 'schema_version' };
  const type = o.action_type;
  if (type !== 'SET_PARAMETER' && type !== 'MOVE_ELEMENT' && type !== 'CHANGE_TYPE') return { candidate: null, reason: 'action_type' };
  const target = o.target as Record<string, unknown> | undefined;
  if (!target || typeof target !== 'object' || Object.keys(target).length !== 1 || target.reference !== 'CURRENT_SELECTION') return { candidate: null, reason: 'target' };
  const args = o.arguments as Record<string, unknown> | undefined;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { candidate: null, reason: 'arguments' };
  const allowed = CANDIDATE_ARGUMENT_KEYS[type];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(args)) {
    if (FORBIDDEN_KEYS.test(k)) return { candidate: null, reason: `forbidden_field:${k}` };
    if (!allowed.includes(k)) return { candidate: null, reason: `unknown_argument:${k}` };
    if (typeof v !== 'string' || v.length > 512) return { candidate: null, reason: `argument_type:${k}` };
    out[k] = v;
  }
  if (type === 'SET_PARAMETER') {
    if (!out.parameter || !CANDIDATE_PARAMETER_ALLOWLIST.includes(out.parameter)) return { candidate: null, reason: 'parameter_not_allowed' };
    if (out.value === undefined) return { candidate: null, reason: 'value_missing' };
  } else if (type === 'MOVE_ELEMENT') {
    const axes = ['dx_mm', 'dy_mm', 'dz_mm'].filter((k) => out[k] !== undefined);
    if (axes.length === 0) return { candidate: null, reason: 'delta_missing' };
    for (const k of axes) if (!num(out[k])) return { candidate: null, reason: `delta_not_number:${k}` };
  } else if (!out.type_name || out.type_name.trim().length === 0) return { candidate: null, reason: 'type_name_missing' };
  const reason = typeof o.reason_mn === 'string' ? o.reason_mn.slice(0, 300) : '';
  const conf = o.confidence === 'low' || o.confidence === 'medium' || o.confidence === 'high' ? o.confidence : 'low';
  return { candidate: { schema_version: 1, action_type: type, target: { reference: 'CURRENT_SELECTION' }, arguments: out, reason_mn: reason, confidence: conf }, reason: null };
}

/**
 * Хариултаас блокийг САЛГАЖ, хатуу схемээр шалгана.  Олон блок → эхнийх л, бусад нь хаягдана.
 * Гажуудсан/зөрчилтэй блок → `candidate: null`, `rejected` шалтгаантай; текстээс мөн хасагдана.
 */
export function extractActionCandidate(answer: string): CandidateExtraction {
  const start = answer.indexOf(ACTION_BLOCK_START);
  if (start < 0) return { text: answer, candidate: null, rejected: null, found: false };
  const endIdx = answer.indexOf(ACTION_BLOCK_END, start + ACTION_BLOCK_START.length);
  const bodyEnd = endIdx >= 0 ? endIdx : answer.length;
  const body = answer.slice(start + ACTION_BLOCK_START.length, bodyEnd).trim();
  // Бүх блокийг (дараагийнх ч) харагдах текстээс хасна.
  let text = answer.slice(0, start) + (endIdx >= 0 ? answer.slice(endIdx + ACTION_BLOCK_END.length) : '');
  text = text.replace(new RegExp(`${escape(ACTION_BLOCK_START)}[\\s\\S]*?(${escape(ACTION_BLOCK_END)}|$)`, 'g'), '').replace(/[ \t]+\n/g, '\n').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { text, candidate: null, rejected: 'json_parse', found: true };
  }
  const v = validateCandidate(parsed);
  return { text, candidate: v.candidate, rejected: v.reason, found: true };
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\<>]/g, '\\$&');
}
