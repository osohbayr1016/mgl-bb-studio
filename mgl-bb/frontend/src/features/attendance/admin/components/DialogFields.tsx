import { useLanguage } from '@/shared/i18n';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { Checkbox } from '@/ui/checkbox';

/** «Тэмдэглэл (сонголтоор)» талбар — цаг засах бүх диалогт нийтлэг. */
export function OptionalNoteField({
  rows,
  placeholder,
  value,
  onChange,
}: {
  rows: number;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {t('attendanceAdminPage.note')}{' '}
        <span className="text-muted-foreground">({t('common.optional')})</span>
      </Label>
      <Textarea
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** «Дараагийн өдөр» тэмдэглэгээ — шөнө дөл өнгөрч тарсан бүртгэлд. */
export function NextDayCheckbox({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <label htmlFor={id} className="cursor-pointer select-none text-xs text-muted-foreground">
        {t('attendanceAdminPage.fixNextDay')}
      </label>
    </div>
  );
}
