import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Loader2, Maximize2, Minimize2, Sparkles, Wand2 } from 'lucide-react';
import { apiFetch } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useLocalDraft } from '@/shared/hooks/useLocalDraft';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Textarea } from '@/ui/textarea';

/**
 * Хурлын ЭЦСИЙН текст — транскриптийн дараа хүн бүхэлд нь уншиж, засаад
 * хадгалдаг том засварлагч (`PUT /meetings/:id/final-text`).
 *
 * Гурван эх сурвалж нэг текст рүү нийлдэг (AsrRecorder-ийн RecordingRow-той
 * ижил дүрэм): сервер дээрх `final_text` · localStorage дахь ХАДГАЛАГДААГҮЙ
 * ноорог · яг одоо бичигдэж буй утга.  Хүний сүүлд бичсэн үг сервер дээрх
 * хуучин хувилбарт хэзээ ч дарагдахгүй.
 *
 * Транскрипт (Speechmatics-ийн түүхий гаралт) ХӨНДӨГДӨХГҮЙ — «Транскриптээс
 * эхлүүлэх» нь зөвхөн засварлагчийг урьдчилан бөглөнө; эцсийн текст хоосон,
 * ноорог хоосон, транскрипт бэлэн байвал автоматаар бөглөнө (хадгалахгүй).
 */
const draftKey = (meetingId: number) => `mgl:meeting-final-draft:${meetingId}`;

export function FinalTextEditor({
  meetingId,
  finalText,
  updatedAt,
  updatedByName,
  transcriptText,
  transcribing,
}: {
  meetingId: number;
  finalText: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  transcriptText: string | null;
  transcribing: boolean;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const serverText = finalText ?? '';
  const { saved: localDraft, persist, clear } = useLocalDraft<string>(draftKey(meetingId));

  const [draft, setDraft] = useState<string>(() =>
    localDraft != null && localDraft !== serverText ? localDraft : serverText,
  );
  const [fullscreen, setFullscreen] = useState(false);
  const dirty = draft !== serverText;

  // Сервер дээрх утга өөрчлөгдөхөд (өөр таб дээр хадгалсан / хуудас дахин
  // ачаалсан) — зөвхөн ноорог цэвэрхэн байхад л дагана.
  const syncedRef = useRef(serverText);
  useEffect(() => {
    if (serverText === syncedRef.current) return;
    const prev = syncedRef.current;
    syncedRef.current = serverText;
    setDraft((d) => (d === prev ? serverText : d));
  }, [serverText]);

  // Транскрипт ирж, эцсийн текст ч, ноорог ч хоосон бол урьдчилан бөглөнө.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || !transcriptText?.trim()) return;
    if (serverText.trim() || draft.trim()) return;
    prefilledRef.current = true;
    setDraft(transcriptText);
    persist(transcriptText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptText, serverText]);

  const save = useMutation({
    mutationFn: (text: string) =>
      apiFetch<{ ok: true; final_text: string | null }>(`/meetings/${meetingId}/final-text`, {
        method: 'PUT',
        data: { text },
      }),
    onSuccess: (_res, text) => {
      clear();
      syncedRef.current = text;
      qc.invalidateQueries({ queryKey: ['meeting', meetingId] });
      qc.invalidateQueries({ queryKey: ['meetings'] });
      toast.success(t('common.saved'));
    },
    onError: () => toast.error(t('common.saveFailed')),
  });

  const onChange = (v: string) => {
    setDraft(v);
    persist(v);
  };

  const doSave = useCallback(() => {
    if (save.isPending) return;
    save.mutate(draft);
  }, [draft, save]);

  // Ctrl/⌘+S → хадгална (том текст дээр товч хайх хэрэггүй).
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (dirty) doSave();
    }
    if (e.key === 'Escape' && fullscreen) setFullscreen(false);
  };

  const useTranscript = () => {
    if (!transcriptText) return;
    onChange(transcriptText);
  };

  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  return (
    <Card
      data-testid="meeting-final-text-card"
      className={cn(fullscreen && 'fixed inset-0 z-50 flex flex-col rounded-none border-0 overflow-hidden')}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" /> {t('meetingNotes.finalTextTitle')}
          {dirty && (
            <span className="text-xs font-normal text-warning" data-testid="meeting-final-text-dirty">
              · {t('meetingNotes.unsaved')}
            </span>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
          {transcriptText && (
            <Button type="button" size="sm" variant="ghost" onClick={useTranscript} title={t('meetingNotes.useTranscriptHint')}>
              <Wand2 className="h-4 w-4 mr-2" /> {t('meetingNotes.useTranscript')}
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => setFullscreen((f) => !f)} title={t('meetingNotes.fullscreen')}>
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button type="button" size="sm" onClick={doSave} disabled={!dirty || save.isPending} data-testid="meeting-final-text-save">
            {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
            {t('common.save')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className={cn('space-y-2', fullscreen && 'flex-1 flex flex-col min-h-0')}>
        {!draft.trim() && transcribing && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> {t('meetingNotes.finalTextWaiting')}
          </p>
        )}
        <Textarea
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('meetingNotes.finalTextPlaceholder')}
          spellCheck={false}
          data-testid="meeting-final-text"
          className={cn(
            'w-full resize-y font-sans text-sm leading-relaxed',
            fullscreen ? 'flex-1 min-h-0 resize-none' : 'min-h-[55vh]',
          )}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {t('meetingNotes.wordCount', { words, chars: draft.length })}
          </span>
          {updatedAt && (
            <span>
              {t('meetingNotes.lastSaved', { when: updatedAt })}
              {updatedByName ? ` · ${updatedByName}` : ''}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
