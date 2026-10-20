/**
 * Төслийн Drive файлын хувилбарын түүх — ЦЭВЭР (сүлжээгүй, D1-гүй) хэсэг
 * (миграц 0300, 2026-09-15).
 *
 *   • өмнөх бүртгэгдсэн төлөв ↔ Drive-ын одоогийн мета → өөрчлөлтийн төрөл;
 *   • файлын төрлөөр «хуулбарыг ЯАЖ авах вэ» (эх байт / Office экспорт / огт үгүй);
 *   • R2 түлхүүр, API-д буцаах хэлбэр.
 *
 * Drive рүү дуудлага хийж, R2/D1-д бичдэг хэсэг нь `projectDriveSync.ts`-д —
 * тэр нь `googleAuth.ts`-ийг татдаг тул `node --test`-д ачаалагддаггүй; энэ
 * файл нь `projectDriveVersions.test.ts`-д шууд импортлогддог.
 */
import { FOLDER_MIME, GOOGLE_APPS_PREFIX, SHORTCUT_MIME } from './google/driveBrowseCore';

/* ------------------------------------------------------------------ */
/*  Төрлүүд                                                            */
/* ------------------------------------------------------------------ */

export type DriveChangeKind =
  | 'created'
  | 'modified'
  | 'renamed'
  | 'moved'
  | 'trashed'
  | 'untrashed'
  | 'deleted'
  | 'restored';

/** `project_drive_versions`-ийн нэг мөр (D1-ээс уншсан хэлбэр). */
export interface DriveVersionRow {
  id: number;
  root_folder_id: string;
  file_id: string;
  file_name: string;
  mime_type: string;
  parent_id: string | null;
  size: number | null;
  md5: string | null;
  drive_version: string | null;
  drive_modified_at: string | null;
  modified_by_name: string | null;
  modified_by_email: string | null;
  change_kind: DriveChangeKind;
  r2_key: string | null;
  snapshot_mime: string | null;
  restored_from_version_id: number | null;
  restored_by_user_id: number | null;
  /** ERP-ээс байршуулсан хүн (миграц 0325) — `created`/`modified` мөрөнд л;
   *  Drive-ын `lastModifyingUser` нь SA болох тул энэ л «хэн»-ийг мэднэ. */
  uploaded_by_user_id: number | null;
  created_at: string;
}

/** Drive-аас уншсан файлын мета — sync-д хэрэгтэй талбарууд л. */
export interface DriveSyncMeta {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  trashed?: boolean;
  modifiedTime?: string;
  size?: string;
  md5Checksum?: string;
  version?: string;
  lastModifyingUser?: { displayName?: string; emailAddress?: string };
}

/* ------------------------------------------------------------------ */
/*  Хуулбарын төлөвлөгөө                                               */
/* ------------------------------------------------------------------ */

export interface SnapshotPlan {
  /** download = `alt=media` эх байт; export = Google формат → Office/PNG;
   *  none = хуулбарлах боломжгүй (хавтас, товчлол, Forms/Sites …). */
  kind: 'download' | 'export' | 'none';
  /** R2-д хадгалагдах байтын MIME. */
  mime: string | null;
  /** Татахад нэрэнд залгах өргөтгөл (`export`-д л; download нь эх нэрээ хадгална). */
  ext: string | null;
  /** Энэ хуулбарыг Drive руу буцааж ачаалж болох уу.  PNG болсон Drawing —
   *  үгүй (Google нь PNG-г Drawing болгож хөрвүүлдэггүй). */
  restorable: boolean;
}

/** Google формат → Drive руу БУЦААЖ ачаалахад хөрвөх Office формат.
 *  Drive нь Google Doc-ыг docx-оор `files.update` хийхэд агуулгыг импортолж
 *  дахин Doc болгодог; PDF-ээр бол чадахгүй — тиймээс PDF биш Office. */
const GOOGLE_EXPORTS: Record<string, { mime: string; ext: string; restorable: boolean }> = {
  'application/vnd.google-apps.document': {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: '.docx',
    restorable: true,
  },
  'application/vnd.google-apps.spreadsheet': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: '.xlsx',
    restorable: true,
  },
  'application/vnd.google-apps.presentation': {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: '.pptx',
    restorable: true,
  },
  'application/vnd.google-apps.drawing': { mime: 'image/png', ext: '.png', restorable: false },
};

export function snapshotPlan(mimeType: string): SnapshotPlan {
  if (mimeType === FOLDER_MIME || mimeType === SHORTCUT_MIME) {
    return { kind: 'none', mime: null, ext: null, restorable: false };
  }
  if (mimeType.startsWith(GOOGLE_APPS_PREFIX)) {
    const exp = GOOGLE_EXPORTS[mimeType];
    return exp
      ? { kind: 'export', mime: exp.mime, ext: exp.ext, restorable: exp.restorable }
      : { kind: 'none', mime: null, ext: null, restorable: false };
  }
  return { kind: 'download', mime: mimeType || 'application/octet-stream', ext: null, restorable: true };
}

/** Хувилбарыг татахад өгөх файлын нэр — экспортлогдсон Google баримт
 *  өргөтгөлөө авна («Тайлан» → «Тайлан.docx»). */
export function snapshotFileName(row: Pick<DriveVersionRow, 'file_name' | 'mime_type'>): string {
  const plan = snapshotPlan(row.mime_type);
  if (plan.kind === 'export' && plan.ext && !row.file_name.toLowerCase().endsWith(plan.ext)) {
    return `${row.file_name}${plan.ext}`;
  }
  return row.file_name;
}

/* ------------------------------------------------------------------ */
/*  Өөрчлөлтийн ангилал                                                */
/* ------------------------------------------------------------------ */

export interface ChangeClassification {
  kind: Exclude<DriveChangeKind, 'deleted' | 'restored'>;
  /** Байт хуулбар шинээр авах шаардлагатай юу. */
  contentChanged: boolean;
}

/**
 * Өмнөх бүртгэлтэй харьцуулж «юу болов» гэдгийг шийднэ.  `null` = ЮУ Ч
 * өөрчлөгдөөгүй (Drive-ын Changes нь зөвхөн мета — жишээ нь харсан огноо —
 * өөрчлөгдөхөд ч мэдэгдэл явуулдаг; түүнд мөр үүсгэхгүй).
 *
 * Агуулгын шинжүүр: энгийн файлд `md5Checksum` (Drive нь агуулга бүрд тооцдог);
 * Google форматад md5 байхгүй тул `modifiedTime` (бичих бүрт өөрчлөгддөг).
 * Нэг файлд хэд хэдэн зүйл зэрэг өөрчлөгдвөл давуу эрэмбэ:
 * агуулга > нэр > байрлал — байт хуулбар авах эсэх нь хамгийн чухал шийдвэр.
 */
export function classifyChange(prev: DriveVersionRow | null, next: DriveSyncMeta): ChangeClassification | null {
  const trashed = Boolean(next.trashed);
  if (!prev) {
    // Анх илэрсэн — хогийн саванд байгааг бүртгэхгүй (устгасан файлын түүх биш).
    return trashed ? null : { kind: 'created', contentChanged: true };
  }
  const wasTrashed = prev.change_kind === 'trashed';
  if (trashed) return wasTrashed ? null : { kind: 'trashed', contentChanged: false };
  if (wasTrashed) return { kind: 'untrashed', contentChanged: false };
  if (prev.change_kind === 'deleted') {
    // Устсан гэж бүртгэсэн атлаа дахин харагдаж байна (хуваалцалт сэргэсэн) —
    // шинэ амьдрал: агуулгыг дахин хуулбарлана.
    return { kind: 'created', contentChanged: true };
  }

  const contentChanged = next.md5Checksum
    ? next.md5Checksum !== prev.md5
    : Boolean(next.modifiedTime && next.modifiedTime !== prev.drive_modified_at);
  if (contentChanged) return { kind: 'modified', contentChanged: true };
  if (next.name !== prev.file_name) return { kind: 'renamed', contentChanged: false };
  const parent = next.parents?.[0] ?? null;
  if (parent && prev.parent_id && parent !== prev.parent_id) return { kind: 'moved', contentChanged: false };
  return null;
}

/** Google баримт хэвлэж байх зуур хуулбарлахгүй: сүүлийн засвараас хойш
 *  `quietMs` өнгөрсөн байх ёстой.  modifiedTime байхгүй → тогтсон гэж үзнэ. */
export function isSettled(modifiedTime: string | undefined, nowMs: number, quietMs: number): boolean {
  if (!modifiedTime) return true;
  const t = Date.parse(modifiedTime);
  if (Number.isNaN(t)) return true;
  return nowMs - t >= quietMs;
}

/* ------------------------------------------------------------------ */
/*  R2 түлхүүр                                                         */
/* ------------------------------------------------------------------ */

/** `drive-versions/<root>/<file>/<цаг>-<санамсаргүй>` — хавтас, файлаар
 *  бүлэглэгддэг тул R2 инвентор (storageAudit) дээр уншигдахуйц; өргөтгөл
 *  нь R2-д хэрэггүй (MIME нь мөрөнд). */
export function versionR2Key(rootId: string, fileId: string, nowMs = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `drive-versions/${rootId}/${fileId}/${nowMs}-${rand}`;
}

/* ------------------------------------------------------------------ */
/*  API-д буцаах хэлбэр                                                */
/* ------------------------------------------------------------------ */

export interface DriveVersionView {
  id: number;
  file_id: string;
  file_name: string;
  mime_type: string;
  parent_id: string | null;
  size: number | null;
  change_kind: DriveChangeKind;
  /** Drive-ын хэлсэн засварлагч — баг/хуваалцсан акаунт, эсвэл холбоосоор
   *  орсон нэргүй хүн (null). */
  modified_by: { name: string | null; email: string | null } | null;
  drive_modified_at: string | null;
  /** ERP-ийн хүн — зөвхөн `restored` мөрөнд. */
  restored_by: { id: number; name: string } | null;
  restored_from_version_id: number | null;
  /** ERP-ээс байршуулсан хүн (миграц 0325) — `created`/`modified` мөрөнд. */
  uploaded_by: { id: number; name: string } | null;
  /** Байт хуулбар байгаа (татаж болно). */
  has_snapshot: boolean;
  /** Энэ хувилбар руу Drive-ыг буцааж болно. */
  restorable: boolean;
  created_at: string;
}

export function versionView(
  row: DriveVersionRow & { restored_by_name?: string | null; uploaded_by_name?: string | null },
): DriveVersionView {
  const plan = snapshotPlan(row.mime_type);
  const hasSnapshot = row.r2_key !== null;
  return {
    id: row.id,
    file_id: row.file_id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    parent_id: row.parent_id,
    size: row.size,
    change_kind: row.change_kind,
    modified_by:
      row.modified_by_name || row.modified_by_email
        ? { name: row.modified_by_name, email: row.modified_by_email }
        : null,
    drive_modified_at: row.drive_modified_at,
    restored_by:
      row.restored_by_user_id != null
        ? { id: row.restored_by_user_id, name: row.restored_by_name ?? '' }
        : null,
    restored_from_version_id: row.restored_from_version_id,
    uploaded_by:
      row.uploaded_by_user_id != null
        ? { id: row.uploaded_by_user_id, name: row.uploaded_by_name ?? '' }
        : null,
    has_snapshot: hasSnapshot,
    restorable: hasSnapshot && plan.restorable,
    created_at: row.created_at,
  };
}
