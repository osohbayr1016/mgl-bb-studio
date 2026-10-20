/**
 * Word / Excel / PowerPoint файлыг ХАРАХ + Google дээр ЗАСАХ маршрутууд.
 *
 * Эзний шийдвэр (2026-09-07):
 *   • Баримтын хуудсан ДОТОР — зөвхөн ХАРНА (засварлахгүй).
 *   • Засах бол ШИНЭ ТАБ нээж Google дээр, бусад ажилтантай зэрэг realtime.
 *
 * Иймд `preview` нь PDF байт буцаадаг (front-end нь `blob:` iframe-д тавина),
 * `open` нь Google-ийн засварлагчийн хаяг буцаадаг.  Хоёул ИЖИЛ Drive
 * хуулбар дээр тогтдог — хоёр удаа хөрвүүлэхгүй.
 *
 * ⚠️ Маршрутын дараалал: эдгээрийг `documents.ts` дээрх `/:id` -ЭЭС ӨМНӨ
 * mount хийнэ.  Hono нь сегментийн тоогоор ялгадаг тул мөргөлдөхгүй ч,
 * ирээдүйд `/:id/*` төрлийн маршрут нэмэгдвэл дараалал ач холбогдолтой.
 */
import type { Hono } from 'hono';
import type { AppVariables, Env } from '../types';
import {
  DocumentGoogleError,
  closeMappings,
  ensureGoogleFile,
  latestRevision,
  openMappingFor,
  previewPdf,
  syncFromGoogle,
} from '../lib/documentGoogle';
import {
  DRIVE_EXPORT_MAX_BYTES,
  DriveApiError,
  DriveNotConfigured,
  driveEnabled,
  isScopeError,
} from '../lib/google/driveClient';
import { officeSpec } from '../lib/officeDocs';

type DocumentsApp = Hono<{ Bindings: Env; Variables: AppVariables }>;

/** Урсгалын бүх алдааг нэг цэгээс HTTP статус болгоно.  `index.ts`-д
 *  `app.onError` байхгүй тул баригдаагүй алдаа нь хоосон 500 болж хувирдаг —
 *  хэрэглэгч юу буруу болсныг мэдэхгүй үлдэнэ. */
function errorResponse(err: unknown): { status: 400 | 404 | 409 | 413 | 500 | 503; error: string } {
  if (err instanceof DocumentGoogleError) return { status: err.status, error: err.message };
  if (err instanceof DriveNotConfigured) return { status: 503, error: err.message };

  /* ⚠️ Drive-ын алдааг ЭНД барих ёстой.  Эхний хувилбарт `asFriendlyDriveError`
   * нь зөвхөн `driveExport`-ыг ороосон байсан тул ХАМГИЙН ЭХНИЙ Drive дуудлага
   * — файл байршуулах — уначихвал түүхий `DriveApiError` дамжиж, хэрэглэгч
   * шалтгаангүй 500 хардаг байв.  Google-ийн `reason` нь `insufficientPermissions`
   * маягийн богино тэмдэг тул мессежид оруулах нь оношлоход шийдвэрлэх ач
   * холбогдолтой бөгөөд ямар ч нууц агуулгагүй. */
  if (err instanceof DriveApiError) {
    if (isScopeError(err)) {
      return {
        status: 503,
        error:
          'Google-ийн зөвшөөрөл дутуу байна (Drive-ын эрх олгогдоогүй). Админ → И-мэйл ' +
          'хайрцгууд хуудасны «Google хаяг холбох» картаар дахин холбож, Drive-ын ' +
          'зөвшөөрлийг өгнө үү.',
      };
    }
    if (err.reason === 'storageQuotaExceeded') {
      return {
        status: 503,
        error: 'Холбогдсон Google хаягийн Drive-ын багтаамж дүүрсэн байна.',
      };
    }
    console.error('drive call failed', err.status, err.reason, err.message);
    return {
      status: 503,
      error: `Google Drive алдаа (${err.status}${err.reason ? ` ${err.reason}` : ''}). ${err.message.slice(0, 200)}`,
    };
  }

  console.error('document office route failed', err);
  return {
    status: 500,
    error: `Google-тэй холбогдоход алдаа гарлаа: ${err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)}`,
  };
}

function docId(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new DocumentGoogleError(400, 'Буруу баримтын дугаар.');
  return n;
}

export function mountDocumentOffice(app: DocumentsApp) {
  /**
   * Мөр дээр ямар товч гаргахыг UI шийдэхэд хэрэгтэй бүх зүйл.
   * Хөрвүүлэлт ХИЙХГҮЙ — зөвхөн D1 уншина, тул хямд бөгөөд файл нээх бүрд
   * дуудаж болно.
   */
  app.get('/:id/office', async (c) => {
    try {
      const id = docId(c.req.param('id'));
      const revision = await latestRevision(c.env.DB, id);
      if (!revision) return c.json({ error: 'Баримт олдсонгүй.' }, 404);
      const spec = officeSpec(revision.file_name);
      const mapping = await openMappingFor(c.env.DB, id, revision.id, revision.file_url);
      return c.json({
        office: spec ? spec.kind : null,
        file_name: revision.file_name,
        revision_id: revision.id,
        drive_enabled: await driveEnabled(c.env),
        edit_url: mapping?.edit_url ?? null,
        last_synced_at: mapping?.last_synced_at ?? null,
      });
    } catch (err) {
      const { status, error } = errorResponse(err);
      return c.json({ error }, status);
    }
  });

  /** Google дээр засах — хаягийг буцаана, front-end нь ШИНЭ ТАБ-д нээнэ. */
  app.post('/:id/office/open', async (c) => {
    try {
      const id = docId(c.req.param('id'));
      const user = c.get('user');
      const { mapping } = await ensureGoogleFile(c.env, c.env.DB, id, Number(user.sub));
      return c.json({ edit_url: mapping.edit_url, share_mode: mapping.share_mode });
    } catch (err) {
      const { status, error } = errorResponse(err);
      return c.json({ error }, status);
    }
  });

  /**
   * Урьдчилан харах PDF-ийн БАЙТ.  Front-end нь authed fetch → `blob:` →
   * iframe гэж үзүүлнэ (HTTP хаягаар өгвөл манай cross-origin isolated
   * origin дээр Chrome-ийн PDF үзүүлэгч ажиллахгүй).
   *
   * Анх удаа дуудахад хөрвүүлэлт явагдана (хэдэн секунд), дараа нь R2-оос
   * шууд ирнэ.
   */
  app.get('/:id/office/preview', async (c) => {
    try {
      const id = docId(c.req.param('id'));
      const user = c.get('user');

      /* ⚠️ Хэмжээг ХАМГИЙН ТҮРҮҮНД шалгана — Drive рүү огт хандахаас ӨМНӨ.
       *
       * Урьд нь энэ шалгалт байхгүй байсан тул хэт том файл дээр эхлээд
       * Drive рүү байршуулж, түр хуулбар үүсгэж, экспортлож байж эцэст нь
       * Google 10 MB-ийн хязгаараар татгалздаг байв — хэрэглэгч хэдэн секунд
       * хүлээгээд бүтэлгүйтдэг, хамгийн муу хэлбэр.  Одоо нэг D1 уншилтаар
       * шийдэж, шууд хариулна.
       *
       * `file_size` нь эх .docx-ийн хэмжээ бөгөөд экспортын PDF-ийн хэмжээтэй
       * ЯГ тэнцүү биш — тиймээс энэ нь урьдчилсан шүүлт, эцсийн шалгуур нь
       * Google-ийн `exportSizeLimitExceeded` хэвээр (тэр нь мөн 413 өгнө). */
      const revision = await latestRevision(c.env.DB, id);
      if (!revision) return c.json({ error: 'Баримт олдсонгүй.' }, 404);
      if ((revision.file_size ?? 0) > DRIVE_EXPORT_MAX_BYTES) {
        return c.json(
          {
            error:
              `Энэ баримт ${Math.round(DRIVE_EXPORT_MAX_BYTES / (1024 * 1024))} MB-аас том тул ` +
              'хуудсан дотор урьдчилан харах боломжгүй. «Google дээр засах» товчоор нээж үзнэ үү ' +
              '— засаж хадгалахад хэмжээний хязгаар байхгүй.',
          },
          413,
        );
      }

      const { mapping } = await ensureGoogleFile(c.env, c.env.DB, id, Number(user.sub));
      const bytes = await previewPdf(c.env, c.env.DB, mapping);
      return new Response(bytes, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(bytes.byteLength),
          // Хувийн агуулга — ирмэг дээр кэшлэхгүй.  Хэрэглэгчийн хөтөч дээр
          // богино хугацаанд барих нь дахин нээхэд хурдан.
          'Cache-Control': 'private, max-age=60',
        },
      });
    } catch (err) {
      const { status, error } = errorResponse(err);
      return c.json({ error }, status);
    }
  });

  /** Google дээрх засварыг архив руу ГАРААР татах.  Cron нь үүнийг 5 минут
   *  чимээгүй болсны дараа автоматаар хийдэг — энэ товч нь «яг одоо» гэсэн
   *  хувилбар. */
  app.post('/:id/office/sync', async (c) => {
    try {
      const id = docId(c.req.param('id'));
      const revision = await latestRevision(c.env.DB, id);
      if (!revision) return c.json({ error: 'Баримт олдсонгүй.' }, 404);
      const mapping = await openMappingFor(c.env.DB, id, revision.id, revision.file_url);
      if (!mapping) return c.json({ error: 'Энэ баримт Google дээр нээгдээгүй байна.' }, 409);
      const res = await syncFromGoogle(c.env, c.env.DB, mapping);
      return c.json({ revision_id: res.revisionId });
    } catch (err) {
      const { status, error } = errorResponse(err);
      return c.json({ error }, status);
    }
  });

  /**
   * Засварыг дуусгах: сүүлчийн байдлаар татаад Drive дээрх хуулбарыг хогийн
   * саванд хийнэ.  Татахыг эхэлж хийх нь чухал — эсрэгээр нь хийвэл хамгийн
   * сүүлийн засвар алдагдана.
   */
  app.post('/:id/office/close', async (c) => {
    try {
      const id = docId(c.req.param('id'));
      const revision = await latestRevision(c.env.DB, id);
      if (revision) {
        const mapping = await openMappingFor(c.env.DB, id, revision.id, revision.file_url);
        if (mapping) {
          try {
            await syncFromGoogle(c.env, c.env.DB, mapping);
          } catch (err) {
            console.error('close: final sync failed', err);
          }
        }
      }
      await closeMappings(c.env, c.env.DB, id);
      return c.json({ ok: true });
    } catch (err) {
      const { status, error } = errorResponse(err);
      return c.json({ error }, status);
    }
  });
}
