#!/usr/bin/env node
/**
 * `npm run ai:ingest -- <файл|хавтас> [сонголтууд]`
 *
 * MGL AI-д норм, дүрэм, компанийн баримтыг ОРУУЛНА.
 *
 * ⚠️ ЭНЭ НЬ СУРГАЛТ БИШ, ХАЙЛТ (§14).  Баримт нь загварын ЖИНД ОРОХГҮЙ —
 *    хайлтын индекст орж, асуулт бүрд эшлэлтэйгээр татагдана.  Тиймээс:
 *      • шинэ БНбД ирэхэд ЗҮГЭЭР дахин ажиллуулна, дахин сургахгүй
 *      • буруу оруулсныг устгаад дахин оруулж болно
 *      • загварын хувилбар өөрчлөгдөхөд баримт ХЭВЭЭР үлдэнэ
 *
 * ДЭМЖИХ ФОРМАТ:
 *      .txt .md      — заалтын дугаараар автоматаар хуваана
 *      .json         — [{clause_no, page_no, heading, text}, …] эсвэл {rows:[…]}
 *      .csv          — толгойтой: clause_no,page_no,heading,text
 *      .docx         — Word (PowerShell-ээр задалж текст гаргана)
 *      хавтас        — доторх бүх дэмжигдэх файлыг дараалан оруулна
 *
 * ⚠️ PDF: шууд дэмжихгүй.  Word/Acrobat дээрээс «Save as → Plain text»
 *    хийж .txt болгоно уу.  Шалтгаан: PDF-ийн текст гаргалт нь баганын
 *    дараалал, хүснэгтийг сүйтгэдэг бөгөөд БУРУУ гаргасан заалт нь
 *    БУРУУ ЭШЛЭЛ болно — тэр нь мэргэжлийн баримтад хүлээн зөвшөөрөгдөхгүй.
 *    Гараар шалгасан текст нь дээр.
 *
 * ЖИШЭЭ:
 *    export MGLAI_TOKEN="<админы токен>"
 *    npm run ai:ingest -- ./bnbd-21-01-02.txt \
 *        --doc-uid BNBD-21-01-02 \
 *        --title "БНбД 21-01-02 Галын аюулгүй байдал" \
 *        --public
 */
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../runtime/src/config.ts';

const cfg = loadConfig();
const TOKEN = process.env.MGLAI_TOKEN ?? '';
const API = (process.env.MGLAI_CONTROL_PLANE ?? cfg.controlPlaneUrl).replace(/\/+$/, '');

/* ── Аргументууд ──────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === '--help') {
  process.stdout.write(readFileSync(new URL(import.meta.url)).toString().split('*/')[0] + '\n');
  process.exit(0);
}

const target = resolve(argv[0]);
function flag(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
}
const has = (name) => argv.includes(`--${name}`);

if (!TOKEN) {
  process.stderr.write('\n  ✖ MGLAI_TOKEN тохируулаагүй байна (админы ERP токен).\n\n');
  process.exit(1);
}

/* ── Текст гаргах ─────────────────────────────────────────────────── */

/**
 * .docx-оос текст гаргана.
 *
 * ⚠️ Node-д ZIP задлагч БАЙХГҮЙ тул Windows-ийн `Expand-Archive`-ыг
 *    ашиглана.  Гуравдагч пакет нэмэхээс зайлсхийсэн — энэ хоолой нь
 *    ажилтны машин дээр биш, зөвхөн админы машин дээр ажиллана.
 */
function docxToText(path) {
  const dir = mkdtempSync(join(tmpdir(), 'mglai-docx-'));
  try {
    const zip = join(dir, 'doc.zip');
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Copy-Item -LiteralPath '${path}' -Destination '${zip}'; ` +
        `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`,
    ]);
    const xml = readFileSync(join(dir, 'word', 'document.xml'), 'utf8');
    return (
      xml
        // Догол мөр, мөр таслалтыг ХАДГАЛНА — заалтын хил тэднээр тодорхойлогдоно.
        .replace(/<w:p[ >]/g, '\n<w:p ')
        .replace(/<w:br\s*\/>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Энгийн CSV задлагч — хашилтад орсон таслалыг хүндэтгэнэ. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length < 2) return [];

  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => {
      o[h] = (r[i] ?? '').trim();
    });
    return {
      clause_no: o.clause_no || o['заалт'] || null,
      page_no: Number(o.page_no || o['хуудас']) || null,
      heading: o.heading || o['гарчиг'] || null,
      text: o.text || o['текст'] || '',
    };
  });
}

function loadFile(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.json') {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const rows = Array.isArray(parsed) ? parsed : (parsed.rows ?? null);
    if (!Array.isArray(rows)) throw new Error('JSON нь массив эсвэл {rows:[…]} байх ёстой.');
    return { rows };
  }
  if (ext === '.csv') return { rows: parseCsv(readFileSync(path, 'utf8')) };
  if (ext === '.docx') return { text: docxToText(path) };
  if (ext === '.txt' || ext === '.md') return { text: readFileSync(path, 'utf8') };
  if (ext === '.pdf') {
    throw new Error(
      'PDF-ийг шууд оруулахгүй.  «Save as → Plain text» хийж .txt болгоно уу ' +
        '(PDF-ийн автомат гаргалт нь заалтыг эвдэж, БУРУУ эшлэл үүсгэдэг).',
    );
  }
  throw new Error(`Дэмжигдэхгүй формат: ${ext}`);
}

/* ── Илгээх ───────────────────────────────────────────────────────── */

async function post(payload) {
  const res = await fetch(`${API}/api/mgl-ai/admin/knowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${body.error ?? 'тодорхойгүй'}`);
  return body;
}

/**
 * Том баримтыг ХЭСЭГЧЛЭН илгээнэ.
 *
 * ⚠️ Сервер нь нэг хүсэлтэд 400 хэсгээр хязгаарладаг.  Энд текстийг
 *    ойролцоогоор тэр хэмжээгээр таслаж, `append: true`-ээр залгуулна.
 *    ЭХНИЙ хэсэг нь `append` БИШ — тэр нь хуучин агуулгыг цэвэрлэнэ.
 */
async function ingestOne(path) {
  const name = basename(path);
  const docUid = flag('doc-uid') ?? name.replace(/\.[^.]+$/, '').slice(0, 64);
  const title = flag('title') ?? name;

  const payloadBase = {
    doc_uid: docUid,
    title,
    title_en: flag('title-en'),
    source_kind: flag('source-kind') ?? 'regulation',
    document_uid: flag('document-uid') ?? docUid,
    clause_uid_prefix: flag('clause-prefix') ?? flag('document-uid') ?? docUid,
    version: flag('version'),
    effective_from: flag('effective-from'),
    lang: flag('lang') ?? 'mn',
    // ⚠️ ӨГӨГДМӨЛ нь ДОТООД.  Норм нь нийтийнх бол `--public` гэж ИЛ зарлана
    //    — санамсаргүй нийтлэхээс сэргийлнэ.
    classification: has('public') ? 'public' : (flag('classification') ?? 'internal'),
    visibility_scope: has('public') ? 'public' : (flag('visibility') ?? 'company'),
    project_id: flag('project-id') ? Number(flag('project-id')) : undefined,
  };

  const loaded = loadFile(path);

  // ── Бүтэцтэй мөр ──────────────────────────────────────────────
  if (loaded.rows) {
    const rows = loaded.rows;
    let added = 0;
    let first = true;
    for (let i = 0; i < rows.length; i += 300) {
      const r = await post({
        ...payloadBase,
        rows: rows.slice(i, i + 300),
        append: !first,
      });
      added += r.chunks_added;
      first = false;
    }
    return { docUid, title, added, mode: 'rows' };
  }

  // ── Түүхий текст ──────────────────────────────────────────────
  const text = loaded.text;
  // Ойролцоогоор 400 хэсэг ≈ 400 × 1200 тэмдэгт.  Аюулгүйн зайтай.
  const SLICE = 300_000;
  if (text.length <= SLICE) {
    const r = await post({ ...payloadBase, text });
    return { docUid, title, added: r.chunks_added, withClause: r.with_clause_no, mode: 'text' };
  }

  let added = 0;
  let withClause = 0;
  let first = true;
  for (let i = 0; i < text.length; i += SLICE) {
    // ⚠️ Мөрийн хилээр таслана — заалт дундуур таслах нь хоёр талд
    //    хагас заалт үлдээнэ.
    let end = Math.min(i + SLICE, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end);
      if (nl > i) end = nl;
    }
    const r = await post({ ...payloadBase, text: text.slice(i, end), append: !first });
    added += r.chunks_added;
    withClause += r.with_clause_no;
    first = false;
  }
  return { docUid, title, added, withClause, mode: 'text (хэсэгчилсэн)' };
}

/* ── Ажиллуулах ───────────────────────────────────────────────────── */

const SUPPORTED = new Set(['.txt', '.md', '.json', '.csv', '.docx']);

const files = statSync(target).isDirectory()
  ? readdirSync(target)
      .filter((f) => SUPPORTED.has(extname(f).toLowerCase()))
      .map((f) => join(target, f))
  : [target];

if (files.length === 0) {
  process.stderr.write(`\n  ✖ Дэмжигдэх файл олдсонгүй: ${target}\n\n`);
  process.exit(1);
}

process.stdout.write(`\nMGL AI · мэдлэг шингээх — ${files.length} файл\n  ${API}\n\n`);

let ok = 0;
let failed = 0;
for (const f of files) {
  try {
    const r = await ingestOne(f);
    const clauseNote =
      r.withClause !== undefined ? ` · заалттай ${r.withClause}` : '';
    process.stdout.write(
      `  ✔ ${basename(f)}\n     ${r.docUid} — ${r.added} хэсэг${clauseNote} (${r.mode})\n`,
    );
    ok += 1;
  } catch (err) {
    process.stdout.write(`  ✖ ${basename(f)}\n     ${err.message}\n`);
    failed += 1;
  }
}

process.stdout.write(`\n  ${ok} амжилттай, ${failed} алдаа\n`);
process.stdout.write(
  `\n  Шалгах:  curl -H "Authorization: Bearer $MGLAI_TOKEN" \\\n` +
    `           "${API}/api/mgl-ai/admin/knowledge/search?q=<хайх+үг>"\n\n`,
);
if (failed > 0) process.exitCode = 1;
