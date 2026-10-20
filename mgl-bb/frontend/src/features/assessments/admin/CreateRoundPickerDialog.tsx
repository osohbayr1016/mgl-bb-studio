import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import type { AssessmentTemplateSummary } from '../types';

export function CreateRoundPickerDialog({
  open,
  templates,
  templateId,
  onOpenChange,
  onTemplateIdChange,
  onContinue,
}: {
  open: boolean;
  templates: AssessmentTemplateSummary[];
  templateId: string;
  onOpenChange: (open: boolean) => void;
  onTemplateIdChange: (id: string) => void;
  onContinue: () => void;
}) {
  const { t } = useLanguage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('assessments.newRound')}</DialogTitle>
          <DialogDescription>{t('assessments.pickTemplateHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="round-template">{t('assessments.fieldTemplate')}</Label>
          <Select value={templateId} onValueChange={onTemplateIdChange}>
            <SelectTrigger id="round-template">
              <SelectValue placeholder={t('assessments.fieldTemplate')} />
            </SelectTrigger>
            <SelectContent>
              {templates.map((template) => (
                <SelectItem key={template.id} value={String(template.id)}>
                  {template.title_mn}
                  {template.team_codes.length ? ` · ${template.team_codes.join(', ')}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('assessments.cancel')}
          </Button>
          <Button onClick={onContinue} disabled={!templateId}>
            {t('assessments.continueToEditor')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
