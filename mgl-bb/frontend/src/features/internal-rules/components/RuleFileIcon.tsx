import { FileArchive, FileImage, FileSpreadsheet, FileText } from 'lucide-react';

import { ruleFileExt } from '../lib/ruleFiles';

/** Хавсралтын жагсаалтын дүрс — өргөтгөлөөр. */
export function RuleFileIcon({ name, className }: { name: string; className?: string }) {
  const ext = ruleFileExt(name);
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return <FileImage className={className} aria-hidden />;
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return <FileSpreadsheet className={className} aria-hidden />;
  if (ext === 'zip') return <FileArchive className={className} aria-hidden />;
  return <FileText className={className} aria-hidden />;
}
