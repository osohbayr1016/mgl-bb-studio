import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { useForceLightTheme } from '@/shared/hooks/useForceLightTheme';
import { useLanguage } from '@/shared/i18n';
import { bridgePrintToken } from '@/shared/lib/printAuth';
import { Button } from '@/ui/button';
import { PassportDocumentEditor } from '@/features/projects/components/passport/PassportDocumentEditor';
import {
  LOCKED_FIELDS,
  docRowsFromClientDocs,
  passportToDocDraft,
} from '@/features/projects/components/passport/passportDoc';
import { passportForDisplay } from '@/features/projects/components/passport/passportSections';
import type { ProjectClientDocument, ProjectDetailResponse, ProjectPassport } from '@/shared/types';

/**
 * «1. Төслийн мэдээлэл / Project Information» (паспорт) — ХЭВЛЭХ хуудас,
 * `/reports/project/:id/passport/print`.
 *
 * Бусад баримтын хэвлэх хуудастай ижил бүтэц (`AsrPrintPage`,
 * `CorrespondencePrintPage`): аппын `<Layout>`-ийн ГАДНА, дээр нь «Хаах /
 * Хэвлэх» мөр, `?auto=1` бол бэлэн болмогц хэвлэх цонх нээнэ,
 * `body[data-print-ready="true"]` — ирээдүйн сервер PDF (Browser Rendering)
 * энэ тугийг хүлээнэ.
 *
 * Яагаад тусдаа хуудас: «Мэдээлэл» таб дотроос `window.print()` хийхэд аппын
 * бүрхүүл (`h-dvh overflow-hidden` + `<main>`-ийн скролл) баримтын дээд
 * хэсгийг тайрч, хэвтээ скроллын зураас хэвлэгддэг байв (2026-09-28).
 *
 * ProtectedRoute-ийн ГАДНА: захиалагчийн портал ч энэ паспортыг
 * (`EmbeddedSections` → `ProjectInfoTab readOnly`) харуулдаг бөгөөд `/app/*`
 * дотор байсан бол client sandbox түүнийг `/client` руу шидэх байсан.  Эрхийг
 * гурван API дуудлага өөрсдөө шалгана — табын дууддагтай ЯГ ижил.
 *
 * Агуулга нь СЕРВЕР дээрх хадгалсан паспорт — хадгалаагүй засвар энд
 * харагдахгүй (таб хэвлэхээс өмнө хадгалуулдаг).
 */
bridgePrintToken();

export default function PassportPrintPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [searchParams] = useSearchParams();
  const auto = searchParams.get('auto') === '1';
  const { t } = useLanguage();
  useForceLightTheme();

  const passportQuery = useApiQuery<{ passport: ProjectPassport | null }>(
    ['/projects/passport', projectId],
    `/projects/${projectId}/passport`,
  );
  const docsQuery = useApiQuery<{ documents: ProjectClientDocument[] }>(
    ['/projects/client-documents', projectId],
    `/projects/${projectId}/client-documents`,
  );
  /* Захиалагчийн нэр + байршил (паспортод байхгүй, түгжсэн нүд).  Унасан ч
   * баримтыг хэвлэнэ — тэр хоёр нүд хоосон л гарна. */
  const projectQuery = useApiQuery<ProjectDetailResponse>(
    ['/projects', String(projectId)],
    `/projects/${projectId}`,
    { retry: false },
  );

  const loading = passportQuery.isLoading || docsQuery.isLoading || projectQuery.isLoading;
  const failed = !loading && (passportQuery.isError || docsQuery.isError);

  /* Arimo (баримтын фонт) ачаалагдсаны дараа баримтыг ДАХИН mount хийнэ —
   * `PassportDocumentEditor`-ийн «нэг A4-д багтаах» хэмжилт фонтын өндрөөс
   * хамаардаг тул нөөц фонтоор хэмжсэн масштаб үлдвэл хоёр дахь хуудас руу
   * нэг мөр унаж болно. */
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const projectName = projectQuery.data?.project?.name ?? '';
  useEffect(() => {
    /* «Save as PDF»-ийн санал болгох файлын нэр. */
    if (projectName) document.title = `${t('projectInfoTab.printTitle')} — ${projectName}`;
  }, [projectName, t]);

  const ready = !loading && fontsReady;
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const done = () => {
      if (cancelled) return;
      document.body.setAttribute('data-print-ready', 'true');
      if (auto && !failed) window.print();
    };
    /* Хоёр кадр — дахин mount болсон баримтын масштаб тогтсоны дараа. */
    const raf = requestAnimationFrame(() => requestAnimationFrame(done));
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [ready, auto, failed]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (failed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-destructive">
        {t('projectInfoTab.printLoadFailed')}
      </div>
    );
  }

  const passport = passportForDisplay(
    passportQuery.data?.passport ?? ({ project_id: projectId } as ProjectPassport),
  );
  const clientNames = (projectQuery.data?.clients ?? [])
    .map((cl) => cl.name?.trim())
    .filter((n): n is string => !!n);
  const draft = passportToDocDraft({
    passport,
    documents: docRowsFromClientDocs(docsQuery.data?.documents ?? []),
    clientName: clientNames.join(', '),
    location: projectQuery.data?.project?.location ?? '',
  });

  return (
    <div className="min-h-screen bg-muted/40 print:min-h-0 print:bg-white">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
        <Button type="button" variant="ghost" size="sm" className="gap-2" onClick={() => window.close()}>
          <ArrowLeft className="h-4 w-4" /> {t('common.close')}
        </Button>
        <Button type="button" size="sm" className="gap-2" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> {t('projectInfoTab.print')}
        </Button>
      </div>

      {/* `print-area` — `index.css` ба `PassportDocumentEditor`-ийн хэвлэлийн
          дүрэм зөвхөн үүнийг үлдээнэ; `pd-doc-print` нь түүний 1cm зайг цуцална. */}
      <div className="print-area pd-doc-print px-4 py-6">
        <PassportDocumentEditor
          key={fontsReady ? 'fonts' : 'fallback'}
          value={draft}
          onChange={() => undefined}
          readOnly
          lockedFields={LOCKED_FIELDS}
        />
      </div>
    </div>
  );
}
