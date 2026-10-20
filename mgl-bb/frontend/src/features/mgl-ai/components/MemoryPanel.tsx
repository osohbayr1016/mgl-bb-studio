import { useId, useState } from 'react';
import { Brain, X } from 'lucide-react';
import { Button } from '@/ui/button';
import type { MemoryItem } from '../lib/memory';

/**
 * ЛОКАЛ САНАМЖИЙН ЖАГСААЛТ (§34, §90).
 *
 * ⚠️ Хэрэглэгч ЮУ санагдсанаа ҮРГЭЛЖ харж, устгаж чадна — далд санамж
 *    нь итгэлийг эвддэг.  Энд зөвхөн хэв маягийн тохиргоо байна: нэр,
 *    албан тушаал ХЭЗЭЭ Ч энд орохгүй (`lib/memory.ts`).
 */
export function MemoryPanel({
  items,
  onRemove,
}: {
  items: readonly MemoryItem[];
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (items.length === 0) return null;

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        className="gap-1 text-xs"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        title="Энэ компьютерт хадгалсан тохиргоо"
      >
        <Brain className="size-3.5" aria-hidden />
        Санамж ({items.length})
      </Button>
      {open && (
        <div
          id={panelId}
          className="absolute right-0 z-20 mt-1 w-72 rounded-md border bg-popover p-2 text-xs shadow-md"
        >
          <p className="mb-1 text-[11px] text-muted-foreground">
            Зөвхөн энэ компьютерт хадгалагдана; серверт илгээгдэхгүй.
          </p>
          <ul className="space-y-1">
            {items.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-muted/50">
                <span className="truncate">{m.label}</span>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label={`«${m.label}» санамжийг устгах`}
                  onClick={() => onRemove(m.id)}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
