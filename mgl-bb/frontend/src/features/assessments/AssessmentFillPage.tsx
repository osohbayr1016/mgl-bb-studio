/**
 * `/app/assessments/:responseId` — үнэлгээ бөглөх wizard.
 *
 * Хуудаслалт нь схемээс бүтнэ (`AssessmentPart.paging`), архитекторын
 * судалгаанд 8 хуудас гарна: ур чадварын 7 хэсэг тус бүр + зан чанар нэг
 * хуудсанд. Хуудас солигдоход баруунаас зүүн тийш гулсах анимэйшн,
 * хуудас дотор энгийн доошоо гүйлгэлт.
 *
 * ХЭРЭГЖҮҮЛЭЛТИЙН ХОЁР ЗАНГИЛАА (санаатай, бүү «цэвэрлэ»):
 *
 * 1. `motion` биш `m`. `app/providers.tsx` нь `<LazyMotion features={domMax}
 *    strict>` — strict горим `motion.*`-ыг ХОРИГЛОЖ (runtime error шиднэ) `m.*`
 *    шаардана. `AnimatePresence` нь motion компонент биш тул шууд импортлоно.
 *
 * 2. `ScaleLegend` анимэйшны контейнерээс ГАДНА байрлана. Гулсалт хийхийн тулд
 *    контейнер `overflow-hidden` байх ёстой ба `position: sticky` нь хамгийн
 *    ойрын гүйлгэдэг эцгээ (`overflow-hidden` блок) сонгодог тул legend-ийг
 *    дотор нь тавибал наалдац ҮХНЭ. Гадна байрлуулснаар аппын жинхэнэ гүйлгэгч
 *    `<main id="main-content">`-д наалдаж, хуудас бүрийн дээр үлдэнэ.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, m, useReducedMotion, type Variants } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Lock,
  Send,
  UserCheck,
} from 'lucide-react';

import { ApiError } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { PageContainer } from '@/shared/components/PageContainer';
import { ErrorState } from '@/shared/components/ErrorState';
import { EmptyState } from '@/shared/components/EmptyState';
import { SaveBar } from '@/shared/components/SaveBar';
import { EASE_OUT } from '@/shared/lib/motion';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Progress } from '@/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog';

import { assessmentKeys, fetchResponse, submitResponse } from './api';
import { countAnswered, scaleForPart, schemaItemCount } from './lib/score';
import { displayScale } from './lib/scaleDisplay';
import type { AssessmentResponseDetail, AssessmentSchema, AssessmentScale } from './types';
import { IntroPage } from './components/IntroPage';
import { ScaleLegend } from './components/ScaleLegend';
import { SectionPage, type AssessmentPageDef } from './components/SectionPage';
import { useAssessmentAutosave } from './hooks/useAssessmentAutosave';
import { useUnansweredJump } from './hooks/useUnansweredJump';

/** Илгээсний дараа буцаж очих газар (Профайлын «Ур чадварын үнэлгээ» таб). */
const PROFILE_TAB = '/app/profile?tab=assessment';

/** Хадгалагдаагүй хариулт үлдсэн тул илгээлтийг зогсоосныг ялгах тэмдэг. */
const UNSAVED = 'assessments/unsaved';

/** Бүх асуултад хариулаагүй тул илгээлтийг зогсоосныг ялгах тэмдэг. */
const INCOMPLETE = 'assessments/incomplete';

/**
 * Схемээс wizard-ын хуудсуудыг бүтээнэ. §2 Хуудаслалт.
 *
 * `schema.intro` байвал ХАМГИЙН ЭХНИЙ хуудас нь танилцуулга болно — ажилтан
 * бөглөж эхлэхийн өмнө уншина.  Тэр хуудас асуултгүй тул явцын хувь, «үлдсэн
 * N» тоололд огт нөлөөлөхгүй.
 *
 * ⚠️ Энэ дүрэм `lib/editorPages.ts`-ийн `buildEditorPages`-тэй ЯГ ИЖИЛ байх
 *    ёстой — админ засварлагч дээр харсан хуудаслалт энд өөр гарвал бүх
 *    редакцийн ажил утгагүй болно.
 */
function buildPages(schema: AssessmentSchema): AssessmentPageDef[] {
  const scaleCache = new Map<string, AssessmentScale>();
  const pages: AssessmentPageDef[] = [];

  if (schema.intro?.length) {
    pages.push({ kind: 'intro', key: 'intro', blocks: schema.intro, sections: [] });
  }

  for (const part of schema.parts) {
    let scale = scaleCache.get(part.scaleId);
    if (!scale) {
      scale = displayScale(scaleForPart(schema, part));
      scaleCache.set(part.scaleId, scale);
    }
    if (part.paging === 'section') {
      for (const section of part.sections) {
        pages.push({
          kind: 'sections',
          key: `${part.id}::${section.id}`,
          part,
          scale,
          sections: [section],
        });
      }
    } else {
      pages.push({ kind: 'sections', key: part.id, part, scale, sections: part.sections });
    }
  }
  return pages;
}

// ---------------------------------------------------------------------------

export default function AssessmentFillPage() {
  const { responseId } = useParams<{ responseId: string }>();
  const { t } = useLanguage();
  const id = Number(responseId);
  const valid = Number.isInteger(id) && id > 0;

  const query = useQuery({
    queryKey: assessmentKeys.response(id),
    queryFn: () => fetchResponse(id),
    enabled: valid,
    retry: false,
  });

  if (!valid) {
    return (
      <PageContainer width="narrow">
        <ErrorState
          title={t('assessments.notFound')}
          icon={ClipboardList}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={PROFILE_TAB}>{t('assessments.backToProfile')}</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <PageContainer width="narrow">
        <ErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={PROFILE_TAB}>{t('assessments.backToProfile')}</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  // key={id} — өөр маягт руу шилжихэд autosave state бүрэн шинээр эхэлнэ.
  return <FillWizard key={id} response={query.data.response} />;
}

// ---------------------------------------------------------------------------
// Бөглөх wizard — өгөгдөл ирсний ДАРАА mount хийгддэг тул autosave-ийн
// эхлэлийн утга (хариултууд) тогтвортой.
// ---------------------------------------------------------------------------

function FillWizard({ response }: { response: AssessmentResponseDetail }) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();

  const schema = response.schema;
  const pages = useMemo(() => buildPages(schema), [schema]);
  const totalItems = useMemo(() => schemaItemCount(schema), [schema]);

  // Илгээгдсэн, round нээлттэй биш, эсвэл эзэн биш (жишээ нь admin
  // өөр хүний маягтыг нээж үзэж байгаа) бол — зөвхөн харах. Эзэн эсэхийг
  // үл харгалзан editable болговол autosave/submit нь `assertWritable`-д
  // чимээгүй 403-дож, хэрэглэгч бөглөсөн мэт боловч юу ч хадгалагдахгүй.
  const submitted = response.status === 'submitted';
  const roundClosed = response.round_status !== 'open';
  const isOwner = response.is_owner;
  const editable = !submitted && !roundClosed && isOwner;

  const { answers, setAnswer, status, dirty, lastSavedAt, commit, flush, save } =
    useAssessmentAutosave(response.id, response.answers, null, editable);

  const [pageIndex, setPageIndex] = useState(0);
  /** +1 — урагш (шинэ хуудас баруунаас), -1 — ухарч байна. */
  const [direction, setDirection] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const answeredCount = useMemo(() => countAnswered(schema, answers), [schema, answers]);
  const pagePct = totalItems > 0 ? (answeredCount / totalItems) * 100 : 0;
  const remaining = Math.max(0, totalItems - answeredCount);
  const page = pages[pageIndex];
  const isLast = pageIndex >= pages.length - 1;
  const isFirst = pageIndex <= 0;

  const goTo = (next: number, dir: 1 | -1) => {
    if (next < 0 || next >= pages.length) return;
    commit();
    setDirection(dir);
    setPageIndex(next);
  };

  const {
    highlightUnanswered,
    setHighlightUnanswered,
    spotlightId,
    jumpRef,
    skipTopScrollRef,
    jumpToUnanswered,
  } = useUnansweredJump({ pages, answers, pageIndex, reduceMotion, goTo });

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (skipTopScrollRef.current) {
      skipTopScrollRef.current = false;
      return;
    }
    const behavior: ScrollBehavior = reduceMotion ? 'auto' : 'smooth';
    const main = document.getElementById('main-content');
    if (main) main.scrollTo({ top: 0, behavior });
    else window.scrollTo({ top: 0, behavior });
  }, [pageIndex, reduceMotion, skipTopScrollRef]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      // Илгээхээс ӨМНӨ хүлээгдэж буй autosave-ийг дуустал хүлээнэ — эс бөгөөс
      // debounce-д сууж байсан сүүлийн хариулт түгжигдсэн маягтад бичигдэхгүй.
      const saved = await flush();
      if (!saved) throw new Error(UNSAVED);
      if (remaining > 0) throw new Error(INCOMPLETE);
      return submitResponse(response.id);
    },
    onSuccess: async () => {
      toast.success(t('assessments.submitSuccess'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: assessmentKeys.response(response.id) }),
        queryClient.invalidateQueries({ queryKey: assessmentKeys.my }),
        queryClient.invalidateQueries({ queryKey: assessmentKeys.myReviews }),
        queryClient.invalidateQueries({ queryKey: assessmentKeys.myResults }),
      ]);
      navigate(PROFILE_TAB);
    },
    onError: (err) => {
      const serverBlocked = err instanceof ApiError && err.code === 'ASSESSMENT_INCOMPLETE';
      const localBlocked = err instanceof Error && err.message === INCOMPLETE;
      if (serverBlocked || localBlocked) {
        const n =
          serverBlocked && typeof (err as ApiError).payload.remaining === 'number'
            ? ((err as ApiError).payload.remaining as number)
            : remaining;
        jumpToUnanswered();
        toast.error(t('assessments.submitBlockedTitle'), t('assessments.submitBlocked', { remaining: n }));
        return;
      }
      toast.error(
        err instanceof Error && err.message === UNSAVED
          ? t('assessments.submitUnsavedError')
          : t('assessments.submitError'),
      );
    },
  });

  const variants: Variants = useMemo(
    () =>
      reduceMotion
        ? {
            // prefers-reduced-motion — гулсалтгүй, зөвхөн солигдоно.
            enter: { opacity: 0 },
            center: { opacity: 1 },
            exit: { opacity: 0 },
          }
        : {
            enter: (dir: number) => ({ x: dir >= 0 ? '100%' : '-100%', opacity: 0 }),
            center: { x: 0, opacity: 1 },
            exit: (dir: number) => ({ x: dir >= 0 ? '-100%' : '100%', opacity: 0 }),
          },
    [reduceMotion],
  );

  if (pages.length === 0 || !page) {
    return (
      <PageContainer width="narrow">
        <EmptyState
          icon={ClipboardList}
          title={t('assessments.emptySchema')}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={PROFILE_TAB}>{t('assessments.backToProfile')}</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const openSubmitDialog = () => {
    if (remaining > 0) {
      jumpToUnanswered(); // setHighlightUnanswered(true)-г дотроо дуудна
      toast.error(t('assessments.submitBlockedTitle'), t('assessments.submitBlocked', { remaining }));
      return; // диалог НЭЭГДЭХГҮЙ
    }
    setConfirmOpen(true);
  };

  const handleShowUnanswered = () => {
    jumpToUnanswered();
    setConfirmOpen(false);
  };

  return (
    // Доод fixed мөрний ард агуулга нуугдахгүйн тулд нэмэлт padding.
    <div className="pb-28">
      {/* ---------------- Толгой ---------------- */}
      <div className="space-y-3">
        <Link
          to={PROFILE_TAB}
          className="inline-flex items-center gap-1 text-micro text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('assessments.backToProfile')}
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
              {response.round_period}
            </p>
            <h1 className="text-title text-foreground">{response.round_name}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {submitted && (
              <Badge className="gap-1 bg-success/15 text-success" variant="secondary">
                <CheckCircle2 className="h-3 w-3" />
                {t('assessments.submitted')}
              </Badge>
            )}
            {!submitted && roundClosed && (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <Lock className="h-3 w-3" />
                {t('assessments.roundClosed')}
              </Badge>
            )}
            {editable && (
              <SaveBar
                status={status}
                dirty={dirty}
                lastSavedAt={lastSavedAt}
                locale={lang}
                onSave={save}
              />
            )}
          </div>
        </div>

        {/* Хэнийг үнэлж байгааг ТОД харуулна — senior олон ажилтны маягтыг
            дараалан бөглөх тул андуурвал бүхэл судалгаа гажина. */}
        {response.evaluator_kind === 'senior' && (
          <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 p-3">
            <UserCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            <p className="text-sm font-semibold text-foreground">
              {t('assessments.evaluatingSubject', { name: response.subject_name })}
            </p>
          </div>
        )}

        {!editable && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            <span>
              {!isOwner
                ? t('assessments.notOwnerNotice')
                : submitted
                  ? t('assessments.submittedNotice')
                  : t('assessments.roundClosedNotice')}
            </span>
            {submitted && response.evaluator_kind === 'self' && (
              <Button asChild size="sm" variant="outline">
                <Link to={`/app/assessments/results/${response.round_id}`}>
                  {t('assessments.viewResultCharts')}
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ---------------- Онооны тайлбар (наалдмал) ----------------
          Анимэйшны контейнерээс ГАДНА — файлын толгой дахь 2-р тайлбарыг үз.
          Танилцуулга хуудсанд оноо өгөх мөр байхгүй тул legend ч гарахгүй. */}
      {page.kind === 'sections' && (
        <ScaleLegend key={page.scale.id} scale={page.scale} className="mt-4" />
      )}

      {/* ---------------- Хуудасны агуулга (гулсалт) ---------------- */}
      <div className="relative overflow-hidden">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <m.div
            key={page.key}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: reduceMotion ? 0.15 : 0.32, ease: EASE_OUT }}
            className="w-full"
          >
            {page.kind === 'intro' ? (
              <IntroPage blocks={page.blocks} />
            ) : (
              <SectionPage
                page={page}
                answers={answers}
                disabled={!editable}
                onChange={setAnswer}
                onCommit={commit}
                highlightUnanswered={highlightUnanswered}
                spotlightItemId={spotlightId}
              />
            )}
          </m.div>
        </AnimatePresence>
      </div>

      {/* ---------------- Доод удирдлага (viewport-д бэхлэгдсэн) ----------------
          Байрлал нь `StickySaveBar`-тай ижил: утсан дээр доод таб мөрний ДЭЭР
          (`z-30` < navbar-ын `z-40`). */}
      <div
        className={cn(
          'fixed inset-x-0 z-30 border-t border-border bg-background/95 backdrop-blur',
          'bottom-[calc(var(--app-bottom-nav-h)+env(safe-area-inset-bottom))] lg:bottom-0',
        )}
      >
        <div className="mx-auto max-w-[1600px] space-y-1.5 px-4 py-2.5 lg:px-7">
          <div className="flex items-center justify-between gap-3 text-micro text-muted-foreground">
            <span className="tabular-nums">
              {t('assessments.pageOf', { current: pageIndex + 1, total: pages.length })}
            </span>
            <span className="tabular-nums">
              {t('assessments.answeredOf', { answered: answeredCount, total: totalItems })}
            </span>
          </div>
          <Progress
            value={pagePct}
            className="h-1.5"
            indicatorClassName={remaining === 0 ? 'bg-success' : undefined}
            aria-label={t('assessments.progressLabel')}
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => goTo(pageIndex - 1, -1)}
              disabled={isFirst}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t('assessments.prev')}
            </Button>

            {editable && remaining > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-w-0 flex-1 truncate text-warning-foreground hover:text-warning-foreground"
                title={t('assessments.jumpToUnansweredHint')}
                onClick={() => {
                  setHighlightUnanswered(true);
                  jumpToUnanswered();
                }}
              >
                {t('assessments.jumpToUnanswered', { n: remaining })}
              </Button>
            )}

            {isLast ? (
              <Button
                type="button"
                size="sm"
                onClick={openSubmitDialog}
                disabled={!editable || submitMutation.isPending}
                title={remaining > 0 ? t('assessments.submitAllRequiredHint') : undefined}
              >
                {submitMutation.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-1 h-4 w-4" />
                )}
                {t('assessments.submit')}
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => goTo(pageIndex + 1, 1)}>
                {/* Танилцуулга хуудсан дээр «Дараах» биш «Эхлэх» гэж уриална. */}
                {page.kind === 'intro' ? t('assessments.startFilling') : t('assessments.next')}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ---------------- Илгээх баталгаажуулалт ---------------- */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            if (jumpRef.current) e.preventDefault();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assessments.submitConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {remaining > 0
                ? t('assessments.submitBlocked', { remaining })
                : t('assessments.submitConfirmBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {remaining > 0 && (
              <Button
                type="button"
                variant="outline"
                className="mr-auto"
                onClick={handleShowUnanswered}
              >
                {t('assessments.submitShowUnanswered')}
              </Button>
            )}
            <AlertDialogCancel disabled={submitMutation.isPending}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Диалог хаагдахаас өмнө mutation эхлүүлнэ (Radix анхдагчаар
                // Action дээр хаадаг — тэр нь энд асуудалгүй, товч дахин
                // дарагдахгүй болгохын тулд disabled-ийг ч тавьсан).
                e.preventDefault();
                setConfirmOpen(false);
                submitMutation.mutate();
              }}
              disabled={submitMutation.isPending || remaining > 0}
            >
              {t('assessments.submit')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
