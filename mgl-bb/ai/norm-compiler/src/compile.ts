/**
 * MGL AI · НОРМЫН ХӨРВҮҮЛЭГЧ — багцын хавтас → канон бүртгэл → үүсгэсэн TS.
 *
 *   dataset package  →  adapter (хэлбэр таних, канон болгох)
 *                    →  emit (детерминист TS + манифест)
 *                    →  backend/src/lib/mglai/norm/generated/
 *
 * ⚠️ Адаптер бүр ӨӨРИЙН файлын бүтцээр танигдана (`detect`), манифестын
 *    нэрээр БИШ — `datasetProfiles.ts`-ийн ижил дүрэм.  Шинэ багц = шинэ
 *    адаптер; `emit.ts`, `registryTypes.ts` хөндөгдөхгүй.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compileBd, detectBd, BD_ADAPTER_ID } from './adapters/bd-21-101-12.ts';
import { emitDocument, emitManifest, fileName } from './emit.ts';
import type { CompiledDocument } from './model.ts';
import { classifyVerification } from '../../retrieval/src/rules.ts';

/**
 * GAP-025: хөрвүүлсэн бичлэг бүрийн баталгаажилтын төлөв `rules.ts`-ийн ГУРВАН ангийн аль
 * нэгэнд байх ёстой.  Танигдаагүй төлөв = хөрвүүлэгч ЗОГСОНО (fail closed): бүртгэлд орсон
 * `executable: false` бичлэг нь чимээгүй хүний хяналт руу унадаг, харин ЯАГААД гэдгийг
 * хэн ч мэдэхгүй байсан.  Гүйцэтгэгдэхгүй ч БҮРТГЭЛТЭЙ төлөв (шалтгаантай) хэвийн.
 */
export function validateVerificationStatuses(doc: CompiledDocument): string[] {
  const unknown = new Map<string, number>();
  const add = (status: string): void => {
    if (classifyVerification(status) === 'unknown') unknown.set(status, (unknown.get(status) ?? 0) + 1);
  };
  for (const r of doc.rules) add(r.provenance.verificationStatus);
  for (const f of doc.formulas) add(f.provenance.verificationStatus);
  for (const c of doc.clauses) add(c.verificationStatus);
  return [...unknown.entries()].map(([k, n]) => `«${k}» ×${n}`);
}

/** Гүйцэтгэх гэж тэмдэглэгдсэн атлаа төлөв нь цагаан жагсаалтад байхгүй бичлэг — ЗӨРЧИЛ. */
export function executableWithoutWhitelist(doc: CompiledDocument): string[] {
  const bad: string[] = [];
  for (const r of doc.rules) if (r.executable && classifyVerification(r.provenance.verificationStatus) !== 'executable') bad.push(r.ruleId);
  for (const f of doc.formulas) if (f.executable && classifyVerification(f.provenance.verificationStatus) !== 'executable') bad.push(f.formulaId);
  return bad;
}

export interface NormAdapter {
  id: string;
  detect: (folder: string) => boolean;
  compile: (folder: string) => CompiledDocument;
}

function sizer(folder: string): (file: string) => number {
  return (file) => (existsSync(join(folder, file)) ? statSync(join(folder, file)).size : 0);
}

export const ADAPTERS: readonly NormAdapter[] = [
  { id: BD_ADAPTER_ID, detect: (folder) => detectBd(folder, sizer(folder)), compile: compileBd },
];

export function detectAdapter(folder: string): NormAdapter | null {
  for (const a of ADAPTERS) if (a.detect(folder)) return a;
  return null;
}

export interface CompileTarget {
  folder: string;
  adapter: NormAdapter;
}

/** Өгөгдлийн эх хавтсаас адаптер таарах бүх багцыг олно (таарахгүйг алгасна). */
export function discoverTargets(datasetRoot: string): { targets: CompileTarget[]; skipped: string[] } {
  const targets: CompileTarget[] = [];
  const skipped: string[] = [];
  if (!existsSync(datasetRoot)) return { targets, skipped };
  for (const name of readdirSync(datasetRoot).sort()) {
    const folder = join(datasetRoot, name);
    if (!statSync(folder).isDirectory()) continue;
    const adapter = detectAdapter(folder);
    if (adapter === null) skipped.push(name);
    else targets.push({ folder, adapter });
  }
  return { targets, skipped };
}

export interface EmittedFile {
  path: string;
  content: string;
}

export function compileTargets(targets: readonly CompileTarget[], outDir: string): { docs: CompiledDocument[]; files: EmittedFile[] } {
  const docs = targets.map((t) => t.adapter.compile(t.folder));
  const seen = new Set<string>();
  for (const d of docs) {
    if (seen.has(d.documentId)) throw new Error(`давхардсан баримт: ${d.documentId}`);
    seen.add(d.documentId);
    const unknown = validateVerificationStatuses(d);
    if (unknown.length > 0) {
      throw new Error(
        `${d.documentCode}: танигдаагүй баталгаажилтын төлөв ${unknown.join(', ')} — rules.ts-ийн ` +
          'EXECUTABLE_VERIFICATION эсвэл KNOWN_NON_EXECUTABLE_VERIFICATION-д (шалтгаантай) бүртгэ; хөрвүүлэгч ХААЛТТАЙ.',
      );
    }
    const leak = executableWithoutWhitelist(d);
    if (leak.length > 0) throw new Error(`${d.documentCode}: цагаан жагсаалтгүй атлаа executable: ${leak.slice(0, 5).join(', ')}`);
  }
  const files: EmittedFile[] = docs.map((d) => ({ path: join(outDir, fileName(d)), content: emitDocument(d) }));
  files.push({ path: join(outDir, 'manifest.generated.ts'), content: emitManifest(docs) });
  return { docs, files };
}

export interface CheckResult {
  ok: boolean;
  stale: string[];
  missing: string[];
}

/** `--check`: үүсгэх байсан агуулгыг дискийн файлтай БАЙТААР тулгана. */
export function checkFiles(files: readonly EmittedFile[]): CheckResult {
  const stale: string[] = [];
  const missing: string[] = [];
  for (const f of files) {
    if (!existsSync(f.path)) {
      missing.push(f.path);
      continue;
    }
    const cur = readFileSync(f.path, 'utf8').replace(/\r\n/g, '\n');
    if (cur !== f.content) stale.push(f.path);
  }
  return { ok: stale.length === 0 && missing.length === 0, stale, missing };
}

export function writeFiles(files: readonly EmittedFile[]): void {
  for (const f of files) {
    mkdirSync(resolve(f.path, '..'), { recursive: true });
    writeFileSync(f.path, f.content, 'utf8');
  }
}
