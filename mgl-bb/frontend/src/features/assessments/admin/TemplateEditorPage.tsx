/**
 * `/app/admin/assessments/templates/:templateId` — асуулгын БҮТЭН ДЭЛГЭЦИЙН
 * засварлагч (ЗӨВХӨН admin).
 *
 * Өмнө нь энэ нь `TemplateBuilder` нэртэй диалог байсан: 88vh хайрцагт мод +
 * талбарын хос багтаж чадалгүй доод тал нь таслагдаж, гүйлгэгдэхгүй байв.
 * Одоо бүтэн хуудас бөгөөд голд нь АЖИЛТНЫ бөглөх харагдацыг яг тольдсон
 * хуудсууд гарна — админ текст дээр нь шууд дарж засварлана.
 *
 * Гурван багана:
 *   зүүн  — хуудасны жагсаалт (ажилтны харах дараалалтай ЯГ ижил),
 *   гол   — засагддаг «ажилтны хуудас» (`EditablePage`),
 *   баруун — тоон/бүтцийн тохиргоо (жин, код, шатлал, график, баг).
 *
 * Хадгалалт нь autosave (2.5с debounce) — «Хадгалах» товч дарах шаардлагагүй,
 * гэхдээ SaveBar-аас гараар шахаж болно.  Хамгийн сүүлийн алхам нь
 * «Багтаа илгээх» → `PublishDialog` → раунд үүсч мэдэгдэл явна.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  PanelLeft,
  Send,
  SlidersHorizontal,
} from 'lucide-react';

import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import { ErrorState } from '@/shared/components/ErrorState';
import { SaveBar } from '@/shared/components/SaveBar';
import { useLanguage } from '@/shared/i18n';
import type { Team } from '@/shared/types';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/ui/sheet';

import { assessmentKeys, fetchTemplate } from '../api';
import { ScaleLegend } from '../components/ScaleLegend';
import { useTemplateAutosave } from '../hooks/useTemplateAutosave';
import { buildEditorPages } from '../lib/editorPages';
import type { EditorSelection } from '../lib/editorPages';
import { displayScale } from '../lib/scaleDisplay';
import {
  addPart,
  applyPartSplit,
  draftToSchema,
  schemaToDraft,
  scaleOf,
} from '../lib/schemaDraft';
import type { PartSplitProposal } from '../lib/schemaDraft';
import type { AssessmentTemplateDetail } from '../types';
import { EditablePage } from './editor/EditablePage';
import { EditorInspector } from './editor/EditorInspector';
import { EditorOutline } from './editor/EditorOutline';
import { PublishDialog } from './editor/PublishDialog';
import { SplitPartsPrompt } from './editor/SplitPartsPrompt';
import { USERS_ASSESSMENTS_TAB } from './AssessmentsAdminTab';

const ADMIN_LIST = USERS_ASSESSMENTS_TAB;

export default function TemplateEditorPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { templateId } = useParams<{ templateId: string }>();

  const id = Number(templateId);
  const valid = Number.isInteger(id) && id > 0;
  const isAdmin = user?.role === 'admin';

  const query = useQuery({
    queryKey: assessmentKeys.template(id),
    queryFn: () => fetchTemplate(id),
    enabled: valid && isAdmin,
    retry: false,
    // Autosave нь `setQueryData`-аар кэшийг өөрөө шинэчилдэг тул фокус
    // буцахад дахин татвал хагас бичсэн ноорог сервер дээрхээр дарагдана.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const teamsQuery = useApiQuery<{ teams: Team[] }>('/teams', {
    enabled: isAdmin,
    retry: false,
  });

  // ⚠️ Role шалгалт БҮХ hook-ийн ДАРАА (AssessmentAdminPage-ийн хэв маяг).
  if (!isAdmin || !valid) return <Navigate to="/app" replace />;

  if (query.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="p-6">
        <ErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={ADMIN_LIST}>{t('assessments.editor.backToList')}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  // key — өөр загвар руу шилжихэд autosave-ийн бүх state шинээр эхэлнэ.
  return (
    <Editor key={id} template={query.data.template} teams={teamsQuery.data?.teams ?? []} />
  );
}

// ---------------------------------------------------------------------------

function Editor({ template, teams }: { template: AssessmentTemplateDetail; teams: Team[] }) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const initial = useMemo(
    () =>
      schemaToDraft(template.schema, {
        code: template.code,
        titleMn: template.title_mn,
        titleEn: template.title_en,
        description: template.description,
        teamCodes: template.team_codes,
        seniorUserIds: template.senior_user_ids,
      }),
    [template],
  );

  const { draft, setDraft, status, dirty, blocked, lastSavedAt, commit, flush, save } =
    useTemplateAutosave(template.id, initial, template.updated_at);

  const pages = useMemo(
    () => buildEditorPages(draft, t('assessments.editor.introPage')),
    [draft, t],
  );
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<EditorSelection | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(() => searchParams.get('publish') === '1');

  // Word импортоос ирсэн «2 судалгаа байна» санал (`navigate(..., { state })`).
  const importedSplit = (location.state as { split?: PartSplitProposal } | null)?.split ?? null;
  const [splitProposal, setSplitProposal] = useState<PartSplitProposal | null>(importedSplit);

  // Саналыг history state-ээс НЭГ УДАА уншаад цэвэрлэнэ — эс бөгөөс хуудас
  // сэргээх бүрд дахин гарч ирнэ (админ аль хэдийн шийдсэн байхад).
  useEffect(() => {
    // `location.search`-ыг хэвээр авч үлдэнэ — эс бөгөөс `?publish=1` мэт
    // угтвар энд чимээгүй тасарна.
    if (importedSplit) {
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `?publish=1` угтварыг нэг удаа хэрэглээд URL-ээс салгана.
  useEffect(() => {
    if (searchParams.get('publish') !== '1') return;
    const next = new URLSearchParams(searchParams);
    next.delete('publish');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Хуудас устсан/нэмэгдсэн үед индекс хүрээнээс гарахаас сэргийлнэ.
  const safeIndex = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const page = pages[safeIndex];

  const { warnings } = useMemo(() => draftToSchema(draft), [draft]);

  const goTo = (next: number) => {
    if (next < 0 || next >= pages.length) return;
    commit();
    setPageIndex(next);
    setOutlineOpen(false);
    document.getElementById('template-editor-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const outline = (
    <EditorOutline
      draft={draft}
      pages={pages}
      index={safeIndex}
      onGo={goTo}
      onAddPart={() => {
        const edit = addPart(draft);
        setDraft(edit.draft);
        if (edit.ref) setSelected(edit.ref);
        setPageIndex(pages.length);
      }}
    />
  );

  const inspector = (
    <EditorInspector
      draft={draft}
      selected={selected}
      teams={teams}
      onChange={setDraft}
      onCommit={commit}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ------------------------------ Толгой ------------------------------ */}
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button asChild variant="ghost" size="sm">
          <Link to={ADMIN_LIST}>
            <ArrowLeft /> {t('assessments.editor.backToList')}
          </Link>
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          className="xl:hidden"
          aria-label={t('assessments.editor.outline')}
          onClick={() => setOutlineOpen(true)}
        >
          <PanelLeft />
        </Button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {draft.titleMn.trim() || t('assessments.editor.untitled')}
          </p>
          <p className="truncate text-micro text-muted-foreground">
            <span className="font-mono">{draft.code || '—'}</span>
            {draft.teamCodes.length > 0 && <span> · {draft.teamCodes.join(', ')}</span>}
          </p>
        </div>

        {blocked && (
          <Badge variant="secondary" className="gap-1 bg-amber-500/20 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3" />
            {t('assessments.builder.requireMeta')}
          </Badge>
        )}
        {warnings.length > 0 && (
          <Badge
            variant="secondary"
            className="gap-1 bg-amber-500/20 text-amber-700 dark:text-amber-400"
            title={warnings.map((w) => t(w.key, w.params)).join('\n')}
          >
            <AlertTriangle className="size-3" />
            {warnings.length}
          </Badge>
        )}

        <SaveBar
          status={status}
          dirty={dirty}
          lastSavedAt={lastSavedAt}
          locale={lang}
          onSave={save}
        />

        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          aria-label={t('assessments.editor.inspector')}
          onClick={() => setInspectorOpen(true)}
        >
          <SlidersHorizontal />
        </Button>

        <Button size="sm" onClick={() => setPublishOpen(true)}>
          <Send /> {t('assessments.editor.publish')}
        </Button>
      </header>

      {/* ------------------------------ Их бие ------------------------------ */}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-border xl:block">{outline}</aside>

        <main
          id="template-editor-scroll"
          className="min-w-0 flex-1 overflow-y-auto px-4 pb-10 lg:px-8"
        >
          <div className="mx-auto max-w-3xl">
            {!page ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                {t('assessments.emptySchema')}
              </div>
            ) : (
              <>
                {/* Ажилтны талд байдаг онооны legend — админ ижил зүйл харна. */}
                {page.kind === 'sections' && (
                  <ScaleLegend
                    key={page.part.scaleId}
                    scale={displayScale(scaleOf(draft, page.part))}
                    className="mt-3"
                  />
                )}
                <EditablePage
                  draft={draft}
                  page={page}
                  selected={selected}
                  onChange={setDraft}
                  onSelect={setSelected}
                  onCommit={commit}
                />
              </>
            )}
          </div>
        </main>

        <aside className="hidden w-80 shrink-0 border-l border-border lg:block">{inspector}</aside>
      </div>

      {/* ------------------------- Доод навигаци ------------------------- */}
      <footer className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <Button variant="outline" size="sm" disabled={safeIndex <= 0} onClick={() => goTo(safeIndex - 1)}>
          <ArrowLeft /> {t('assessments.prev')}
        </Button>
        <span className="text-micro tabular-nums text-muted-foreground">
          {t('assessments.pageOf', { current: safeIndex + 1, total: pages.length })}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={safeIndex >= pages.length - 1}
          onClick={() => goTo(safeIndex + 1)}
        >
          {t('assessments.next')} <ArrowRight />
        </Button>
      </footer>

      {/* ---------------------- Жижиг дэлгэцийн панелиуд ---------------------- */}
      <Sheet open={outlineOpen} onOpenChange={setOutlineOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>{t('assessments.editor.outline')}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1">{outline}</div>
        </SheetContent>
      </Sheet>

      <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
        <SheetContent side="right" className="w-80 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>{t('assessments.editor.inspector')}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1">{inspector}</div>
        </SheetContent>
      </Sheet>

      {splitProposal && (
        <SplitPartsPrompt
          open
          proposal={splitProposal}
          onOpenChange={(open) => {
            if (!open) setSplitProposal(null);
          }}
          onAccept={() => {
            setDraft(applyPartSplit(draft, splitProposal));
            setSplitProposal(null);
            setPageIndex(0);
          }}
        />
      )}

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        templateId={template.id}
        templateTitle={draft.titleMn.trim() || template.title_mn}
        defaultTeamCodes={draft.teamCodes}
        defaultSeniorUserIds={draft.seniorUserIds}
        teams={teams}
        onBeforeCreate={flush}
        onCreated={(round) => navigate(`${ADMIN_LIST}/${round.id}`)}
      />
    </div>
  );
}
