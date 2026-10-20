import { useLanguage } from '@/shared/i18n';
import { useAsrCompanionCandidates } from './api';
import { AsrCompanionPhoto } from './AsrCompanionPhoto';
import { AsrRedBookBadge } from './AsrStatusBadge';
import { isAsrPersisted, redBookStatusOf, type AsrFormState, type AsrReport } from './types';
import type { AsrChange } from './AsrEditor';

/** Өөрийн багаас хамт явсан хүмүүс + хүн бүрийн улаан дэвтэр. */
export function AsrCompanionsSection({
  entry,
  form,
  onChange,
  readOnly,
  currentUserId,
  isAdmin,
  canReview,
  onServerChanged,
}: {
  entry: AsrReport;
  form: AsrFormState;
  onChange: AsrChange;
  readOnly: boolean;
  currentUserId: number | null;
  isAdmin: boolean;
  canReview: boolean;
  onServerChanged?: (id: number) => void;
}) {
  const { t } = useLanguage();
  const persisted = isAsrPersisted(entry);
  const candidates = useAsrCompanionCandidates(persisted ? entry.id : null, true);
  const saved = new Map((entry.companions ?? []).map((c) => [c.user_id, c]));
  const names = new Map((candidates.data?.users ?? []).map((u) => [u.id, u.full_name]));
  const picked = new Set(form.companion_user_ids);

  const toggle = (id: number) => {
    if (!picked.has(id) && form.companion_user_ids.length >= 8) return;
    const next = picked.has(id)
      ? form.companion_user_ids.filter((x) => x !== id)
      : [...form.companion_user_ids, id];
    onChange({ companion_user_ids: next });
  };

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          {(candidates.data?.users ?? []).map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => toggle(u.id)}
              className={
                picked.has(u.id)
                  ? 'rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs'
                  : 'rounded-full border px-2.5 py-1 text-xs text-muted-foreground'
              }
            >
              {u.full_name}
            </button>
          ))}
          {(candidates.data?.users ?? []).length === 0 && (
            <span className="text-xs text-muted-foreground">{t('asr.companionsEmpty')}</span>
          )}
        </div>
      )}
      {form.companion_user_ids.map((id) => {
        const row = saved.get(id);
        return (
          <div key={id} className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{row?.full_name ?? names.get(id) ?? id}</span>
              {row && <AsrRedBookBadge status={redBookStatusOf(row)} />}
            </div>
            {row && persisted ? (
              <AsrCompanionPhoto
                entry={entry}
                userId={id}
                photoUrl={row.red_book_photo_url ?? null}
                verified={!!row.red_book_verified_at}
                canAttach={isAdmin || entry.author_id === currentUserId || currentUserId === id}
                canReview={canReview}
                onChanged={onServerChanged}
              />
            ) : (
              <p className="text-xs text-muted-foreground">{t('asr.companionsSaveFirst')}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
