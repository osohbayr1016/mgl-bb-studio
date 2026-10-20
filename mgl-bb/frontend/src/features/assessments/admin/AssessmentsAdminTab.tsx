import { useAuth } from '@/shared/context/AuthContext';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { useLanguage } from '@/shared/i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';
import { DocxImportDialog } from './DocxImportDialog';
import { RenameRoundForm } from './RenameRoundForm';
import { AssessmentsRoundsPanel } from './AssessmentsRoundsPanel';
import { AssessmentsTemplatesPanel } from './AssessmentsTemplatesPanel';
import { CreateRoundPickerDialog } from './CreateRoundPickerDialog';
import { ASSESSMENTS_ADMIN_TABS, type AssessmentsAdminTabId } from './assessmentsAdminShared';
import { confirmDeleteNamed, confirmToggleRoundStatus } from './assessmentsAdminConfirms';
import { useAssessmentsAdmin } from './useAssessmentsAdmin';

export { USERS_ASSESSMENTS_TAB, ASSESSMENTS_ADMIN_TABS } from './assessmentsAdminShared';
export type { AssessmentsAdminTabId } from './assessmentsAdminShared';

export function AssessmentsAdminTab() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useTabParam(ASSESSMENTS_ADMIN_TABS, 'rounds', 'assessTab');
  const a = useAssessmentsAdmin(isAdmin, t);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('assessments.adminSubtitle')}</p>
      <Tabs value={tab} onValueChange={(v) => setTab(v as AssessmentsAdminTabId)}>
        <TabsList>
          <TabsTrigger value="rounds">{t('assessments.tabRounds')}</TabsTrigger>
          <TabsTrigger value="templates">{t('assessments.tabTemplates')}</TabsTrigger>
        </TabsList>
        <TabsContent value="rounds">
          <AssessmentsRoundsPanel
            rounds={a.rounds}
            loading={a.roundsLoading}
            statusPending={a.statusPending}
            canCreate={a.templates.length > 0}
            onNewRound={a.openPicker}
            onOpenRound={a.openRound}
            onRename={a.setRenameTarget}
            onToggleStatus={async (id, status) => {
              if (await confirmToggleRoundStatus(t, a.rounds, id, status)) {
                a.mutateStatus(id, status);
              }
            }}
            onDelete={async (id, name) => {
              if (await confirmDeleteNamed(t, 'assessments.roundDeleteConfirm', name)) {
                a.mutateDeleteRound(id);
              }
            }}
          />
        </TabsContent>
        <TabsContent value="templates">
          <AssessmentsTemplatesPanel
            templates={a.templates}
            loading={a.templatesLoading}
            creating={a.creatingTemplate}
            onNewTemplate={a.mutateNewTemplate}
            onImportDocx={() => a.setDocxOpen(true)}
            onOpenTemplate={a.openTemplate}
            onDelete={async (id, name) => {
              if (await confirmDeleteNamed(t, 'assessments.templateDeleteConfirm', name)) {
                a.mutateDeleteTemplate(id);
              }
            }}
          />
        </TabsContent>
      </Tabs>
      <CreateRoundPickerDialog
        open={a.pickOpen}
        templates={a.templates}
        templateId={a.pickTemplateId}
        onOpenChange={a.setPickOpen}
        onTemplateIdChange={a.setPickTemplateId}
        onContinue={a.goPublish}
      />
      <Dialog open={a.renameTarget !== null} onOpenChange={(v) => !v && a.setRenameTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('assessments.renameRoundTitle')}</DialogTitle>
            <DialogDescription>{t('assessments.renameRoundHint')}</DialogDescription>
          </DialogHeader>
          {a.renameTarget && (
            <RenameRoundForm
              key={a.renameTarget.id}
              round={a.renameTarget}
              pending={a.renamePending}
              onCancel={() => a.setRenameTarget(null)}
              onSubmit={(name, period) => a.mutateRename(a.renameTarget!.id, name, period)}
            />
          )}
        </DialogContent>
      </Dialog>
      <DocxImportDialog open={a.docxOpen} onOpenChange={a.setDocxOpen} />
    </div>
  );
}
