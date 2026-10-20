import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Check, Copy, Loader2, Settings2 } from 'lucide-react';

import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import type { ProjectPassport } from '@/shared/types';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { cn } from '@/shared/lib/utils';
import {
  PROJECT_CATEGORIES,
  PROJECT_CATEGORY_CODES,
  categoryName,
} from '@/shared/lib/project-categories';
import StickySaveBar from '@/shared/components/StickySaveBar';
import HelpDrawer from '@/shared/components/HelpDrawer';
import { SetupCompletionHero } from '@/features/dashboard';
import KeyboardShortcutsHelp from '@/shared/components/KeyboardShortcutsHelp';

// This page used to be one ~5 700-line module. The preset catalogue, team
// metadata, row types, weight utilities, every sub-component and all of the
// state/handler logic were moved verbatim into ./setup/* — see
// useProjectSetup for how the hooks are composed, and BlockList /
// TeamTabNavigator for the two big render trees.
import { BlockList } from './setup/BlockList';
import { TeamTabNavigator } from './setup/TeamTabNavigator';
import { useProjectSetup } from './setup/useProjectSetup';
import { CopyStructureSheet } from './setup/copy/CopyStructureSheet';

export default function AdminProjectSetupPage() {
  // All of this page's state and handlers live in ./setup/* — see
  // useProjectSetup for the composition.
  const setup = useProjectSetup();
  const {
    banner,
    blocks,
    canManageSetup,
    components,
    dirtyCount,
    drawings,
    fixAllZeroSums,
    flash,
    id,
    jumpToMismatch,
    loadAll,
    loading,
    projectCategory,
    projectName,
    queryClient,
    saveAll,
    saving,
    savingCategory,
    setActiveTeamId,
    setProjectCategory,
    setSavingCategory,
    summary,
    t,
    tasks,
  } = setup;

  /* ==========================================================================
     «Бүтэц татах» (migration 0254)
     ==========================================================================
     ⚠️ `?copyFrom=<эх төслийн id>`-ыг URL-ЭЭС уншина, `useState`-ээс БИШ.
     Төсөл үүсгэх цонх энэ хаяг руу шилжүүлдэг тул шинээр үүссэн ЗА төсөл
     дээр цонх өөрөө нээгдэнэ; мөн хаягийг хуваалцахад ижилхэн ажиллана
     (аппын `?tab=` / `?section=` конвенц).

     ⚠️ ЭФФЕКТГҮЙ: нээлттэй байдал нь параметрээс ШУУД гардаг
     (`copyOpenManual || copyFromId !== null`), хаахад л параметрийг
     арчина.  `useEffect`-ээр «нээгээд дараа нь арчих» хувилбар нь энэ
     репогийн `react-hooks/set-state-in-effect` дүрэмтэй зөрчилдөнө. */
  const [searchParams, setSearchParams] = useSearchParams();
  const copyFromRaw = searchParams.get('copyFrom');
  const copyFromId = copyFromRaw && /^\d+$/.test(copyFromRaw) ? Number(copyFromRaw) : null;
  const [copyOpenManual, setCopyOpenManual] = useState(false);
  const copyOpen = copyOpenManual || copyFromId !== null;
  const onCopyOpenChange = (open: boolean) => {
    if (open) {
      setCopyOpenManual(true);
      return;
    }
    setCopyOpenManual(false);
    if (copyFromId === null) return;
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('copyFrom');
        return p;
      },
      { replace: true },
    );
  };

  /* Эх төслийн САНАЛ-ыг сайжруулах цорын ганц оролт нь энэ төслийн шифр
   * (`project_passport.drawing_no`) — `loadProjectTree` паспорт татдаггүй
   * тул энд тусад нь.  ⚠️ `enabled: copyOpen` — цонх нээгдтэл СҮЛЖЭЭНД
   * хүрэхгүй; түлхүүр нь `ProjectInfoTab`-ынхтай ЯГ ижил тул тэр таб аль
   * хэдийн зочилсон бол кэшээс шууд ирнэ. */
  const passportQuery = useApiQuery<{ passport: ProjectPassport | null }>(
    ['/projects/passport', Number(id)] as const,
    `/projects/${id}/passport`,
    { enabled: copyOpen && !!id, retry: false },
  );

  /* Хуулсны дараа: (1) хуудсаа ДАХИН УНШИНА — мод нь `useState`-д амьдардаг
   * тул `invalidateQueries` үүнийг сэргээхгүй (`loadProjectTree`-ийн түүхий
   * `apiFetch`; урьдчилсан жишээ нь `useSetupDelete.dupBlock`); (2) идэвхтэй
   * багийн табыг ЗОРИУД шинэ ростерын ЭХНИЙ баг руу тавина — эс бөгөөс
   * `useSetupStore`-ийн авто-сонголт хуучин таб дээр үлдээж, хуулагдсан
   * ажил өөр табын дор нуугдана; (3) бусад дэлгэцийн `/projects` кэшийг
   * хүчингүй болгоно (жагсаалт, дэлгэрэнгүй, «Үүссэн төслүүд»). */
  const handleCopied = () => {
    void (async () => {
      await loadAll();
      setActiveTeamId(null);
      queryClient.invalidateQueries({ queryKey: ['/projects'] });
    })();
  };

  if (!canManageSetup) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        {t('adminProjectSetupPage.adminOnly')}
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  /* ==========================================================================
     Render
     ==========================================================================
  */
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 animate-in fade-in duration-500 pb-24">
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <Link
          to={`/app/projects/${id}`}
          className="hover:text-foreground flex items-center transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> {t('common.back')}
        </Link>
      </div>

      {/* Header — title + Help/cheatsheet affordances.  The Save button
          used to live here; it now lives in StickySaveBar at the viewport
          bottom so it's always reachable while the admin scrolls. */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Settings2 className="h-7 w-7 text-primary flex-shrink-0" />
            <span className="truncate">
              {t('adminProjectSetupPage.headerTitle', { name: projectName })}
            </span>
          </h2>
          <p className="text-muted-foreground text-sm mt-1.5">
            {t('adminProjectSetupPage.headerSubtitle')}{' '}
            <strong className="text-foreground">{t('adminProjectSetupPage.help')}</strong>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Category — drives the +Баг dropdown grouping and is shown
              as a badge on the projects list. The replace-all
              team_shares table is NOT touched when category changes;
              the admin retunes the roster manually via +Баг. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={savingCategory}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                  projectCategory
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'border-dashed border-border/60 text-muted-foreground hover:bg-muted/40',
                  savingCategory && 'opacity-50 cursor-wait',
                )}
                title={
                  projectCategory
                    ? categoryName(projectCategory)
                    : t('adminProjectSetupPage.setCategory')
                }
              >
                {savingCategory && <Loader2 className="h-3 w-3 animate-spin" />}
                <span className="tabular-nums font-semibold">{projectCategory ?? '—'}</span>
                <span className="opacity-70 truncate max-w-[140px]">
                  {projectCategory ? categoryName(projectCategory) : t('adminProjectSetupPage.category')}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-label text-muted-foreground">
                {t('adminProjectSetupPage.projectCategory')}
              </DropdownMenuLabel>
              {PROJECT_CATEGORY_CODES.map((code) => {
                const def = PROJECT_CATEGORIES[code];
                const active = projectCategory === code;
                return (
                  <DropdownMenuItem
                    key={code}
                    onClick={async () => {
                      if (active || savingCategory) return;
                      setSavingCategory(true);
                      try {
                        await apiFetch(`/projects/${id}`, {
                          method: 'PUT',
                          data: { category: code },
                        });
                        setProjectCategory(code);
                        flash(
                          'success',
                          t('adminProjectSetupPage.categorySaved', { name: def.name_mn }),
                        );
                      } catch (e) {
                        flash('error', e instanceof Error ? e.message : t('common.error'));
                      } finally {
                        setSavingCategory(false);
                      }
                    }}
                    className="flex items-center gap-2"
                  >
                    <Badge variant="outline" className="text-micro font-mono font-bold px-1.5">
                      {def.code}
                    </Badge>
                    <span className="text-xs flex-1 truncate">{def.name_mn}</span>
                    <span className="text-micro tabular-nums text-muted-foreground">
                      {t('adminProjectSetupPage.teamsCount', { count: def.teamCodes.length })}
                    </span>
                    {active && <Check className="h-3 w-3 text-primary" />}
                  </DropdownMenuItem>
                );
              })}
              {projectCategory && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={async () => {
                      if (savingCategory) return;
                      setSavingCategory(true);
                      try {
                        await apiFetch(`/projects/${id}`, {
                          method: 'PUT',
                          data: { category: null },
                        });
                        setProjectCategory(null);
                        flash('success', t('adminProjectSetupPage.categoryRemoved'));
                      } catch (e) {
                        flash('error', e instanceof Error ? e.message : t('common.error'));
                      } finally {
                        setSavingCategory(false);
                      }
                    }}
                    className="text-xs text-muted-foreground"
                  >
                    {t('adminProjectSetupPage.removeCategory')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* «Бүтэц татах» — хуудасны толгойд БАЙНГА байна.  Хоосон төслийн
              ГОЛ үйлдэл нь `SetupCompletionHero` дотор давхар гардаг ч,
              бүтэцтэй болсны дараа ч (жишээ нь өөр багийн блокуудыг нэмж
              татах) хэрэгтэй хэвээр. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => onCopyOpenChange(true)}
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            {t('copyStructure.openButton')}
          </Button>
          <KeyboardShortcutsHelp
            shortcuts={[
              { keys: 'Ctrl + S', description: t('common.save') },
              { keys: 'Ctrl + B', description: t('adminProjectSetupPage.shortcutNewBlock') },
              { keys: 'Ctrl + D', description: t('adminProjectSetupPage.shortcutNewDrawing') },
              { keys: 'Enter', description: t('adminProjectSetupPage.shortcutAddNextTask') },
              { keys: 'Ctrl + Backspace', description: t('adminProjectSetupPage.shortcutDeleteTask') },
              { keys: '?', description: t('adminProjectSetupPage.shortcutOpenHelp') },
            ]}
          />
          <HelpDrawer />
        </div>
      </div>

      {/* Inline error banner — error-only after the success path moved to
          toast.  Errors stay sticky longer so the admin doesn't lose the
          message while scrolling. */}
      {banner && banner.kind === 'error' && (
        <div
          role="alert"
          className="rounded-lg border px-4 py-3 text-sm flex items-center gap-2 animate-in fade-in slide-in-from-top-1 border-destructive/30 bg-destructive/10 text-destructive"
        >
          <AlertCircle className="h-4 w-4" />
          <span>{banner.text}</span>
        </div>
      )}

      {/* SetupCompletionHero — the new "energy meter" for project setup
          replaces the old RollupSummary.  Inline mismatch list with
          one-click jump targets. */}
      <SetupCompletionHero
        projectName={projectName}
        inputs={{
          blockSum: summary.blockSum,
          blocksCount: blocks.length,
          drawingsCount: drawings.length,
          componentsCount: components.length,
          tasksCount: tasks.length,
          mismatches: summary.mismatches,
        }}
        onAutoFixZero={fixAllZeroSums}
        onJumpToMismatch={jumpToMismatch}
        onImportStructure={() => onCopyOpenChange(true)}
      />

      {/* Бүтэц татах — өөр төслөөс блок/зураг/эд анги/ажлыг ЖИНТЭЙГЭЭ ХАМТ
          хуулна.  Хариуцагч, огноог ХЭЗЭЭ Ч хуулахгүй (эзний шийдвэр). */}
      <CopyStructureSheet
        open={copyOpen}
        onOpenChange={onCopyOpenChange}
        targetProjectId={Number(id)}
        targetProjectName={projectName}
        targetShifr={passportQuery.data?.passport?.drawing_no ?? null}
        initialSourceId={copyFromId}
        hasExistingStructure={blocks.length > 0}
        onCopied={handleCopied}
      />

      {/* Blocks list */}
      <div className="space-y-4">
        <TeamTabNavigator {...setup} />

        <BlockList {...setup} />
      </div>

      {/* StickySaveBar — viewport-pinned save button.  Only visible when
          there are unsaved changes (or saving / errored), so admins on a
          clean project don't see a permanent UI strip. */}
      <StickySaveBar
        dirtyCount={dirtyCount}
        saving={saving}
        errorText={banner?.kind === 'error' ? banner.text : null}
        onSave={saveAll}
        onDiscard={() => loadAll()}
      />
    </div>
  );
}
