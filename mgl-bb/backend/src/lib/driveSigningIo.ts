/**
 * `routes/driveSigning.ts`-ийн БОДИТ Google Drive IO.  Тусдаа файл байгаа
 * шалтгаан: `driveBrowse.ts` → `googleAuth.ts`-ийг `node --test` ачаалж
 * чаддаггүй (параметрийн шинж) — route-ын тест хуурамч IO өгнө.
 *
 * Бүх зам «Баримт бичиг»-ийн одоо ажиллаж буй механизмыг ДАХИН ашиглана:
 *   • ancestry (`resolveAncestry`) — файл тэр төслийн хавтасны дотор;
 *   • бичих = ИЖИЛ файлын шинэ хувилбар (`driveResumableStart(existingFileId)`
 *     + хавтасны эзний нэрээр `driveWriteIdentity` — прод дээр 2026-09-18-аас
 *     ажиллаж буй «солих» байршуулалттай ижил);
 *   • ledger + R2 хуулбар (`recordUpload`, `uploaded_by_user_id`).
 */
import type { Context } from 'hono';
import type { Env, AppVariables } from '../types';
import {
  DriveBrowseError,
  FOLDER_MIME,
  driveBrowseDownload,
  driveBrowseGetSync,
  driveResumablePut,
  driveResumableStart,
  driveWriteIdentity,
} from './google/driveBrowse';
import { invalidateDriveListing, rememberDriveEntry, resolveAncestry } from './projectDriveAccess';
import { recordUpload } from './projectDriveSync';
import { DOCX_MIME } from './projectDriveUpload';
import { SIGN_MAX_BYTES } from './docxSignFile';
import type { DriveSignIo } from '../routes/driveSigning';

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

export function makeDriveSignIo(errorResponse: (c: AppContext, err: unknown, where: string) => Response): DriveSignIo {
  return {
    async resolveFile(env, rootId, fileId) {
      if (fileId === rootId) {
        return { ok: false, status: 404, code: 'IS_ROOT', error: 'Энэ нь төслийн хавтас байна' };
      }
      const anc = await resolveAncestry(env, rootId, fileId);
      if (!anc.ok) {
        return anc.reason === 'TRASHED'
          ? { ok: false, status: 404, code: 'NOT_FOUND', error: 'Файл Drive дээр олдсонгүй' }
          : { ok: false, status: 403, code: 'OUTSIDE_PROJECT', error: 'Энэ файл төслийн хавтасны дотор биш' };
      }
      if (anc.target.mimeType === FOLDER_MIME) {
        return { ok: false, status: 404, code: 'IS_FOLDER', error: 'Энэ id нь хавтас байна' };
      }
      // md5/version/modifiedTime хэрэгтэй — sync-ийн талбаруудтай уншина.
      const entry = await driveBrowseGetSync(env, fileId);
      const parentId = anc.path.length >= 2 ? (anc.path[anc.path.length - 2]?.id ?? null) : null;
      return { ok: true, entry, parentId };
    },

    async download(env, fileId) {
      const res = await driveBrowseDownload(env, fileId);
      const len = Number(res.headers.get('content-length') ?? '0');
      if (len > SIGN_MAX_BYTES) {
        await res.body?.cancel().catch(() => {});
        throw new DriveBrowseError('EXPORT_TOO_LARGE', 413, 'tooLarge', `docx too large to sign: ${len}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    },

    async upload(env, rootId, entry, parentId, bytes) {
      const ident = await driveWriteIdentity(env, rootId);
      const session = await driveResumableStart(env, {
        name: entry.name,
        parentId,
        mime: DOCX_MIME,
        size: bytes.length,
        existingFileId: entry.id,
        subject: ident.subject,
      });
      const r = await driveResumablePut(session, { stream: new Blob([bytes]).stream(), length: bytes.length }, 0, bytes.length);
      if (!r.done) throw new DriveBrowseError('UNAVAILABLE', 0, 'resumable', 'signed docx upload incomplete');
      rememberDriveEntry(r.entry);
      invalidateDriveListing(parentId);
      return r.entry;
    },

    async record(env, rootId, entry, userId) {
      await recordUpload(env, rootId, entry, { userId, replaced: true });
    },

    errorResponse,
  };
}
