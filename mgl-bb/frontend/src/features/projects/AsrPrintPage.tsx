import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Pencil, Printer } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import { useForceLightTheme } from '@/shared/hooks/useForceLightTheme';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { whenHandSignsReady } from '@/shared/components/HandSignature';
import { AsrPagedDocument } from './asr/AsrPagedDocument';
import { ASR_DOC_STYLES } from './asr/asrPrintStyles';
import type { AsrDetailResponse } from './asr/types';

/**
 * Зохиогчийн хяналтын тайлангийн хэвлэх хуудас.
 *
 * `<Layout>`-ийн ГАДНА, `<ProtectedRoute>`-ийн ДОТОР бүртгэгдсэн —
 * `/app/projects/:id/team-reports/:teamCode/print`-ийн яг адил.
 *
 * ⚠️ Энэ хуудсыг ХОЁР хэрэглэгч уншина:
 *    1) хүн өөрөө нээж `window.print()` дарна;
 *    2) СЕРВЕР — `GET /api/author-supervision/:id/pdf` нь Browser Rendering-ээр
 *       ЯГ энэ хаяг руу орж (`?t=<1 минутын токен>`) PDF болгодог
 *       (`routes/authorSupervision.ts`).  Тэр зам нь
 *       `body[data-print-ready="true"]`-ыг 25 секунд хүлээдэг.
 *    Өмнөх тайлбар «сервер талын PDF БАЙХГҮЙ» гэж бичсэн нь хуучирсан
 *    байсан — тиймээс доорх алдааны замд `data-print-ready` тавихаа мартаж,
 *    ачаалж чадаагүй тайлан 25 секунд өлгөөстөөд «амжилттай» PDF болж
 *    хэрэглэгчид алдааны бичвэр агуулсан баримт очдог байв.
 *
 * ДЭЛГЭЦ ДЭЭР баримт A4 хуудсуудад хуваагдаж харагдана (`AsrPagedDocument`,
 * эзний хүсэлт 2026-09-28) — хэвлэхэд гарах ЯГ тэр хуудаслалт.  Хэвлэх /
 * серверийн PDF (print media) нь хуучин ердийн урсгалаараа хэвээр.
 * «Засварлах» нь засварлагч руу (`/app/asr/:id?edit=1`) ижил табаар шилжинэ.
 */
export default function AsrPrintPage() {
  const { id, reportId } = useParams<{ id: string; reportId: string }>();
  const [searchParams] = useSearchParams();
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  useForceLightTheme();

  const { data, isLoading, isError } = useApiQuery<AsrDetailResponse>(
    ['asr', 'print', Number(reportId)],
    `/author-supervision/${reportId}`,
  );
  const project = useApiQuery<{ project: { name: string; asr_name?: string | null } }>(
    ['asr', 'print-project', Number(id)],
    `/projects/${id}`,
  );

  const entry = data?.entry;
  const ready = !!entry && !project.isLoading;
  const auto = searchParams.get('auto') === '1';

  // Фонт болон БҮХ зураг декодлогдсоны дараа л бэлэн гэж тэмдэглэнэ.
  // Зураг ачаалагдаагүй байхад хэвлэвэл хоосон нүд гарч, доорх агуулга
  // дараагийн хуудас руу мултарна.  Алдаа гарсан ч тэмдэглэнэ — эс бөгөөс
  // ирээдүйн сервер рендер 25 секунд хүлээгээд хоосон буцна.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const done = () => {
      if (cancelled) return;
      document.body.setAttribute('data-print-ready', 'true');
      if (auto) window.print();
    };
    const imgs = Array.from(document.images);
    Promise.all([
      document.fonts?.ready ?? Promise.resolve(),
      whenHandSignsReady(),
      ...imgs.map((img) => img.decode().catch(() => undefined)),
    ])
      .then(() =>
        Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined))),
      )
      .then(() => requestAnimationFrame(() => requestAnimationFrame(done)))
      .catch(done);
    // Аюулгүйн хугацаа — ямар нэг зураг мөнхөд өлгөгдвөл.
    const bail = setTimeout(done, 15000);
    return () => {
      cancelled = true;
      clearTimeout(bail);
    };
  }, [ready, auto]);

  if (isLoading || project.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (isError || !entry) {
    // Серверийн PDF рендер энэ тугийг хүлээдэг тул алдааны үед Ч тавина:
    // 25 секунд дэмий хүлээхийн оронд шалтгаан нь ил харагдсан баримт
    // шууд гарч ирнэ.  `useEffect` нь `ready` дээр гацдаг тул энд гараар.
    return (
      <div
        ref={() => document.body.setAttribute('data-print-ready', 'true')}
        className="flex min-h-screen items-center justify-center bg-white text-sm text-gray-600"
      >
        {t('asr.loadFailed')}
      </div>
    );
  }

  /*
   * Засах эрх — `AsrEditorShell`-ийн `editable`-ийн ТОЛИН ТУСГАЛ (сервер
   * `PATCH /:id` gate): зохиогч өөрийн ноорог/буцаагдсаныг, админ дурыг.
   * Батлагдсан тайланг админ засварлагч дотор «Засварлах» дарж тайлна.
   */
  const canEdit =
    !!user &&
    (user.role === 'admin' ||
      (entry.author_id === user.id && (entry.status === 'draft' || entry.status === 'rejected')));

  return (
    <div className="min-h-screen bg-muted print:bg-white">
      <style dangerouslySetInnerHTML={{ __html: ASR_DOC_STYLES }} />

      <div className="asr-print-toolbar sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background px-4 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => window.close()}
        >
          <ArrowLeft className="h-4 w-4" /> {t('common.close')}
        </Button>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => navigate(`/app/asr/${entry.id}?project=${entry.project_id}&edit=1`)}
            >
              <Pencil className="h-4 w-4" /> {t('asr.modeEdit')}
            </Button>
          )}
          <Button type="button" size="sm" className="gap-2" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> {t('asr.print')}
          </Button>
        </div>
      </div>

      {/* Дэлгэц дээр A4 хуудсууд (саарал дэвсгэр дээр цагаан цаас); хэвлэхэд
          ердийн урсгал — зай нь thead/tfoot + хажуугийн padding. */}
      <div className="px-2 py-6 sm:px-6 print:p-0">
        {/* Шифр ба албан ёсны нэрийг ИЛ дамжуулна.  Хоёулаа `entry`-ээс ирдэг
            (сервер тал `shapeRow`-д паспорттой нэгтгэсэн) тул нэмэлт query
            хэрэггүй — ил дамжуулалт нь баримтын толгойд юу гарахыг код
            уншихад харагдуулах зорилготой. */}
        <AsrPagedDocument
          entry={entry}
          projectName={project.data?.project?.name ?? ''}
          projectLabel={project.data?.project?.asr_name ?? null}
          shifr={entry.shifr}
          officialTitle={entry.passport_title}
        />
      </div>
    </div>
  );
}
