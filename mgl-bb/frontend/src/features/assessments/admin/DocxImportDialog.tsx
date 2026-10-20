/**
 * Word (.docx) файлаас асуулга үүсгэх — чирж хаях импортын диалог.
 *
 * Урсгал:  файл чирэх → `parseDocx` → `paragraphsToDraft` → таних статистик →
 *          «Үргэлжлүүлэх» → сервер дээр `status='draft'` template үүсч,
 *          БҮТЭН ДЭЛГЭЦИЙН засварлагч руу шилжинэ.
 *
 * ⚠️ Эндээс ШУУД ХЭРЭГЛЭЭНД ГАРАХ зам БАЙХГҮЙ.  Эвристик таних 100% байх
 *    боломжгүй тул үүсэх template нь `draft` төлөвтэй бөгөөд админ
 *    засварлагч дээр нүдээр шалгаж, «Багтаа илгээх» дарж гэмээнэ ажилтанд
 *    хүрнэ (docs/dev/assessments-spec.md §8).
 *
 * Word дээр 2 судалгаа (ур чадвар / зан чанар) байсан бололтой бол
 * `paragraphsToDraft` САНАЛ буцаана — түүнийг router-ийн `state`-ээр
 * засварлагч руу дамжуулж, тэнд админаас асууна.
 */

import { useCallback, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Upload } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';

import { assessmentKeys } from '../api';
import { createDraftTemplate } from '../lib/createDraftTemplate';
import { DocxParseError, parseDocx } from '../lib/docxParse';
import { draftStats, paragraphsToDraft } from '../lib/schemaDraft';
import type { DraftStats, PartSplitProposal, SchemaDraft } from '../lib/schemaDraft';

export interface DocxImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function isDocx(file: File): boolean {
  return file.name.toLowerCase().endsWith('.docx') || file.type === DOCX_MIME;
}

export function DocxImportDialog({ open, onOpenChange }: DocxImportDialogProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [draft, setDraft] = useState<SchemaDraft | null>(null);
  const [split, setSplit] = useState<PartSplitProposal | null>(null);
  const [stats, setStats] = useState<DraftStats | null>(null);

  const reset = () => {
    setDragging(false);
    setBusy(false);
    setCreating(false);
    setError(null);
    setFileName(null);
    setDraft(null);
    setSplit(null);
    setStats(null);
  };

  const handleFile = useCallback(
    async (file: File) => {
      if (!isDocx(file)) {
        setError(t('assessments.import.wrongType'));
        return;
      }
      setBusy(true);
      setError(null);
      setFileName(file.name);
      try {
        const paragraphs = await parseDocx(file);
        const result = paragraphsToDraft(paragraphs);
        const next = result.draft;
        // Гарчиг баримтаас олдоогүй бол файлын нэрийг санал болгоно (админ засна).
        const base = file.name.replace(/\.docx$/i, '').trim();
        if (!next.titleMn.trim()) next.titleMn = base;
        next.code = base
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 48);
        setDraft(next);
        setSplit(result.split);
        setStats(draftStats(next));
      } catch (err) {
        setDraft(null);
        setSplit(null);
        setStats(null);
        if (err instanceof DocxParseError) {
          setError(t(`assessments.import.error_${err.code.replace(/-/g, '_')}`));
        } else {
          setError(t('assessments.import.error_unknown'));
        }
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files.item(0);
    if (file) void handleFile(file);
  };

  const handleContinue = async () => {
    if (!draft) return;
    setCreating(true);
    setError(null);
    try {
      const template = await createDraftTemplate(draft);
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.templates });
      const wasSplit = split;
      reset();
      onOpenChange(false);
      navigate(`/app/admin/assessments/templates/${template.id}`, {
        state: wasSplit ? { split: wasSplit } : null,
      });
    } catch {
      setCreating(false);
      setError(t('assessments.import.error_create'));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('assessments.import.title')}</DialogTitle>
          <DialogDescription>{t('assessments.import.description')}</DialogDescription>
        </DialogHeader>

        <div
          role="button"
          tabIndex={0}
          aria-label={t('assessments.import.choose')}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors',
            dragging
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-input text-muted-foreground hover:bg-accent/40',
          )}
        >
          {busy ? (
            <>
              <Loader2 className="size-7 animate-spin" />
              <p className="text-sm">{t('assessments.import.parsing')}</p>
            </>
          ) : (
            <>
              <Upload className="size-7" />
              <p className="text-sm font-medium">{t('assessments.import.dropzone')}</p>
              <p className="text-xs">{t('assessments.import.dropzoneHint')}</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.item(0);
              // Ижил файлыг дахин сонгоход `change` асахын тулд утгыг цэвэрлэнэ.
              e.target.value = '';
              if (file) void handleFile(file);
            }}
          />
        </div>

        {error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {stats && !busy && (
          <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <FileText className="size-4" />
              <span className="truncate">{fileName}</span>
            </p>
            <p className="text-muted-foreground">
              {t('assessments.import.stats', {
                sections: stats.sections,
                groups: stats.groups,
                items: stats.items,
                unclassified: stats.unclassified,
              })}
            </p>
            {stats.intro > 0 && (
              <p className="text-muted-foreground">
                {t('assessments.import.introFound', { count: stats.intro })}
              </p>
            )}
            {split && (
              <p className="text-muted-foreground">
                {t('assessments.import.splitFound', {
                  count: split.parts.filter((p) => p.itemCount > 0).length,
                })}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t('assessments.import.reviewHint')}</p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            {t('assessments.import.cancel')}
          </Button>
          <Button disabled={!draft || busy || creating} onClick={() => void handleContinue()}>
            {creating && <Loader2 className="animate-spin" />}
            {t('assessments.import.continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
