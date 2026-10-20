import { useState } from 'react';
import { AlertCircle, ClipboardList, Loader2, Plus } from 'lucide-react';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { useLanguage } from '@/shared/i18n';
import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import NonProjectWorkForm from './NonProjectWorkForm';
import NonProjectEntryItem from './NonProjectEntryItem';
import { suggestedStart } from './lib';
import {
  NON_PROJECT_MY_KEY,
  useCanLogNonProjectWork,
  useNonProjectWorkActions,
} from './useNonProjectWork';
import type { NonProjectEntry, NonProjectWorkMine } from './types';

/**
 * «Миний ажлууд» хуудасны «Төслийн бус ажил» хэсэг (миграц 0342).
 *
 * «Миний засвар»-ын (`RepairSection`) бүтцийг дагасан ч ТУСДАА карт, өөр
 * дүрс/өнгөтэй — засвар ба төслийн бус ажил нүдээр ялгагдах ёстой (эзний
 * шаардлага).  Засвар нь цаг → оноо (шууд), харин энэ нь цаг + «юу хийсэн»
 * тайлбар → админы шалгалт.
 *
 * Ирцэд сонгосон ажил энд «Бөглөөгүй» мөр болж ирнэ (эзний дүрэм 2026-09-28 —
 * ирцийн сонголт зөвхөн хяналт).  Ажилтан ажлаа дуусгасны дараа «Дуусгаж
 * бүртгэх»-ээр цаг + «юу хийсэн»-ээ оруулахад л шалгуулахаар илгээгдэж, админ
 * баталсны дараа хувь бодогдоно.  Эхэлсэн цаг нь ирцэд сонгосон цагаар
 * урьдчилан бөглөгдөнө (`suggestedStart`).
 *
 * Бүртгэх эрхгүй ролид (админ г.м.) хэсэг огт гарахгүй — сервер 403 өгнө.
 */
export default function NonProjectWorkSection() {
  const { t } = useLanguage();
  const canLog = useCanLogNonProjectWork();
  const actions = useNonProjectWorkActions();
  const query = useApiQuery<NonProjectWorkMine>([...NON_PROJECT_MY_KEY], '/non-project-work/my', {
    enabled: canLog,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<NonProjectEntry | null>(null);

  if (!canLog) return null;

  const data = query.data;
  const items = data?.items ?? [];
  const meta = data
    ? {
        categories: data.categories,
        lunch: data.lunch,
        shift_end: data.shift_end,
        shift_start: data.shift_start,
      }
    : null;
  /** Ирцэд сонгосон, цаг/тайлбар оруулаагүй мөрийг «дуусгах» уу, бөглөсөн мөрийг засах уу. */
  const completing = editing?.stage === 'needs_report';
  const missing = items.filter((e) => e.stage === 'needs_report').length;

  return (
    <Card className="border-border bg-card/60 backdrop-blur overflow-hidden" data-testid="npw-section">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <ClipboardList className="h-4 w-4 shrink-0 text-info" />
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                {t('nonProjectWork.title')}
                {missing > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-micro font-medium text-warning">
                    <AlertCircle className="h-3 w-3" />
                    {t('nonProjectWork.missingReports', { count: missing })}
                  </span>
                )}
              </h2>
              <p className="text-xs text-muted-foreground">{t('nonProjectWork.sectionHint')}</p>
            </div>
          </div>
          <Button
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => setCreateOpen(true)}
            disabled={!meta}
            data-testid="npw-add"
          >
            <Plus className="h-4 w-4" />
            {t('nonProjectWork.addButton')}
          </Button>
        </div>

        {query.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-info" />
          </div>
        ) : query.isError ? (
          <p className="py-6 text-center text-sm text-danger">{query.error.message}</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('nonProjectWork.empty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/60">
            {items.map((e) => (
              <NonProjectEntryItem key={e.id} entry={e} showDate onEdit={setEditing} />
            ))}
          </ul>
        )}
      </CardContent>

      {meta && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('nonProjectWork.createTitle')}</DialogTitle>
              <DialogDescription>{t('nonProjectWork.createDescription')}</DialogDescription>
            </DialogHeader>
            {/* `key` — цонх нээгдэх бүрд маягт шинээр эхэлнэ. */}
            <NonProjectWorkForm
              key={createOpen ? 'open' : 'closed'}
              meta={meta}
              submitLabel={t('nonProjectWork.submit')}
              onCancel={() => setCreateOpen(false)}
              onSubmit={async (values) => {
                await actions.create(values);
                toast.success(t('nonProjectWork.created'));
                setCreateOpen(false);
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      {meta && (
        <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {t(completing ? 'nonProjectWork.completeTitle' : 'nonProjectWork.editTitle')}
              </DialogTitle>
              <DialogDescription>
                {t(completing ? 'nonProjectWork.completeDescription' : 'nonProjectWork.editDescription')}
              </DialogDescription>
            </DialogHeader>
            {editing && (
              <NonProjectWorkForm
                key={editing.id}
                meta={meta}
                initial={{
                  category: editing.category,
                  note: editing.note ?? '',
                  start_time: suggestedStart(editing, meta),
                  end_time: editing.end_time ?? '',
                  report: editing.report ?? '',
                }}
                submitLabel={t(completing ? 'nonProjectWork.submit' : 'nonProjectWork.save')}
                onCancel={() => setEditing(null)}
                onSubmit={async (values) => {
                  await actions.update(editing.id, values);
                  toast.success(t(completing ? 'nonProjectWork.submitted' : 'nonProjectWork.updated'));
                  setEditing(null);
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
