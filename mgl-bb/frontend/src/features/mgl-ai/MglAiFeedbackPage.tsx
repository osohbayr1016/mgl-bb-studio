import { useCallback, useEffect, useState } from 'react';
import { ThumbsUp, ThumbsDown, RefreshCw, Check, X, PenLine, Database } from 'lucide-react';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Card } from '@/ui/card';
import { Textarea } from '@/ui/textarea';
import { Input } from '@/ui/input';
import { apiFetch } from '@/shared/api/client';
import { useAuth } from '@/shared/context/AuthContext';

/**
 * MGL AI · САНАЛ ХҮСЭЛТИЙН ХЯНАЛТ (§31 «admin feedback review»).
 *
 * ⚠️ ЭНЭ ХУУДАС БАЙХГҮЙГЭЭС БОЛЖ САНАЛ ХҮСЭЛТ «АЛГА БОЛДОГ» МЭТ
 *    харагдаж байв (хэрэглэгч 2026-09-08-нд мэдэгдсэн): backend нь
 *    `/admin/feedback` -ийг бүрэн хэрэгжүүлсэн ч түүнийг харах UI
 *    БАЙГААГҮЙ.  Ажилтан 👎 дарж, тайлбар бичээд, тэр нь хаашаа ч
 *    хүрэхгүй мэт мэдрэгддэг байсан.
 *
 * ⚠️ ЭНЭ БОЛ СУРГАЛТЫН ХААЛГА.  §32: санал хүсэлт нь ШУУД сургалтын
 *    өгөгдөл БОЛОХГҮЙ.  Мөр бүр `pending` -ээс эхэлж, ЗӨВХӨН админаар
 *    дамжин `approved` болно.  Хорон санаат ажилтан 👎-аар загварыг
 *    хордуулах ЁСГҮЙ.
 *
 * ⚠️ 👎 нь ЗАЛРУУЛГАГҮЙГЭЭР батлагдахгүй — сервер 409 өгнө.  UI нь
 *    түүнийг УРЬДЧИЛАН хэлж, товчийг идэвхгүй болгоно (сервер л жинхэнэ
 *    хаалга; энэ нь зөвхөн тайлбар).
 */

type ReviewState =
  | 'pending'
  | 'reviewed'
  | 'approved'
  | 'rejected'
  | 'needs_correction'
  | 'included_in_dataset'
  | 'included_in_training_run';

interface FeedbackRow {
  id: number;
  conv_uid: string;
  msg_uid: string;
  user_id: number | null;
  full_name: string | null;
  user_mode: string;
  vote: number;
  reason_codes_json: string;
  reason_text: string | null;
  corrected_answer: string | null;
  prompt_snapshot: string | null;
  answer_snapshot: string | null;
  model_version: string | null;
  runtime_variant: string | null;
  review_state: ReviewState;
  dataset_version: string | null;
  created_at: string;
}

interface Payload {
  state: ReviewState;
  items: FeedbackRow[];
  counts: { review_state: string; n: number }[];
}

const STATE_LABEL: Record<ReviewState, string> = {
  pending: 'Хүлээгдэж буй',
  reviewed: 'Хянасан',
  approved: 'Батлагдсан',
  rejected: 'Татгалзсан',
  needs_correction: 'Засвар хэрэгтэй',
  included_in_dataset: 'Багцад орсон',
  included_in_training_run: 'Сургалтад орсон',
};

const REASON_LABEL: Record<string, string> = {
  incorrect: 'Буруу хариулсан',
  misunderstood: 'Асуултыг ойлгосонгүй',
  wrong_company_context: 'Компанийн мэдээлэл буруу',
  wrong_revit_context: 'Revit контекст буруу',
  wrong_regulation: 'Норм/дүрэм буруу',
  outdated: 'Хуучирсан мэдээлэл',
  hallucinated: 'Байхгүй зүйл зохиосон',
  too_long: 'Хэт урт',
  too_short: 'Хэт богино',
  slow: 'Удаан',
  unsafe_action: 'Аюултай үйлдэл',
  other: 'Бусад',
};

/** §32-ийн зөвшөөрөгдсөн шилжилтүүд — `lib/mglai/feedback.ts`-ийн ТОЛЬ. */
const NEXT: Record<ReviewState, ReviewState[]> = {
  pending: ['reviewed', 'rejected', 'needs_correction'],
  reviewed: ['approved', 'rejected', 'needs_correction'],
  needs_correction: ['reviewed', 'rejected'],
  approved: ['included_in_dataset', 'rejected'],
  included_in_dataset: ['included_in_training_run', 'rejected'],
  included_in_training_run: [],
  rejected: ['pending'],
};

const ORDER: ReviewState[] = [
  'pending',
  'needs_correction',
  'reviewed',
  'approved',
  'included_in_dataset',
  'included_in_training_run',
  'rejected',
];

function parseReasons(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export default function MglAiFeedbackPage() {
  const { user } = useAuth();
  const [state, setState] = useState<ReviewState>('pending');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [datasetVersion, setDatasetVersion] = useState('1.1.0');

  const load = useCallback(
    async (s: ReviewState) => {
      setLoading(true);
      setError(null);
      try {
        const r = await apiFetch<Payload>(`/mgl-ai/admin/feedback?state=${s}&limit=50`);
        setData(r);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(state);
  }, [state, load]);

  async function move(row: FeedbackRow, to: ReviewState) {
    setBusyId(row.id);
    try {
      const body: Record<string, unknown> = { to };
      const draft = drafts[row.id];
      if (draft && draft.trim().length > 0) body.corrected_answer = draft.trim();
      if (to === 'included_in_dataset') body.dataset_version = datasetVersion.trim();

      await apiFetch(`/mgl-ai/admin/feedback/${row.id}/state`, { method: 'POST', data: body });
      await load(state);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  // ⚠️ Frontend-ийн role шалгалт нь ЗӨВХӨН UX — жинхэнэ хаалга нь
  //    маршрутын `requireAdmin()`.
  if (user && user.role !== 'admin') {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card className="p-6 text-sm text-muted-foreground">
          Энэ хуудас зөвхөн админд нээлттэй.
        </Card>
      </div>
    );
  }

  const counts = new Map((data?.counts ?? []).map((c) => [c.review_state, c.n]));

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">MGL AI · Санал хүсэлт</h1>
          <p className="text-xs text-muted-foreground">
            Ажилтны 👍/👎 энд ирнэ. Батлагдсан жишээ Л сургалтын багцад орно — санал өөрөө
            загварыг ХЭЗЭЭ Ч шууд өөрчлөхгүй.
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => void load(state)}>
          <RefreshCw className="size-3.5" aria-hidden />
          Шинэчлэх
        </Button>
      </div>

      {/* Төлвийн шүүлтүүр */}
      <div className="flex flex-wrap gap-1.5">
        {ORDER.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={state === s ? 'default' : 'outline'}
            className="h-7 gap-1.5 text-xs"
            onClick={() => setState(s)}
          >
            {STATE_LABEL[s]}
            <Badge variant="secondary" className="px-1 text-[10px]">
              {counts.get(s) ?? 0}
            </Badge>
          </Button>
        ))}
      </div>

      {error && (
        <Card className="border-rose-500/40 p-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </Card>
      )}

      {loading && <p className="py-8 text-center text-sm text-muted-foreground">Уншиж байна…</p>}

      {!loading && (data?.items.length ?? 0) === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          «{STATE_LABEL[state]}» төлөвт мөр алга.
        </Card>
      )}

      <div className="space-y-3">
        {(data?.items ?? []).map((row) => {
          const reasons = parseReasons(row.reason_codes_json);
          const negative = row.vote === -1;
          const correction = drafts[row.id] ?? row.corrected_answer ?? '';
          // ⚠️ Серверийн дүрмийн ТОЛЬ: 👎 нь залруулгагүйгээр батлагдахгүй.
          const canApprove = !negative || correction.trim().length > 0;

          return (
            <Card key={row.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {negative ? (
                  <Badge
                    variant="outline"
                    className="gap-1 border-rose-500/40 text-rose-700 dark:text-rose-300"
                  >
                    <ThumbsDown className="size-3" aria-hidden /> Таалагдаагүй
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                  >
                    <ThumbsUp className="size-3" aria-hidden /> Таалагдсан
                  </Badge>
                )}
                <Badge variant="secondary">{STATE_LABEL[row.review_state]}</Badge>
                <span className="text-muted-foreground">
                  {row.full_name ?? (row.user_id ? `#${row.user_id}` : 'зочин')} · {row.user_mode} ·{' '}
                  {row.created_at}
                </span>
                {row.model_version && (
                  <span className="text-muted-foreground">
                    · {row.model_version}
                    {row.runtime_variant ? ` (${row.runtime_variant})` : ''}
                  </span>
                )}
                {row.dataset_version && (
                  <Badge variant="outline" className="gap-1">
                    <Database className="size-3" aria-hidden /> {row.dataset_version}
                  </Badge>
                )}
              </div>

              {reasons.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {reasons.map((r) => (
                    <Badge key={r} variant="outline" className="text-[11px] font-normal">
                      {REASON_LABEL[r] ?? r}
                    </Badge>
                  ))}
                </div>
              )}

              {row.reason_text && (
                <p className="rounded bg-muted/50 p-2 text-sm">{row.reason_text}</p>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">АСУУЛТ</p>
                  <p className="whitespace-pre-wrap rounded bg-muted/40 p-2 text-sm">
                    {row.prompt_snapshot ?? '(хадгалагдаагүй)'}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">AI-ИЙН ХАРИУ</p>
                  <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-sm">
                    {row.answer_snapshot ?? '(хадгалагдаагүй)'}
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <PenLine className="size-3" aria-hidden />
                  ЗӨВ ХАРИУ {negative && <span className="text-rose-500">— батлахад ЗААВАЛ</span>}
                </p>
                <Textarea
                  rows={3}
                  value={correction}
                  placeholder={
                    negative
                      ? 'Загвар юу гэж хариулах ёстой байсныг бич — энэ нь сургалтын зорилтот гаралт болно.'
                      : 'Заавал биш.'
                  }
                  onChange={(e) => setDrafts((p) => ({ ...p, [row.id]: e.target.value }))}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {NEXT[row.review_state].map((to) => {
                  const blocked = to === 'approved' && !canApprove;
                  const isReject = to === 'rejected';
                  return (
                    <Button
                      key={to}
                      size="sm"
                      variant={to === 'approved' ? 'default' : isReject ? 'ghost' : 'outline'}
                      className="h-7 gap-1 text-xs"
                      disabled={busyId === row.id || blocked}
                      title={
                        blocked
                          ? '👎 санал нь залруулсан хариугүйгээр батлагдахгүй (§32)'
                          : undefined
                      }
                      onClick={() => void move(row, to)}
                    >
                      {to === 'approved' && <Check className="size-3" aria-hidden />}
                      {isReject && <X className="size-3" aria-hidden />}
                      {STATE_LABEL[to]}
                    </Button>
                  );
                })}

                {row.review_state === 'approved' && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    багцын хувилбар
                    <Input
                      value={datasetVersion}
                      onChange={(e) => setDatasetVersion(e.target.value)}
                      className="h-7 w-24 text-xs"
                    />
                  </span>
                )}

                {NEXT[row.review_state].length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    Эцсийн төлөв — сургалтад орсон мөрийг буцаахгүй.
                  </span>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
