import { useState } from 'react';
import { FileText, ChevronDown } from 'lucide-react';
import { Badge } from '@/ui/badge';
import type { AiCitation, AiEvidence } from '@mgl/mglai-common/turn';

/**
 * ЭХ СУРВАЛЖИЙН ЧИП (§28).
 *
 * ⚠️ ЗӨВХӨН СЕРВЕР ДЭЭР ШИЙДЭГДСЭН эшлэл харагдана.  Загварын бичсэн
 *    `[3]` нь бодит нотолгоотой тулгагдаагүй бол `routes/mglAi.ts`-ийн
 *    `resolveCitations` түүнийг АЛЬ ХЭДИЙН хассан.  Энэ компонент нь
 *    хассан зүйлийг сэргээх ямар ч зам БАЙХГҮЙ — хуурамч эшлэл UI-д
 *    хүрэхгүй.
 */
function citeLabel(c: AiCitation | AiEvidence): string {
  const doc = 'documentUid' in c ? c.documentUid : c.document_uid;
  const page = c.page;
  const section = c.section;
  const bits = [doc, section ? `§${section}` : null, page != null ? `х.${page}` : null].filter(
    Boolean,
  );
  return bits.length > 0 ? bits.join(' · ') : c.title;
}

export function SourceChips({
  citations,
  evidence,
}: {
  citations: AiCitation[];
  evidence?: AiEvidence[];
}) {
  const [open, setOpen] = useState(false);
  if (citations.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <FileText className="size-3" aria-hidden />
        Эх сурвалж ({citations.length})
        <ChevronDown
          className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      <div className="mt-1.5 flex flex-wrap gap-1">
        {citations.map((c, i) => (
          <Badge key={c.id} variant="secondary" className="text-[11px] font-normal" title={c.title}>
            [{i + 1}] {citeLabel(c)}
          </Badge>
        ))}
      </div>

      {open && (
        <ul className="mt-2 space-y-1.5 rounded-md border bg-muted/40 p-2 text-xs">
          {citations.map((c, i) => {
            const ev = evidence?.find((e) => e.id === c.id);
            return (
              <li key={c.id} className="leading-snug">
                <span className="font-medium">[{i + 1}]</span> {c.title}
                <span className="ml-1 text-muted-foreground">{citeLabel(c)}</span>
                {ev?.score != null && (
                  <span className="ml-1 text-muted-foreground">
                    · тохирол {Math.round(ev.score * 100)}%
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
