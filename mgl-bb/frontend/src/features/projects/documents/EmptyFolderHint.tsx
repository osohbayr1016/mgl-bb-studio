import { FolderOpen } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { folderHint } from './template';

export function EmptyFolderHint({
  code,
  isEmpty,
}: {
  code: string | null | undefined;
  isEmpty: boolean;
}) {
  const { t, lang } = useLanguage();
  if (!isEmpty) return null;
  const hint = folderHint(code, lang);
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <FolderOpen className="h-6 w-6" />
      </span>
      <p className="text-sm font-medium text-foreground">{t('documentsPage.emptyFolder')}</p>
      {hint ? <p className="max-w-md text-sm text-muted-foreground">{hint}</p> : null}
      <p className="max-w-md text-xs text-muted-foreground">{t('documentsPage.dropHint')}</p>
    </div>
  );
}
