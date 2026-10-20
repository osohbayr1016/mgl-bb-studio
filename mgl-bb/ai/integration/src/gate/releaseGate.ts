/**
 * MGL AI · РЕЛИЗИЙН ХААЛГА — МАШИНЫ УНШИЖ БОЛОХ ҮР ДҮН (Session D §10, §11, §35).
 *
 * ⚠️ ТЕСТИЙН АНГИЛЛУУДЫГ ХОЛИХГҮЙ.  UNIT ногоон гэдэг нь release-ready
 *    гэсэн үг БИШ.  Ангилал бүр ТУСДАА тайлагнагдана; `releaseReady` нь
 *    ЗӨВХӨН бүх ангилал ажилласан (`--full --e2e`) БА blocking хоосон үед true.
 *
 * ⚠️ FAIL-CLOSED.  Ажиллаагүй ангилал = `NOT_RUN`, «давлаа» БИШ.  Эзний
 *    WIP merge хийгдээгүй бол `BLOCKED_BY_<X>` — хувь хэмжээ ХЭЗЭЭ Ч
 *    хуурамчаар тооцохгүй.
 */
import type { CompatReport } from '../compat/matrix.ts';
import type { Versions } from '../compat/matrix.ts';

export const GATE_SCHEMA = 'mgl-ai-release-gate/1' as const;

export const TEST_CLASSES = ['UNIT', 'INTEGRATION', 'E2E', 'MODEL_EVAL', 'SECURITY', 'PERFORMANCE', 'INSTALLATION'] as const;
export type TestClass = (typeof TEST_CLASSES)[number];

export type Owner = 'A' | 'B' | 'C' | 'D' | 'backend' | 'frontend' | 'runtime' | 'repo';

export type SuiteStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'NOT_RUN' | 'BLOCKED';

export interface SuiteResult {
  id: string;
  class: TestClass;
  owner: Owner;
  status: SuiteStatus;
  /** Унасан бол релиз ХААГДАХ уу (blocking) эсвэл анхааруулга уу. */
  blocking: boolean;
  pass: number | null;
  fail: number | null;
  skipped: number | null;
  ms: number;
  cmd: string;
  /** Яагаад SKIPPED/BLOCKED — хэрэглэгчид харагдах мөр. */
  note?: string;
  /** Унасан тестийн нэрс (эхний 10). */
  failures?: string[];
}

export interface GateIssue {
  id: string;
  class: TestClass | 'COMPAT';
  owner: Owner;
  detail: string;
}

export const READINESS_AREAS = [
  'Core normative',
  'General AI',
  'Runtime',
  'Frontend',
  'Employee packaging',
  'Update',
  'Rollback',
  'Security',
  'Revit',
  'Telemetry',
  'Feedback',
  'Evaluation',
] as const;
export type ReadinessArea = (typeof READINESS_AREAS)[number];
export type ReadinessStatus = 'PASS' | 'FAIL' | 'BLOCKED_BY_A' | 'BLOCKED_BY_B' | 'BLOCKED_BY_C' | 'NOT_IMPLEMENTED' | 'NOT_RUN';

export interface ReleaseGate {
  schema: typeof GATE_SCHEMA;
  generatedAt: string;
  mode: 'fast' | 'full' | 'e2e';
  git: { commit: string | null; branch: string | null; dirty: boolean | null };
  versions: Versions;
  releaseReady: boolean;
  /** Яагаад releaseReady=false — эхний мөр нь хамгийн чухал шалтгаан. */
  notReadyBecause: string[];
  blocking: GateIssue[];
  warnings: GateIssue[];
  results: Record<TestClass, { status: SuiteStatus; suites: SuiteResult[] }>;
  compat: CompatReport | null;
  matrix: Record<ReadinessArea, { status: ReadinessStatus; note: string }>;
}

function classStatus(suites: SuiteResult[]): SuiteStatus {
  if (suites.length === 0) return 'NOT_RUN';
  if (suites.some((s) => s.status === 'FAIL')) return 'FAIL';
  if (suites.every((s) => s.status === 'NOT_RUN')) return 'NOT_RUN';
  if (suites.every((s) => s.status === 'SKIPPED' || s.status === 'BLOCKED' || s.status === 'NOT_RUN')) return 'BLOCKED';
  return 'PASS';
}

export interface ComposeInput {
  mode: ReleaseGate['mode'];
  git: ReleaseGate['git'];
  versions: Versions;
  suites: SuiteResult[];
  compat: CompatReport | null;
  /** Эзний WIP байгаа эсэх — merge хийгдээгүй файлууд (BLOCKED_BY_X шийдвэрт). */
  presence: { normCompiler: boolean; deployment: boolean; registry: boolean; readiness?: boolean };
  extraWarnings?: GateIssue[];
}

export function composeGate(input: ComposeInput): ReleaseGate {
  const results = Object.fromEntries(
    TEST_CLASSES.map((c) => {
      const suites = input.suites.filter((s) => s.class === c);
      return [c, { status: classStatus(suites), suites }];
    }),
  ) as ReleaseGate['results'];

  const blocking: GateIssue[] = [];
  const warnings: GateIssue[] = [];
  for (const s of input.suites) {
    if (s.status !== 'FAIL') continue;
    const issue: GateIssue = {
      id: s.id,
      class: s.class,
      owner: s.owner,
      detail: `${s.fail ?? '?'} унасан${s.failures?.length ? `: ${s.failures.slice(0, 3).join(' · ')}` : ''}`,
    };
    (s.blocking ? blocking : warnings).push(issue);
  }
  if (input.compat) {
    for (const i of input.compat.blocking) blocking.push({ id: `compat:${i.id}`, class: 'COMPAT', owner: i.owner, detail: i.detail });
    for (const i of input.compat.warnings) warnings.push({ id: `compat:${i.id}`, class: 'COMPAT', owner: i.owner, detail: i.detail });
  }
  warnings.push(...(input.extraWarnings ?? []));

  const notRun = TEST_CLASSES.filter((c) => results[c].status === 'NOT_RUN');
  const notReadyBecause: string[] = [];
  if (blocking.length > 0) notReadyBecause.push(`${blocking.length} blocking зөрчил`);
  if (input.mode !== 'e2e') notReadyBecause.push(`горим '${input.mode}' — E2E/MODEL_EVAL/PERFORMANCE ажиллаагүй (--e2e шаардлагатай)`);
  if (notRun.length > 0) notReadyBecause.push(`ажиллаагүй ангилал: ${notRun.join(', ')}`);
  if (!input.presence.deployment) notReadyBecause.push('Session B ai/deployment merge хийгдээгүй');
  if (!input.presence.registry) notReadyBecause.push('Session A нормын бүртгэл merge хийгдээгүй');
  if (input.presence.readiness === false) notReadyBecause.push('Session C production-readiness merge хийгдээгүй');

  const matrix = readinessMatrix(results, input.presence, blocking);

  return {
    schema: GATE_SCHEMA,
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    git: input.git,
    versions: input.versions,
    releaseReady: notReadyBecause.length === 0,
    notReadyBecause,
    blocking,
    warnings,
    results,
    compat: input.compat,
    matrix,
  };
}

/** Энэ горимд АЖИЛЛАСАН (эсвэл BLOCKED) suite — NOT_RUN нь «байхгүй»-тэй адил. */
function has(results: ReleaseGate['results'], id: string): SuiteResult | undefined {
  for (const c of TEST_CLASSES) {
    const s = results[c].suites.find((x) => x.id === id);
    if (s && s.status !== 'NOT_RUN') return s;
  }
  return undefined;
}

function blockedBy(owner: Owner): ReadinessStatus {
  return owner === 'A' ? 'BLOCKED_BY_A' : owner === 'B' ? 'BLOCKED_BY_B' : owner === 'C' ? 'BLOCKED_BY_C' : 'NOT_RUN';
}

function statusOf(...suites: (SuiteResult | undefined)[]): ReadinessStatus {
  const present = suites.filter((s): s is SuiteResult => s !== undefined);
  if (present.length === 0) return 'NOT_RUN';
  if (present.some((s) => s.status === 'FAIL')) return 'FAIL';
  const blocked = present.find((s) => s.status === 'BLOCKED');
  if (blocked) return blockedBy(blocked.owner);
  if (present.every((s) => s.status === 'PASS')) return 'PASS';
  return 'NOT_RUN';
}

/** Хэмжигдсэн suite-үүдийн нэрс — тэмдэглэлд. */
function measured(...suites: (SuiteResult | undefined)[]): string {
  const p = suites.filter((s): s is SuiteResult => s !== undefined);
  return p.length ? p.map((s) => `${s.id}=${s.status}`).join(' ') : 'юу ч хэмжигдээгүй';
}

/**
 * §35 — бүс тус бүрд ЯГ ЮУ хэмжигдсэнийг тэмдэглэнэ.  Хувь хэмжээ БАЙХГҮЙ.
 */
export function readinessMatrix(
  results: ReleaseGate['results'],
  presence: ComposeInput['presence'],
  blocking: GateIssue[],
): ReleaseGate['matrix'] {
  const m = {} as ReleaseGate['matrix'];
  const set = (a: ReadinessArea, status: ReadinessStatus, note: string) => {
    m[a] = { status, note };
  };

  const retrieval = has(results, 'ai:retrieval');
  const normCompiler = has(results, 'ai:norm-compiler');
  const normGold = has(results, 'eval:norm');
  set(
    'Core normative',
    !presence.registry || !presence.normCompiler ? 'BLOCKED_BY_A' : statusOf(retrieval, normCompiler, normGold),
    !presence.registry ? 'norm-compiler/registry WIP merge хийгдээгүй' : `${measured(retrieval, normCompiler, normGold)}${normGold ? '' : ' · GOLD (eval:norm) --e2e-д'}`,
  );

  const beUnit = has(results, 'backend:mglai');
  const conv = has(results, 'eval:conv');
  const smoke = has(results, 'int:e2e-smoke');
  const cGen = [has(results, 'c:intent-routing'), has(results, 'c:conversation-context'), has(results, 'c:units-numbers-language'), has(results, 'c:streaming-faults')];
  set('General AI', statusOf(beUnit, ...cGen, smoke, conv), `${measured(beUnit, ...cGen, smoke, conv)}${conv ? '' : ' · MODEL_EVAL --e2e-д'}`);

  const rtUnit = has(results, 'ai:runtime');
  const rtContract = has(results, 'int:runtime-contract');
  set('Runtime', statusOf(rtUnit, rtContract), measured(rtUnit, rtContract));

  const feTsc = has(results, 'fe:tsc');
  const feCheck = has(results, 'fe:check-ai');
  set('Frontend', statusOf(feTsc, feCheck), `${measured(feTsc, feCheck)}${feTsc ? '' : ' · tsc --full-д'}`);

  const deploy = has(results, 'ai:deployment');
  const clean = has(results, 'int:clean-machine');
  set('Employee packaging', !presence.deployment ? 'BLOCKED_BY_B' : statusOf(deploy, clean), presence.deployment ? measured(deploy, clean) : `ai/deployment merge хийгдээгүй · ${measured(clean)}`);
  set('Update', !presence.deployment ? 'BLOCKED_BY_B' : statusOf(deploy), presence.deployment ? `${measured(deploy)} · staging симуляц §27 хараахан алга` : 'хоёр манифест загвар (D1 vs mgl-ai-release/1) нэгдээгүй');
  set('Rollback', 'NOT_IMPLEMENTED', 'ModelManager.rollback() кодтой ч автомат тест алга (§27)');

  const sec = [has(results, 'int:secrets'), has(results, 'int:redaction-cross'), has(results, 'common:redaction'), has(results, 'backend:visibility'), has(results, 'ai:auth'), has(results, 'c:hallucination-contract'), has(results, 'c:security-injection')];
  set('Security', statusOf(...sec), measured(...sec));
  set('Revit', 'NOT_IMPLEMENTED', 'Revit add-in ↔ MGL AI E2E алга (C scorecard ч NOT_IMPLEMENTED); permission ladder/revitContext unit л backend-д');
  set('Telemetry', !presence.deployment ? 'BLOCKED_BY_B' : 'NOT_IMPLEMENTED', '/runtime/heartbeat нь runtime_version+model_version л; knowledge/registry/adapter тамга алга');
  set('Feedback', statusOf(beUnit), `${measured(beUnit)} · request_id хадгалагдахгүй (warning)`);
  const evalSuites = [has(results, 'c:dataset-lint'), has(results, 'c:training-lint'), has(results, 'c:live-backend'), has(results, 'int:e2e-smoke'), has(results, 'eval:norm'), has(results, 'eval:conv'), has(results, 'eval:company')];
  set('Evaluation', statusOf(...evalSuites), evalSuites.some(Boolean) ? measured(...evalSuites) : 'MODEL_EVAL/E2E --e2e-д; e2e.mjs нь secret-ийг env-ээс авахгүй (C)');

  // Blocking зөрчилтэй бүс FAIL болно — эзэн нь өөр байсан ч.
  for (const b of blocking) {
    if (b.class === 'SECURITY') m['Security'] = { status: 'FAIL', note: b.detail };
    if (b.class === 'INSTALLATION') m['Employee packaging'] = { status: 'FAIL', note: b.detail };
  }
  return m;
}
