import { useCallback, useEffect, useState } from 'react';
import { Plus, MessageSquare, Trash2, Pencil, Check, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { apiFetch } from '@/shared/api/client';

/**
 * MGL AI · ЯРИАНЫ ТҮҮХ.
 *
 * ⚠️ ЯАГААД ЭНЭ ХЭРЭГТЭЙ БОЛСОН.  Backend нь ярианы бүх мессежийг
 *    эхнээсээ хадгалдаг байсан (`ai_conversations` + `ai_messages`) ч
 *    түүнийг ХАРАХ ЗАМ БАЙГААГҮЙ: хуудсыг сэргээхэд яриа алга болдог
 *    мэт харагддаг байв.  Өгөгдөл алдагдаагүй — UI дутуу байсан.
 *
 * ⚠️ ЯРИА НЬ ХУВИЙН.  `GET /conversations` нь `user_id`-аар шүүдэг,
 *    `/messages` нь эзэн биш бол 403 өгнө — админ ч биш.  Энэ бол
 *    зориудын хил: ажилтны чат нь түүний ажлын орчин.
 *
 * ⚠️ УСТГАХ нь АРХИВЛАНА, мөр устгахгүй.  Батлагдсан санал хүсэлт нь
 *    `conv_uid`-аар холбогддог тул устгавал сургалтын жишээний гарал
 *    үүсэл тасарна (§30).
 */

export interface ConversationRow {
  conv_uid: string;
  title: string | null;
  message_count: number | null;
  last_message_at: string | null;
  created_at: string;
}

interface Props {
  activeUid: string;
  onSelect: (convUid: string) => void;
  onNew: () => void;
  /** Мессеж илгээгдэх бүрд өснө — жагсаалтыг шинэчлэх дохио. */
  refreshKey: number;
}

/** «2026-09-09» → «Өнөөдөр» / «Өчигдөр» / огноо. */
function dayLabel(iso: string | null): string {
  if (!iso) return '';
  const d = iso.slice(0, 10);
  const today = new Date();
  const t = today.toISOString().slice(0, 10);
  const y = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
  if (d === t) return 'Өнөөдөр';
  if (d === y) return 'Өчигдөр';
  return d;
}

export function ChatHistory({ activeUid, onSelect, onNew, refreshKey }: Props) {
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const load = useCallback(() => {
    apiFetch<{ conversations: ConversationRow[] }>('/mgl-ai/conversations')
      .then((r) => setRows(r.conversations ?? []))
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function rename(uid: string) {
    const title = draft.trim();
    setEditing(null);
    if (title.length === 0) return;
    // Шууд харуулна — сервер удаан хариулсан ч UI гацахгүй.
    setRows((p) => p.map((r) => (r.conv_uid === uid ? { ...r, title } : r)));
    await apiFetch(`/mgl-ai/conversations/${uid}`, { method: 'PATCH', data: { title } }).catch(
      load,
    );
  }

  async function archive(uid: string) {
    setRows((p) => p.filter((r) => r.conv_uid !== uid));
    if (uid === activeUid) onNew();
    await apiFetch(`/mgl-ai/conversations/${uid}`, { method: 'DELETE' }).catch(load);
  }

  // Өдрөөр бүлэглэнэ — ChatGPT-ийн ижил хэв маяг.
  const groups = new Map<string, ConversationRow[]>();
  for (const r of rows) {
    const k = dayLabel(r.last_message_at ?? r.created_at);
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-2 border-r border-border/60 pr-2">
      <Button size="sm" variant="outline" className="w-full justify-start gap-2" onClick={onNew}>
        <Plus className="size-4" aria-hidden />
        Шинэ яриа
      </Button>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            Яриа хараахан алга. Асуулт бичихэд энд хадгалагдана.
          </p>
        )}

        {[...groups.entries()].map(([day, list]) => (
          <div key={day} className="mb-2">
            <p className="px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">
              {day}
            </p>
            {list.map((r) => {
              const active = r.conv_uid === activeUid;
              const title = r.title?.trim() || 'Гарчиггүй яриа';

              if (editing === r.conv_uid) {
                return (
                  <div key={r.conv_uid} className="flex items-center gap-1 px-1 py-0.5">
                    <Input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void rename(r.conv_uid);
                        if (e.key === 'Escape') setEditing(null);
                      }}
                      className="h-7 text-xs"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 shrink-0"
                      onClick={() => void rename(r.conv_uid)}
                      aria-label="Хадгалах"
                    >
                      <Check className="size-3" aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 shrink-0"
                      onClick={() => setEditing(null)}
                      aria-label="Болих"
                    >
                      <X className="size-3" aria-hidden />
                    </Button>
                  </div>
                );
              }

              return (
                <div
                  key={r.conv_uid}
                  className={`group flex items-center gap-1 rounded px-1 ${
                    active ? 'bg-accent' : 'hover:bg-accent/50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(r.conv_uid)}
                    className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-xs"
                    title={title}
                  >
                    <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{title}</span>
                  </button>
                  {/* ⚠️ Товчнууд нь ЗӨВХӨН hover/focus дээр — жагсаалт
                      чимээ шуугиантай харагдахгүйн тулд.  `focus-within`
                      нь гар утсаар болон Tab-аар хандахад бас нээнэ. */}
                  <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      onClick={() => {
                        setEditing(r.conv_uid);
                        setDraft(title);
                      }}
                      aria-label="Нэр солих"
                    >
                      <Pencil className="size-3" aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 text-muted-foreground hover:text-rose-500"
                      onClick={() => void archive(r.conv_uid)}
                      aria-label="Устгах"
                    >
                      <Trash2 className="size-3" aria-hidden />
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
