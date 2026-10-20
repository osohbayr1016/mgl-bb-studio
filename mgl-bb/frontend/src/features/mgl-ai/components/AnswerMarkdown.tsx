import { memo, useMemo, useRef } from 'react';

import {
  emptyStreamCache,
  parseStreaming,
  type InlineNode,
  type MdBlock,
  type ParsedBlock,
  type StreamParseCache,
} from '../lib/markdown';

/**
 * MGL AI · ХАРИУЛТЫН РЕНДЕР (§21–§25).
 *
 * ⚠️ `dangerouslySetInnerHTML` ЭНД ХЭЗЭЭ Ч БАЙХГҮЙ.  Бүх зүйл React
 *    элемент — өөрөөр хэлбэл XSS-ийн гадаргуу БАЙХГҮЙ, санитарчлагчийн
 *    тохиргоо буруу байх эрсдэл ч байхгүй (§22).
 *
 * ⚠️ БЛОК БҮР `memo`-ЛОГДСОН.  Урсгал дундуур ЗӨВХӨН СҮҮЛИЙН блок
 *    өөрчлөгддөг; өмнөх 40 блок нь ижил объект хэвээр тул React тэднийг
 *    БҮРЭН АЛГАСНА (§24).  `parseStreaming`-ийн кэш нь тэр ижил
 *    объектуудыг баталгаажуулна — түлхүүр төдийгүй ЛАВЛАГАА нь тогтмол.
 *
 * ⚠️ ХЭТ ФОРМАТЛАХГҮЙ (§21).  Загварын гаргасан бүтцийг Л дагана —
 *    гарчиг байхгүй бол гарчиг ЗОХИОХГҮЙ.  Тиймээс энд «сайжруулах»
 *    логик БАЙХГҮЙ, зөвхөн үнэнч рендер.
 */

/* ================================================================== */
/*  МӨРИЙН ДОТОРХ                                                      */
/* ================================================================== */

interface InlineProps {
  nodes: InlineNode[];
  onCitation?: (n: number) => void;
}

function InlineRun({ nodes, onCitation }: InlineProps) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <span key={i}>{n.v}</span>;
          case 'strong':
            return (
              <strong key={i} className="font-semibold text-foreground">
                <InlineRun nodes={n.c} onCitation={onCitation} />
              </strong>
            );
          case 'em':
            return (
              <em key={i}>
                <InlineRun nodes={n.c} onCitation={onCitation} />
              </em>
            );
          case 'code':
            return (
              <code
                key={i}
                className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
              >
                {n.v}
              </code>
            );
          case 'cite':
            /**
             * ⚠️ ЭШЛЭЛ НЬ ДАРАГДАХ.  Хэрэглэгч «[3]» гэдгийг дарж эх
             *    сурвалж руу үсрэх ёстой — эшлэл нь чимэглэл БИШ,
             *    баталгаажуулалтын хэрэгсэл (§21).
             */
            return (
              <button
                key={i}
                type="button"
                onClick={() => onCitation?.(n.n)}
                className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/15 px-1 align-baseline text-[10px] font-medium text-primary hover:bg-primary/25"
                aria-label={`Эх сурвалж ${n.n}`}
              >
                {n.n}
              </button>
            );
          case 'link':
            return (
              <a
                key={i}
                href={n.href}
                target="_blank"
                // ⚠️ `noopener` — шинэ таб нь `window.opener`-оор бидний
                //    хуудсыг чиглүүлэх боломжтой байх ёсгүй.
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:opacity-80"
              >
                <InlineRun nodes={n.c} onCitation={onCitation} />
              </a>
            );
        }
      })}
    </>
  );
}

/* ================================================================== */
/*  БЛОК                                                               */
/* ================================================================== */

const HEADING_CLASS: Record<1 | 2 | 3 | 4, string> = {
  // ⚠️ ЧАТЫН БӨМБӨЛӨГ ДОТОР — хуудасны h1 ШИГ ТОМ БАЙЖ БОЛОХГҮЙ.
  //    Шаталсан байдал нь ХЭМЖЭЭНЭЭС илүү ЖИН, ЗАЙГААР илэрхийлэгдэнэ.
  1: 'text-[15px] font-semibold mt-4 mb-1.5 first:mt-0',
  2: 'text-[14px] font-semibold mt-3.5 mb-1 first:mt-0',
  3: 'text-[13px] font-semibold mt-3 mb-1 first:mt-0',
  4: 'text-[13px] font-medium mt-2.5 mb-0.5 first:mt-0 text-muted-foreground',
};

const ALIGN_CLASS = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

function BlockView({
  block,
  onCitation,
}: {
  block: MdBlock;
  onCitation?: (n: number) => void;
}) {
  switch (block.t) {
    case 'heading': {
      const Tag = (['h3', 'h4', 'h5', 'h6'] as const)[block.level - 1]!;
      return (
        <Tag className={HEADING_CLASS[block.level]}>
          <InlineRun nodes={block.inline} onCitation={onCitation} />
        </Tag>
      );
    }

    case 'para':
      return (
        <p className="my-1.5 leading-relaxed first:mt-0 last:mb-0">
          <InlineRun nodes={block.inline} onCitation={onCitation} />
        </p>
      );

    case 'quote':
      return (
        <blockquote className="my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground italic">
          <InlineRun nodes={block.inline} onCitation={onCitation} />
        </blockquote>
      );

    case 'hr':
      return <hr className="my-3 border-border" />;

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          start={block.ordered ? block.start : undefined}
          className={
            block.ordered
              ? 'my-1.5 ml-5 list-decimal space-y-1 marker:text-muted-foreground'
              : 'my-1.5 ml-5 list-disc space-y-1 marker:text-muted-foreground'
          }
        >
          {block.items.map((it, i) => (
            <li
              key={i}
              className="leading-relaxed"
              // ⚠️ ҮҮРЛЭЛТИЙГ ЗАХААР — үүрлэсэн `<ul>` угсрах нь урсгал
              //    дундуур бүтэц үсэрхийлэхэд хүргэдэг (гүн нь сүүлийн
              //    токеноор өөрчлөгдөж болно).  Зайгаар илэрхийлэх нь
              //    харагдац ижил, тогтвор нь хамаагүй дээр.
              style={it.depth > 0 ? { marginInlineStart: `${it.depth * 1.1}rem` } : undefined}
            >
              <InlineRun nodes={it.inline} onCitation={onCitation} />
            </li>
          ))}
        </Tag>
      );
    }

    case 'code':
      return (
        /**
         * ⚠️ ГОРИЗОНТАЛЬ ГҮЙЛГЭЛТ НЬ БЛОК ДОТОР.  Урт мөр нь чатын
         *    багана бүхэлдээ гүйлгэхэд хүргэх ёсгүй.
         */
        <pre className="my-2 overflow-x-auto rounded-md border bg-muted/60 p-2.5 text-[12px] leading-snug">
          <code className="font-mono">{block.v}</code>
        </pre>
      );

    case 'table':
      return (
        <div className="my-2 overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-[12px]">
            <thead className="bg-muted/60">
              <tr>
                {block.head.map((cell, i) => (
                  <th
                    key={i}
                    className={`border-b px-2 py-1.5 font-semibold ${
                      ALIGN_CLASS[block.align[i] ?? 'left']
                    }`}
                  >
                    <InlineRun nodes={cell} onCitation={onCitation} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b last:border-b-0">
                  {row.map((cell, c) => (
                    <td key={c} className={`px-2 py-1.5 ${ALIGN_CLASS[block.align[c] ?? 'left']}`}>
                      <InlineRun nodes={cell} onCitation={onCitation} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/**
 * ⚠️ ЭНЭ `memo` НЬ БҮХ УРСГАЛЫН ГҮЙЦЭТГЭЛИЙН ҮНДЭС.
 *
 *    `parseStreaming` нь тогтсон блокуудыг ИЖИЛ ОБЪЕКТООР буцаадаг тул
 *    `block` лавлагаа өөрчлөгдөхгүй → `memo` нь дахин рендерлэхийг
 *    БҮРЭН алгасна.  Ингэснээр 40 блоктой хариултад шинэ токен ирэхэд
 *    ЗӨВХӨН НЭГ блок дахин рендерлэгдэнэ (§24, §25).
 */
const MemoBlock = memo(BlockView);

/* ================================================================== */

export interface AnswerMarkdownProps {
  text: string;
  /**
   * ⚠️ УРСГАЛ ЯВЖ БАЙГАА ЭСЭХ.  `true` үед тогтсон угтварын кэш
   *    ажиллана; `false` үед бүтэн задлан шинжилгээ (нэг удаа) —
   *    хадгалагдсан яриаг нээхэд кэш утгагүй.
   */
  streaming?: boolean;
  onCitation?: (n: number) => void;
}

export function AnswerMarkdown({ text, streaming = false, onCitation }: AnswerMarkdownProps) {
  /**
   * ⚠️ КЭШ НЬ `useRef`-Д, `useState`-Д БИШ.  Кэш өөрчлөгдөх нь ДАХИН
   *    РЕНДЕР ҮҮСГЭХ ЁСГҮЙ — тэр нь рендерийн дундах гаж нөлөө болно.
   *    Кэш нь зөвхөн ХУРДАН БОЛГОХ хэрэгсэл, харагдац биш.
   */
  const cacheRef = useRef<StreamParseCache>(emptyStreamCache());

  const blocks: ParsedBlock[] = useMemo(() => {
    if (!streaming) {
      // ⚠️ Дууссан хариулт — кэшийг тэглэнэ.  Дараагийн урсгал шинээр
      //    эхлэхэд хуучин блокууд урд нь наалдахгүй.
      cacheRef.current = emptyStreamCache();
      const { blocks: b } = parseStreaming(text, emptyStreamCache());
      return b;
    }
    const { blocks: b, cache } = parseStreaming(text, cacheRef.current);
    cacheRef.current = cache;
    return b;
  }, [text, streaming]);

  return (
    <div className="text-sm text-foreground">
      {blocks.map((b) => (
        <MemoBlock key={b.key} block={b.block} onCitation={onCitation} />
      ))}
    </div>
  );
}

/**
 * ⚠️ БҮХ БӨМБӨЛГИЙГ `memo`-ЛОХ ЦЭГ.  `MglAiPage` нь мессежийн
 *    жагсаалтыг рендерлэхэд шинэ токен бүрд БҮХ мессеж дахин
 *    рендерлэгддэг байсан (§25).  Энэ бүрхүүл нь дууссан мессежийг
 *    хөлдөөнө: `text` өөрчлөгдөөгүй бол ажил ХИЙГДЭХГҮЙ.
 */
export const MemoAnswerMarkdown = memo(AnswerMarkdown);
