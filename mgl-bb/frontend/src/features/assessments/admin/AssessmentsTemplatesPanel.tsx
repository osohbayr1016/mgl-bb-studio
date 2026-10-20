import { FileText, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { EmptyState } from '@/shared/components/EmptyState';
import { formatDate } from '@/shared/lib/time';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import type { AssessmentTemplateSummary } from '../types';

export function AssessmentsTemplatesPanel({
  templates,
  loading,
  creating,
  onNewTemplate,
  onImportDocx,
  onOpenTemplate,
  onDelete,
}: {
  templates: AssessmentTemplateSummary[];
  loading: boolean;
  creating: boolean;
  onNewTemplate: () => void;
  onImportDocx: () => void;
  onOpenTemplate: (id: number) => void;
  onDelete: (id: number, name: string) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-muted-foreground">{t('assessments.templatesHint')}</p>
        <div className="flex gap-2">
          <Button size="sm" disabled={creating} onClick={onNewTemplate}>
            {creating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            {t('assessments.newTemplate')}
          </Button>
          <Button size="sm" variant="outline" onClick={onImportDocx}>
            <Upload className="size-4" aria-hidden />
            {t('assessments.importDocx')}
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden />
        </div>
      ) : !templates.length ? (
        <EmptyState
          icon={FileText}
          title={t('assessments.noTemplates')}
          description={t('assessments.noTemplatesHint')}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('assessments.colCode')}</TableHead>
                    <TableHead>{t('assessments.colTemplateTitle')}</TableHead>
                    <TableHead>{t('assessments.colTeams')}</TableHead>
                    <TableHead className="text-right">{t('assessments.colSections')}</TableHead>
                    <TableHead className="text-right">{t('assessments.colItems')}</TableHead>
                    <TableHead>{t('assessments.colStatus')}</TableHead>
                    <TableHead>{t('assessments.colUpdated')}</TableHead>
                    <TableHead className="text-right">{t('assessments.colActions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((template) => (
                    <TableRow
                      key={template.id}
                      className="cursor-pointer"
                      onClick={() => onOpenTemplate(template.id)}
                    >
                      <TableCell className="font-mono text-micro">{template.code}</TableCell>
                      <TableCell className="font-medium">{template.title_mn}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {template.team_codes.length ? template.team_codes.join(', ') : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {template.section_count}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {template.item_count}
                      </TableCell>
                      <TableCell>
                        <Badge variant={template.status === 'active' ? 'default' : 'outline'}>
                          {template.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(template.updated_at)}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('assessments.deleteTemplate')}
                          onClick={() => onDelete(template.id, template.title_mn)}
                        >
                          <Trash2 className="size-4 text-destructive" aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
