import { useMemo } from 'react';
import { ClipboardList, CheckCircle2, CircleDashed, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { PolishableTextarea } from '@/ui/PolishableTextarea';
import { Label } from '@/ui/label';
import { Progress } from '@/ui/progress';
import { useApiQuery } from '@/shared/api/useApi';
import { cn } from '@/shared/lib/utils';
import {
  TEAM_REPORT_STATUS_QUESTIONS,
  statusFieldKey,
} from '@/features/projects/team-reports/status-questions';

/* =============================================================
 * Universal "Тайлангийн товч асуумж" block.
 * -------------------------------------------------------------
 * Mounted by TeamReportShell above every team's discipline-
 * specific accordion form, so each team's Тайлбар бичиг starts
 * with the same five status questions regardless of discipline.
 *
 * Reads/writes a flat `status_q1`…`status_q5` namespace inside
 * the team's free-form `answers_json` — the typed per-team
 * answers shapes (e.g. BaReportAnswers) don't declare these
 * keys, so the shell hands us a loose accessor pair instead of
 * the generic `A` it uses for the rest of the form.
 *
 * Each question also shows up to three click-to-insert "sentence
 * starter" chips, configured per team via
 * `/api/status-starters/:teamCode` (managed from TeamDetailPage).
 * Clicking a chip inserts the starter at the textarea's caret
 * (or appends to the end if the textarea isn't focused).
 * ============================================================= */

export interface StatusQuestionsPanelProps {
  /** Loose view of the team's saved answers; we only touch the
   *  five `status_q*` keys.  Whatever else lives here belongs to
   *  the discipline-specific form below. */
  answers: Record<string, unknown>;
  /** Patch is keyed by `status_q<n>`; the shell merges it into
   *  the full answers object.  We cast through Record<string,…>
   *  because the per-team typed shapes don't acknowledge these
   *  universal keys. */
  onChange: (patch: Record<string, string>) => void;
  /** Team code (e.g. 'BA'). Drives the starter-chips fetch so
   *  different disciplines can have differently-worded chips. */
  teamCode: string;
  readOnly?: boolean;
}

interface StartersResponse {
  entries: {
    team_code: string;
    question_id: string;
    starters: string[];
  }[];
}

export function StatusQuestionsPanel({
  answers,
  onChange,
  teamCode,
  readOnly = false,
}: StatusQuestionsPanelProps) {
  const filledCount = useMemo(() => {
    let n = 0;
    for (const q of TEAM_REPORT_STATUS_QUESTIONS) {
      const v = answers[statusFieldKey(q.id)];
      if (typeof v === 'string' && v.trim().length > 0) n += 1;
    }
    return n;
  }, [answers]);
  const total = TEAM_REPORT_STATUS_QUESTIONS.length;
  const pct = Math.round((filledCount / total) * 100);

  // Starters are a small, slow-changing per-team config.  Default
  // staleTime keeps it fresh enough; the admin editor invalidates
  // this same key on save to push updates to anyone with the form
  // open.
  const startersQuery = useApiQuery<StartersResponse>(
    ['/status-starters', teamCode] as const,
    `/status-starters/${teamCode}`,
    { enabled: !!teamCode },
  );

  const startersByQuestion = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of startersQuery.data?.entries ?? []) {
      m.set(e.question_id, e.starters);
    }
    return m;
  }, [startersQuery.data]);

  /** Insert `starter` into the textarea identified by `id`.
   *
   *  - If the textarea is focused with a selection: replace the
   *    selection with the starter and place the caret after it.
   *  - Otherwise: append the starter to the end, separated by a
   *    space (or a newline if the existing text ends with a
   *    full-stop).  An empty textarea is set directly to the
   *    starter so it lives at position 0 — exactly where a
   *    "sentence starter" wants to be.
   *
   *  We touch the DOM directly to read selection state because the
   *  controlled-value React pattern doesn't surface caret info, and
   *  using `document.getElementById` is consistent with how the
   *  Label htmlFor link already wires things up.
   */
  const insertStarter = (
    questionId: (typeof TEAM_REPORT_STATUS_QUESTIONS)[number]['id'],
    starter: string,
  ) => {
    if (readOnly) return;
    const fieldKey = statusFieldKey(questionId);
    const el = document.getElementById(`status-${questionId}`) as HTMLTextAreaElement | null;
    const current = typeof answers[fieldKey] === 'string' ? (answers[fieldKey] as string) : '';

    let next: string;
    let nextCaret: number;

    if (el && document.activeElement === el) {
      const start = el.selectionStart ?? current.length;
      const end = el.selectionEnd ?? current.length;
      next = current.slice(0, start) + starter + current.slice(end);
      nextCaret = start + starter.length;
    } else if (current.trim().length === 0) {
      next = starter;
      nextCaret = starter.length;
    } else {
      // Append: pick a joiner based on whether the existing text already
      // ends with sentence-ending punctuation — saves the user from
      // manually adding the separator.
      const trailing = current.trimEnd();
      const endsWithStop = /[.!?…]$/.test(trailing);
      const joiner = endsWithStop ? ' ' : '. ';
      next = trailing + joiner + starter;
      nextCaret = next.length;
    }

    onChange({ [fieldKey]: next });

    // Restore focus + caret on the next frame, after React has flushed
    // the controlled value back into the DOM node.
    requestAnimationFrame(() => {
      const fresh = document.getElementById(`status-${questionId}`) as HTMLTextAreaElement | null;
      if (!fresh) return;
      fresh.focus();
      try {
        fresh.setSelectionRange(nextCaret, nextCaret);
      } catch {
        /* setSelectionRange throws on unsupported types — safe to swallow */
      }
    });
  };

  return (
    <Card className="border-border/40 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            Тайлангийн товч асуумж
          </CardTitle>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {filledCount === total ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <CircleDashed className="w-3.5 h-3.5" />
            )}
            {filledCount} / {total} бөглөгдсөн
          </span>
        </div>
        <Progress value={pct} className="h-1 mt-2" />
        <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
          Энэ хэсэг нь бүх багт нийтлэг. Дискиплинаас үл хамаарч ижил асуултаар тайлагнадаг тул
          төслийн менежер цаг алдалгүй харьцуулж үзэх боломжтой.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {TEAM_REPORT_STATUS_QUESTIONS.map((q, idx) => {
          const fieldKey = statusFieldKey(q.id);
          const value = answers[fieldKey];
          const stringValue = typeof value === 'string' ? value : '';
          const starters = startersByQuestion.get(q.id) ?? [];
          return (
            <div key={q.id} className="space-y-1.5">
              <Label htmlFor={`status-${q.id}`} className="text-[13px] leading-snug font-medium">
                <span className="text-muted-foreground mr-1.5">{idx + 1}.</span>
                {q.text}
              </Label>
              {starters.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    <Sparkles className="w-3 h-3" />
                    Жишээ эхлэл
                  </span>
                  {starters.map((s, i) => (
                    <button
                      key={`${q.id}-starter-${i}`}
                      type="button"
                      onClick={() => insertStarter(q.id, s)}
                      disabled={readOnly}
                      className={cn(
                        'inline-flex items-center rounded-full border border-border/60 bg-card px-2.5 py-0.5 text-[11px] font-medium',
                        'text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors',
                        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-card disabled:hover:text-muted-foreground disabled:hover:border-border/60',
                      )}
                      title="Энэ загвараар хариултаа эхлүүлэх"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <PolishableTextarea
                id={`status-${q.id}`}
                value={stringValue}
                onChange={(e) => onChange({ [fieldKey]: e.target.value })}
                disabled={readOnly}
                rows={3}
                placeholder="Хариултаа бичнэ үү…"
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
