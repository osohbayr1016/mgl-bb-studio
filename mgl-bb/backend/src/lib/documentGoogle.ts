/**
 * Баримт бичгийн архивын Office файлыг Google дээр засах УРСГАЛ.
 *
 * Нэг хөрвүүлэлт ХОЁР зүйлийг тэжээнэ:
 *
 *   • УРЬДЧИЛАН ХАРАХ  — Google-ээс PDF болгож экспортлоод ХУВИЙН bucket-д
 *     кэшлэнэ.  Front-end нь түүнийг authed fetch-ээр авч `blob:` iframe-д
 *     үзүүлдэг.  Яагаад blob гэдгийг `AttachmentPreviews.tsx` тайлбарласан:
 *     манай origin нь cross-origin isolated тул HTTP хаягаар ачаалсан PDF
 *     iframe дотор Chrome-ийн үзүүлэгч АЖИЛЛАХГҮЙ.
 *
 *   • ЗАСАХ — Google Docs/Sheets-ийн жинхэнэ realtime хамтын засвар, ШИНЭ
 *     ТАБ-д.  Хуудсан дотор iframe-ээр оруулах нь боломжгүй (`officeDocs.ts`
 *     дээрх тайлбар).
 *
 * ⚠️ ЯАГААД Google-ийн хуулбар нь ЭХ СУРВАЛЖ БИШ ВЭ: архивын үнэн эх нь
 * R2 дээрх файл хэвээр.  Google дээрх нь ажлын хуулбар бөгөөд буцааж татах
 * үед л архивт буудаг.  Ингэснээр Google унтарсан ч архив бүрэн үлдэнэ.
 *
 * ⚠️ .docx/.xlsx/.pptx-ийг ХӨРВҮҮЛЭХГҮЙ (2026-09-07).  Google Docs тэдгээрийг
 * эх OOXML хэлбэрээр нь шууд засдаг (Office editing mode) бөгөөд realtime
 * хамтын засвар ижилхэн ажилладаг.  Хөрвүүлж байсан үед Word-ийн агуулгын
 * жагсаалтын tab-stop/цэгэн залгаас задарч, мөр нь тэгширч уншигдахгүй
 * болдог байв — эзний хэмжсэн бодит алдаа.  Хуучин формат (.doc/.xls/.rtf/
 * .odt/.csv) нь эх хэлбэрээрээ засагдаж чадахгүй тул тэдгээр л хөрвүүлэгдэж,
 * буцахдаа орчин үеийн өргөтгөлтэй болно (.doc → .docx).
 *
 * Аль ч тохиолдолд буцааж татахдаа ХУУЧИН ХУВИЛБАРЫГ ДАРЖ БИЧИХГҮЙ — үргэлж
 * ШИНЭ revision үүсгэдэг тул эх файл түүхэнд бүрэн үлдэж, буцаах боломжтой.
 */
import type { Env } from '../types';
import {
  DRIVE_UPLOAD_MAX_BYTES,
  DriveApiError,
  isScopeError,
  driveCopyAs,
  driveDeleteForever,
  driveDownload,
  driveExport,
  driveGetMeta,
  driveShare,
  driveTrash,
  driveUpload,
  driveEnabled,
} from './google/driveClient';
import {
  exportedFileName,
  googleEditUrl,
  officeSpec,
  specForKind,
  type OfficeSpec,
} from './officeDocs';

/** Засаж дуусаад энэ хугацаанд хөдөлгөөнгүй бол «сесс завсарлав» гэж үзээд
 *  автоматаар архив руу татна.  Богино байвал бичиж байх зуур нь татаж
 *  хагас дутуу хувилбар үүсгэнэ, урт байвал хүн хүлээнэ. */
const QUIET_MS = 5 * 60 * 1000;

/** Нэг cron эргэлтэд хэдэн холболт шалгах вэ.  `scheduled` нь CPU/wall
 *  хязгаартай бөгөөд Drive дуудлага бүр сүлжээний hop. */
const SWEEP_BATCH = 15;

export interface GoogleFileRow {
  id: number;
  document_id: number;
  revision_id: number;
  kind: string;
  google_file_id: string;
  edit_url: string;
  share_mode: string | null;
  preview_key: string | null;
  drive_modified_at: string | null;
  synced_revision_id: number | null;
  opened_by: number | null;
  source_url: string | null;
  last_synced_at: string | null;
  status: string;
}

export interface RevisionRow {
  id: number;
  document_id: number;
  revision_number: number;
  file_url: string;
  file_name: string;
  file_size: number | null;
}

/** Google дээр засах боломжгүй шалтгааныг UI-д уншигдахуйц болгож дамжуулна. */
export class DocumentGoogleError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentGoogleError';
  }
}

/* ------------------------------------------------------------------ */
/*  R2 туслахууд                                                       */
/* ------------------------------------------------------------------ */

/** `/media/<key>` → `<key>`.  Импортын үед бичигдсэн хуучин мөрүүд заримдаа
 *  бүтэн URL агуулдаг тул зам хэсгийг нь салгаж авна. */
export function mediaKeyOf(fileUrl: string): string {
  const path = /^https?:/i.test(fileUrl) ? new URL(fileUrl).pathname : fileUrl;
  const i = path.indexOf('/media/');
  const key = i >= 0 ? path.slice(i + '/media/'.length) : path.replace(/^\/+/, '');
  return decodeURIComponent(key);
}

/** `routes/upload.ts`-ийн `mediaKey` -тэй ИЖИЛ хэлбэр.  Заавал ижил байх
 *  ёстой: тэндэх `ownsKey` нь түлхүүрийн `<userSub>-` угтварыг шалгаж
 *  нэрлэх/устгах эрхийг шийддэг. */
function newMediaKey(userSub: number | string, fileName: string): string {
  const rand = crypto.randomUUID().slice(0, 8);
  const safe = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `${userSub}-${Date.now()}-${rand}-${safe}`;
}

async function readMediaBytes(env: Env, fileUrl: string): Promise<ArrayBuffer> {
  const obj = await env.MEDIA_BUCKET.get(mediaKeyOf(fileUrl));
  if (!obj) throw new DocumentGoogleError(404, 'Файлын агуулга R2-оос олдсонгүй.');
  return obj.arrayBuffer();
}

/* ------------------------------------------------------------------ */
/*  Уншилтууд                                                          */
/* ------------------------------------------------------------------ */

export async function latestRevision(
  db: D1Database,
  documentId: number,
): Promise<RevisionRow | null> {
  return db
    .prepare(
      `SELECT id, document_id, revision_number, file_url, file_name, file_size
       FROM document_revisions
       WHERE document_id = ?
       ORDER BY revision_number DESC, id DESC
       LIMIT 1`,
    )
    .bind(documentId)
    .first<RevisionRow>();
}

/**
 * Энэ баримтын АМЬД холболт.
 *
 * `revision_id = latest` эсвэл `synced_revision_id = latest` хоёуланг нь
 * хардаг нь заавал: буцааж татах үед бид ШИНЭ revision үүсгэдэг тул хамгийн
 * сүүлийн хувилбар нь эх биш, татсан хувилбар болж хувирдаг.  Зөвхөн
 * `revision_id`-г шалгавал татсан болгоны дараа дахин хөрвүүлж, засаж байсан
 * хүмүүсийн Google файл алдагдана.
 */
export async function openMappingFor(
  db: D1Database,
  documentId: number,
  latestRevisionId: number,
  sourceUrl: string,
): Promise<GoogleFileRow | null> {
  /* ⚠️ `source_url`-ыг ЗААВАЛ тулгана.  Зөвхөн `revision_id`-гаар тааруулж
   * байсан үед ижил мөрийн ЦААНАХ ФАЙЛ солигдвол (архивын бөөн засвар,
   * гараар дахин байршуулах) хуучин Google хуулбар «хүчинтэй» хэвээр
   * үлдэж, хэрэглэгч хуучин агуулга хараад зогсохгүй cron sweep түүнийг
   * архив руу буцааж бичээд ШИНЭ засварыг дардаг байв (2026-09-07). */
  return db
    .prepare(
      `SELECT * FROM document_google_files
       WHERE document_id = ? AND status = 'open'
         AND (revision_id = ? OR synced_revision_id = ?)
         AND source_url = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .bind(documentId, latestRevisionId, latestRevisionId, sourceUrl)
    .first<GoogleFileRow>();
}

/* ------------------------------------------------------------------ */
/*  Хөрвүүлэх                                                          */
/* ------------------------------------------------------------------ */

/**
 * Google дээрх ажлын хуулбарыг байлгана — байхгүй бол үүсгэнэ.
 *
 * Шинэ холболт үүсгэхийн ӨМНӨ тухайн баримтын бусад амьд холболтыг хаана:
 * хэн нэгэн гараар шинэ хувилбар байршуулсан бол хуучин Google файл нь
 * хуучирсан агуулгыг барьж үлддэг, түүнийг нээлттэй орхивол хоёр хүн өөр
 * өөр агуулга засаад аль нэг нь чимээгүй алдагдана.
 */
export async function ensureGoogleFile(
  env: Env,
  db: D1Database,
  documentId: number,
  userSub: number,
): Promise<{ mapping: GoogleFileRow; spec: OfficeSpec; revision: RevisionRow }> {
  const revision = await latestRevision(db, documentId);
  if (!revision) throw new DocumentGoogleError(404, 'Энэ баримтад файл алга байна.');

  const spec = officeSpec(revision.file_name);
  if (!spec) {
    throw new DocumentGoogleError(
      400,
      'Энэ төрлийн файлыг Google дээр засах боломжгүй (зөвхөн Word, Excel, PowerPoint).',
    );
  }

  const existing = await openMappingFor(db, documentId, revision.id, revision.file_url);
  if (existing) return { mapping: existing, spec, revision };

  await closeMappings(env, db, documentId);

  const bytes = await readMediaBytes(env, revision.file_url);
  if (bytes.byteLength > DRIVE_UPLOAD_MAX_BYTES) {
    throw new DocumentGoogleError(
      413,
      `Файл хэт том байна (${Math.round(bytes.byteLength / (1024 * 1024))} MB). ` +
        `Google дээр засах дээд хэмжээ ${Math.round(DRIVE_UPLOAD_MAX_BYTES / (1024 * 1024))} MB.`,
    );
  }
  // ⚠️ `convertTo`-г ЗӨВХӨН хуучин формат дээр өгнө.  .docx/.xlsx/.pptx нь эх
  // хэлбэрээрээ суух ёстой — Google-ийн хөрвүүлэгч агуулгын жагсаалтын
  // tab-stop/цэгэн залгаасыг задалдаг тул хөрвүүлбэл бүтэц эвдэрнэ.
  const file = await driveUpload(env, {
    name: revision.file_name,
    bytes,
    sourceMime: spec.sourceMime,
    convertTo: spec.nativeEdit ? undefined : spec.googleMime,
  });

  // Хоёр хүн НЭГЭН ЗЭРЭГ нээх нь энэ багаж дээр байнга тохиолдоно: хоёулаа
  // холболт олдоогүй гэж үзээд хоёр Drive файл үүсгэнэ.  `idx_doc_google_open`
  // нь хоёр дахь INSERT-ыг унагадаг тул тэр алдааг барьж, яллагчийн
  // холболтыг буцаана — ялагдагчийн Drive хуулбарыг хогийн саванд хийнэ,
  // эс бөгөөс хэнд ч харагдахгүй өнчин файл үлдэнэ.
  const raced = await openMappingFor(db, documentId, revision.id, revision.file_url);
  if (raced) {
    await driveTrash(env, file.id).catch(() => {});
    return { mapping: raced, spec, revision };
  }

  let shareMode: string | null = null;
  try {
    shareMode = await driveShare(env, file.id);
  } catch (err) {
    // Хуваалцах нь бүтэлгүйтвэл файл нь үүссэн хэвээр — зөвхөн эзэмшигч
    // нь харна.  Бүхэлд нь унагахаас илүү энэ талбарыг хоосон үлдээж
    // админд асуудлыг харуулсан нь дээр.
    console.error('driveShare failed', err);
  }

  const editUrl = googleEditUrl(spec, file.id);
  let row: GoogleFileRow | null;
  try {
    row = await db
      .prepare(
        `INSERT INTO document_google_files
           (document_id, revision_id, kind, google_file_id, edit_url, share_mode,
            drive_modified_at, opened_by, source_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        documentId,
        revision.id,
        spec.kind,
        file.id,
        editUrl,
        shareMode,
        file.modifiedTime ?? null,
        userSub,
        revision.file_url,
      )
      .first<GoogleFileRow>();
  } catch (err) {
    // Дээрх шалгалтын дараа, INSERT-ийн өмнө нөгөө хүсэлт хожсон бол
    // unique индекс энд унагана.  Ялагчийн мөрийг уншиж, өөрийн хуулбараа
    // цэвэрлэнэ — хэрэглэгчид алдаа харуулах шалтгаангүй.
    const winner = await openMappingFor(db, documentId, revision.id, revision.file_url);
    if (!winner) throw err;
    await driveTrash(env, file.id).catch(() => {});
    return { mapping: winner, spec, revision };
  }

  if (!row) throw new DocumentGoogleError(503, 'Холболтыг хадгалж чадсангүй.');
  return { mapping: row, spec, revision };
}

/** Амьд холболтуудыг хааж, Drive дээрх хуулбарыг нь хогийн саванд хийнэ. */
export async function closeMappings(env: Env, db: D1Database, documentId: number): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT * FROM document_google_files WHERE document_id = ? AND status = 'open'`,
    )
    .bind(documentId)
    .all<GoogleFileRow>();

  for (const row of results) {
    try {
      await driveTrash(env, row.google_file_id);
    } catch (err) {
      console.error('driveTrash failed', err);
    }
    if (row.preview_key) await env.MEETING_BUCKET.delete(row.preview_key).catch(() => {});
    await db
      .prepare(`UPDATE document_google_files SET status = 'closed', preview_key = NULL WHERE id = ?`)
      .bind(row.id)
      .run();
  }
}

/* ------------------------------------------------------------------ */
/*  Урьдчилан харах PDF                                                */
/* ------------------------------------------------------------------ */

/**
 * Урьдчилан харах PDF-ийн байтыг буцаана — кэшлэсэн бол R2-оос, эс бөгөөс
 * Google-ээс экспортлоод кэшилнэ.
 *
 * PDF нь ХУВИЙН `MEETING_BUCKET`-д очно.  `MEDIA_BUCKET` нь `/media/<key>`
 * гэсэн нэвтрэлтгүй нийтийн зам (CLAUDE.md аюулгүй байдлын #2) тул тэнд
 * тавибал компанийн бүх баримтын PDF нээлттэй болно.
 */
/**
 * Google дээрх файлаас PDF гаргана.
 *
 * Хоёр зам, учир нь Drive нь ЗӨВХӨН ӨӨРИЙН форматаас экспортолдог:
 *
 *  • Эх хэлбэрээрээ сууж байгаа .docx/.xlsx (Office editing mode) — эхлээд
 *    Google Doc болгож ТҮР хуулбар үүсгээд, түүнээс PDF гаргаж, хуулбарыг
 *    устгана.  Эх файл ХӨНДӨГДӨХГҮЙ тул засварын үнэн эх нь алдагдалгүй
 *    OOXML хэвээрээ үлдэнэ — зөвхөн ХАРАХ зураглал нь ойролцоо болно.
 *  • Хөрвүүлж хадгалсан хуучин формат — шууд экспортолно.
 *
 * `finally` дэх устгал ЗААВАЛ: экспорт нь 10 MB-ийн хязгаараар унах нь
 * ЭНГИЙН тохиолдол (тайлан бүр өндөр нягтралтай рендер зурагтай), тэр бүрд
 * эзэмшигчийн Drive-д өнчин хуулбар үлдвэл хэдэн зуун хог хуримтлагдана.
 */
async function renderPreviewPdf(env: Env, mapping: GoogleFileRow): Promise<ArrayBuffer> {
  const spec = specForKind(mapping.kind);
  const meta = await driveGetMeta(env, mapping.google_file_id);
  const isGoogleNative = meta?.mimeType?.startsWith('application/vnd.google-apps') ?? false;

  if (isGoogleNative) {
    try {
      return await driveExport(env, mapping.google_file_id, 'application/pdf');
    } catch (err) {
      throw asFriendlyDriveError(err);
    }
  }

  if (!spec) throw new DocumentGoogleError(400, `Танихгүй төрөл: ${mapping.kind}`);
  let copyId: string | null = null;
  try {
    const copy = await driveCopyAs(
      env,
      mapping.google_file_id,
      spec.googleMime,
      `preview-${mapping.id}`,
    );
    copyId = copy.id;
    return await driveExport(env, copy.id, 'application/pdf');
  } catch (err) {
    throw asFriendlyDriveError(err);
  } finally {
    if (copyId) await driveDeleteForever(env, copyId).catch(() => {});
  }
}

export async function previewPdf(
  env: Env,
  db: D1Database,
  mapping: GoogleFileRow,
): Promise<ArrayBuffer> {
  if (mapping.preview_key) {
    // ⚠️ Кэшийг Drive-ын `modifiedTime`-аар ЗААВАЛ шалгана.  Ажилтан Google
    // дээр заслаад буцаж ирэхэд архив руу татах нь 5 минутын дараа болдог
    // тул зөвхөн кэшид найдвал ХУУЧИН агуулгыг өөрийнх нь засварын дараа
    // харуулна — энэ нь хамгийн эргэлзээ төрүүлэх алдаа болно.  Нэмэлт
    // зардал нь нэг хямд `files.get`.
    const meta = await driveGetMeta(env, mapping.google_file_id);
    const stale =
      meta?.modifiedTime != null &&
      mapping.drive_modified_at != null &&
      meta.modifiedTime > mapping.drive_modified_at;
    if (!stale) {
      const cached = await env.MEETING_BUCKET.get(mapping.preview_key);
      if (cached) return cached.arrayBuffer();
    }
  }

  const bytes = await renderPreviewPdf(env, mapping);

  // ⚠️ `drive_modified_at`-ыг ЭНД ЗОРИУДААР ШИНЭЧЛЭХГҮЙ.  Тэр талбар нь
  // «архив руу хамгийн сүүлд ТАТСАН байдал» гэсэн утгатай бөгөөд cron sweep
  // өөрчлөлт болсныг түүгээр л мэддэг.  Урьдчилан харахдаа хөдөлгөвөл sweep
  // «юу ч өөрчлөгдөөгүй» гэж үзээд ажилтны засварыг архивт ХЭЗЭЭ Ч
  // буулгахгүй.  Үүний үнэ нь: татагдах хүртэл харах бүрд дахин рендерлэнэ.
  const key = `docpreview/${mapping.document_id}/${mapping.id}-${crypto.randomUUID().slice(0, 8)}.pdf`;
  await env.MEETING_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: 'application/pdf' },
  });
  if (mapping.preview_key) await env.MEETING_BUCKET.delete(mapping.preview_key).catch(() => {});
  await db
    .prepare(`UPDATE document_google_files SET preview_key = ? WHERE id = ?`)
    .bind(key, mapping.id)
    .run();
  return bytes;
}

/* ------------------------------------------------------------------ */
/*  Буцааж татах                                                       */
/* ------------------------------------------------------------------ */

/**
 * Google дээрх засварыг архив руу буулгана.
 *
 * НЭГ ЗАСВАРЫН СЕСС = НЭГ ХУВИЛБАР.  Эхний татах нь шинэ `document_revisions`
 * мөр үүсгэнэ; дараагийнх нь ТЭР МӨРИЙГ шинэчилнэ (шинэ R2 объект бичээд
 * хуучныг устгана).  Эс бөгөөс 2 минут тутмын sweep нь урт засварын турш
 * хэдэн арван хувилбар үүсгэж түүхийг ашиглах аргагүй болгоно.
 *
 * Шинэ түлхүүр бичдэг шалтгаан: ижил түлхүүрийг дарж бичвэл хөтөч болон
 * ирмэгийн кэш хуучин агуулгыг үзүүлсэн хэвээр үлддэг.
 */
export async function syncFromGoogle(
  env: Env,
  db: D1Database,
  mapping: GoogleFileRow,
): Promise<{ revisionId: number; skipped: boolean }> {
  const spec = specForKind(mapping.kind);
  if (!spec) throw new DocumentGoogleError(400, `Танихгүй төрөл: ${mapping.kind}`);

  const meta = await driveGetMeta(env, mapping.google_file_id);
  if (!meta || meta.trashed) {
    await db
      .prepare(`UPDATE document_google_files SET status = 'closed' WHERE id = ?`)
      .bind(mapping.id)
      .run();
    throw new DocumentGoogleError(404, 'Google дээрх файл устсан байна.');
  }

  const source = await db
    .prepare(
      `SELECT id, document_id, revision_number, file_url, file_name, file_size
       FROM document_revisions WHERE id = ?`,
    )
    .bind(mapping.revision_id)
    .first<RevisionRow>();
  if (!source) throw new DocumentGoogleError(404, 'Эх хувилбар олдсонгүй.');

  /* Эх файлын өргөтгөлөөс нь тухайн баримт ЭХ ХЭЛБЭРЭЭРЭЭ (Office editing
   * mode) Drive дээр сууж байгаа эсэхийг мэднэ.  Холболтын `kind` нь энэ
   * ялгааг барьдаггүй (doc/sheet/slide гурав л) тул ЭХ мөрөөс шийднэ. */
  const srcSpec = officeSpec(source.file_name);
  const native = srcSpec?.nativeEdit ?? false;

  let bytes: ArrayBuffer;
  let fileName: string;
  let contentType: string;
  try {
    if (native && srcSpec) {
      // `alt=media` — 10 MB-ийн экспортын хязгаар ҮЙЛЧЛЭХГҮЙ, мөн байт нь
      // Word-ийн үүсгэсэн OOXML хэвээрээ буцна (хөрвүүлэлтийн алдагдалгүй).
      bytes = await driveDownload(env, mapping.google_file_id);
      fileName = source.file_name;
      contentType = srcSpec.sourceMime;
    } else {
      bytes = await driveExport(env, mapping.google_file_id, spec.exportMime);
      fileName = exportedFileName(source.file_name, spec);
      contentType = spec.exportMime;
    }
  } catch (err) {
    throw asFriendlyDriveError(err);
  }
  const owner = mapping.opened_by ?? 0;
  const key = newMediaKey(owner, fileName);
  await env.MEDIA_BUCKET.put(key, bytes, {
    httpMetadata: { contentType },
  });
  const fileUrl = `/media/${key}`;

  let revisionId: number;
  if (mapping.synced_revision_id) {
    const prev = await db
      .prepare(`SELECT file_url FROM document_revisions WHERE id = ?`)
      .bind(mapping.synced_revision_id)
      .first<{ file_url: string }>();
    await db
      .prepare(
        `UPDATE document_revisions
         SET file_url = ?, file_name = ?, file_type = ?, file_size = ?, uploaded_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(fileUrl, fileName, contentType, bytes.byteLength, mapping.synced_revision_id)
      .run();
    if (prev?.file_url) await env.MEDIA_BUCKET.delete(mediaKeyOf(prev.file_url)).catch(() => {});
    revisionId = mapping.synced_revision_id;
  } else {
    const max = await db
      .prepare(`SELECT MAX(revision_number) AS max_rev FROM document_revisions WHERE document_id = ?`)
      .bind(mapping.document_id)
      .first<{ max_rev: number | null }>();
    const next = (max?.max_rev ?? -1) + 1;
    const created = await db
      .prepare(
        `INSERT INTO document_revisions
           (document_id, revision_number, file_url, file_name, file_type, file_size, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .bind(
        mapping.document_id,
        next,
        fileUrl,
        fileName,
        contentType,
        bytes.byteLength,
        owner || null,
      )
      .first<{ id: number }>();
    if (!created) throw new DocumentGoogleError(503, 'Хувилбар үүсгэж чадсангүй.');
    revisionId = created.id;
  }

  // Агуулга өөрчлөгдсөн тул кэшлэсэн PDF хүчингүй.
  if (mapping.preview_key) await env.MEETING_BUCKET.delete(mapping.preview_key).catch(() => {});
  await db
    .prepare(
      `UPDATE document_google_files
       SET synced_revision_id = ?, drive_modified_at = ?, last_synced_at = CURRENT_TIMESTAMP,
           preview_key = NULL, source_url = ?
       WHERE id = ?`,
    )
    .bind(revisionId, meta.modifiedTime ?? null, fileUrl, mapping.id)
    .run();

  return { revisionId, skipped: false };
}

function asFriendlyDriveError(err: unknown): Error {
  // Хамгийн магадлалтай бүтэлгүйтэл — хадгалсан токен нь Drive-ын scope-гүй.
  // Ганц засвар нь дахин зөвшөөрөх тул алдаа нь ЯГ тэр алхмыг хэлнэ.
  if (isScopeError(err)) {
    return new DocumentGoogleError(
      503,
      'Google-ийн зөвшөөрөл дутуу байна (Drive-ын эрх олгогдоогүй). ' +
        'Админ → Мэйл хайрцаг хуудаснаас тухайн Google хаягийг «Gmail холбох»-оор ' +
        'дахин холбож, Drive-ын зөвшөөрлийг өгнө үү. Нэг удаа хийхэд хангалттай.',
    );
  }
  /* ⚠️ Энэ хязгаар нь ЗӨВХӨН урьдчилан харагдацад үлдсэн, БАРИМТАД БИШ.
   *
   * Drive-ын 10 MB нь Google-ийн ӨӨРИЙН форматаас гаргаж авах экспортод
   * үйлчилдэг.  2026-09-07-ны засвараар .docx/.xlsx нь эх хэлбэрээрээ
   * суудаг болсон тул ЗАСААД ХАДГАЛАХ зам нь `alt=media`-аар явж, хэмжээний
   * хязгааргүй болсон — эзний «10MB-аас том файл» гомдол тэнд шийдэгдсэн.
   * Үлдсэн нь PDF харагдац: түүнийг гаргахын тулд түр Google хуулбар үүсгэх
   * шаардлагатай бөгөөд тэр экспорт нь дээрх таазанд захирагдана.  Өндөр
   * нягтралтай рендер бүхий тайлан амархан давдаг тул мессеж нь бууж өгөх
   * биш, ЗӨВ гарц руу (Google дээр нээх) чиглүүлнэ. */
  if (err instanceof DriveApiError && err.reason === 'exportSizeLimitExceeded') {
    return new DocumentGoogleError(
      413,
      'Энэ баримт хэт том тул хуудсан дотор урьдчилан харах боломжгүй ' +
        '(Google-ийн PDF гаргах хязгаар 10 MB). «Google дээр засах» товчоор нээж ' +
        'үзнэ үү — засаж хадгалахад ямар ч хэмжээний хязгаар байхгүй.',
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

/* ------------------------------------------------------------------ */
/*  Cron sweep                                                         */
/* ------------------------------------------------------------------ */

/**
 * Google дээрх засварыг архив руу АВТОМАТААР буулгана.
 *
 * ⚠️ ШИНЭ cron илэрхийлэл НЭМЭЭГҮЙ — `index.ts` дээрх «* * * * * биш бол
 * бүгдийг ажиллуул» гэсэн fail-safe салаанд нэмэгдэв (гурав дахь илэрхийлэл
 * нэмбэл тэр дөрвөл чимээгүй хоёр дахин ажиллана).
 *
 * Хоёр нөхцөл ЗААВАЛ хамт: Drive дээр бидний сүүлд харснаас хойш өөрчлөгдсөн
 * БАЙХ, ба сүүлийн өөрчлөлт нь `QUIET_MS`-ээс ХУУЧИН байх.  Хоёр дахь нь
 * бичиж байх зуур нь татаж хагас дутуу өгүүлбэр архивлахаас сэргийлдэг.
 */
export async function sweepGoogleDocSync(env: Env): Promise<void> {
  if (!(await driveEnabled(env))) return;

  const { results } = await env.DB.prepare(
    `SELECT g.* FROM document_google_files g
     JOIN documents d ON d.id = g.document_id AND d.deleted_at IS NULL
     WHERE g.status = 'open'
     ORDER BY g.last_synced_at IS NOT NULL, g.last_synced_at ASC
     LIMIT ?`,
  )
    .bind(SWEEP_BATCH)
    .all<GoogleFileRow>();

  const cutoff = Date.now() - QUIET_MS;
  for (const row of results) {
    try {
      const meta = await driveGetMeta(env, row.google_file_id);
      if (!meta || meta.trashed) {
        await env.DB.prepare(`UPDATE document_google_files SET status = 'closed' WHERE id = ?`)
          .bind(row.id)
          .run();
        continue;
      }
      if (!meta.modifiedTime) continue;
      if (row.drive_modified_at && meta.modifiedTime <= row.drive_modified_at) continue;
      if (Date.parse(meta.modifiedTime) > cutoff) continue;
      await syncFromGoogle(env, env.DB, row);
    } catch (err) {
      console.error('sweepGoogleDocSync failed', row.id, err);
    }
  }
}
