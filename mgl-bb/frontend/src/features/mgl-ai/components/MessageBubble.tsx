import { memo, useState } from 'react';
import { AlertTriangle, Check, Copy, Info, Loader2 } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';

import { ConfidenceChip } from './ConfidenceChip';
import { SourceChips } from './SourceChips';
import { FeedbackBar } from './FeedbackBar';
import { MglAiActivity } from './MglAiActivity';
import { MemoAnswerMarkdown } from './AnswerMarkdown';
import type { AiRun } from '@mgl/mglai-common/turn';
import type { ChatMessage } from '@mgl/mglai-common/turn';

/**
 * MGL AI · НЭГ МЕССЕЖИЙН БӨМБӨЛӨГ (§25).
 *
 * ⚠️ ЭНЭ ФАЙЛ ЯАГААД ОРШИН БАЙНА.  Өмнө нь бүх мессеж `MglAiPage`-ийн
 *    `messages.map(...)` дотор ШУУД бичигдсэн байсан.  Тэр нь токен
 *    бүрд (`setActiveRun` → хуудас дахин рендер) 40 мессежийн БҮХ
 *    бөмбөлгийг, тэдгээрийн `SourceChips`, `FeedbackBar`, огноо,
 *    итгэлийн чипийг ДАХИН рендерлүүлдэг байв — §25-ийн шууд зөрчил:
 *    «A new token must not cause the entire chat history to rerender».
 *
 *    Одоо: дууссан мессеж бүр `memo`-логдсон бөгөөд түүний props нь
 *    ХӨДӨЛДӨГГҮЙ (ижил объект).  Токен ирэхэд ЗӨВХӨН урсаж буй
 *    бөмбөлөг дахин рендерлэгдэнэ.
 *
 * ⚠️ `onVoted`, `onRetry` НЬ ТОГТМОЛ ЛАВЛАГАА байх ЁСТОЙ.  Дуудагч
 *    `useCallback`-гүйгээр дамжуулбал `memo` нь ХЭЗЭЭ Ч ажиллахгүй ба
 *    энэ файлын бүх зорилго алдагдана.
 */

export interface MessageBubbleProps {
  message: ChatMessage;
  /** ⚠️ Зөвхөн УРСАЖ БУЙ мессежид `AiRun`; бусдад `null`. */
  live: AiRun | null;
  convUid: string;
  /** Загварын төлөвийн мөр — «загварыг бэлдэж байна…». */
  loadingLabel: string;
  onRetry: (msgUid: string) => void;
  /** ⚠️ `1 | -1` — `types.ts`-ийн `ChatMessage.vote`-ийн ижил төрөл. */
  onVoted: (msgUid: string, vote: 1 | -1) => void;
}

function MessageBubbleView({
  message: m,
  live,
  convUid,
  loadingLabel,
  onRetry,
  onVoted,
}: MessageBubbleProps) {
  const run = live ?? m.run ?? null;
  const content = live ? live.answer : m.content;
  const shape = m.errorShape ?? null;
  const streaming = live !== null;

  if (m.role === 'user') {
    return <UserBubble text={m.content} />;
  }

  return (
    <div className="w-full max-w-[95%] space-y-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
      {/* ── ГҮЙЦЭТГЭЛИЙН САМБАР — хариултаас ӨМНӨ (§26) ── */}
      {run !== null && <MglAiActivity run={run} />}

      {content.length > 0 && (
        <div className="relative">
          {/*
            ⚠️ ТҮҮХИЙ MARKDOWN БАЙХАА БОЛИВ (§21, §22).  Өмнө нь энэ нь
               `<p className="whitespace-pre-wrap">{content}</p>` байсан
               тул хэрэглэгч `**чухал**`, `## Гарчиг`, `| багана |`
               гэсэн ТҮҮХИЙ тэмдэгтүүдийг хардаг байв.
          */}
          <MemoAnswerMarkdown text={content} streaming={streaming} />
          {/*
            ⚠️ КУРСОР НЬ ЗӨВХӨН ҮНЭХЭЭР ҮҮСГЭЖ БАЙХАД (§27).  `streaming`
               дээр биш, `generationStarted` дээр — тэр нь локал загвараас
               ирсэн БОДИТ дохио.  Хайлт, ERP, prompt угсрах хугацаанд
               курсор анивчих нь «бичиж байна» гэж ХУДЛАА хэлнэ.
          */}
          {live?.generationStarted && (
            <span className="ml-0.5 inline-block animate-pulse align-baseline" aria-hidden>
              ▌
            </span>
          )}
        </div>
      )}

      {/* ── ЗАГВАР БЭЛТГЭГДЭЖ БАЙХ ҮЕ (§5, §27) ── */}
      {live !== null && !live.generationStarted && content.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          {loadingLabel}
        </p>
      )}

      {/*
        ⚠️ АЛДАА БҮР УЛААН БИШ (§39).  `severity` нь өнгийг шийднэ:
           жинхэнэ гэмтэл Л улаан, бусад нь төвийг сахисан.
      */}
      {shape !== null && (
        <div
          className={
            shape.severity === 'error'
              ? 'flex items-start gap-1.5 rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-400'
              : 'flex items-start gap-1.5 rounded border border-border/60 bg-background/60 px-2 py-1.5 text-xs text-muted-foreground'
          }
          role={shape.severity === 'error' ? 'alert' : 'status'}
        >
          {shape.severity === 'error' ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          ) : (
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            <span className="block">{shape.message}</span>
            {shape.hint && <span className="mt-0.5 block opacity-80">{shape.hint}</span>}
          </span>
          {shape.action === 'retry_generation' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 px-2 text-xs"
              onClick={() => onRetry(m.msgUid)}
            >
              Дахин бичих
            </Button>
          )}
        </div>
      )}

      {!m.streaming && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {m.confidence && <ConfidenceChip state={m.confidence} />}
            {/*
              ⚠️ НОРМЫН ТӨЛӨВ — СЕРВЕРИЙН ГАРЫН ҮСЭГТЭЙ TrustedNormResult-оос (P0-16),
                 загварын текстээс БИШ.  «Хүний хяналт», «хувилбар зөрсөн» гэдэг нь
                 хэрэглэгчийн шийдвэрт нөлөөлөх мэдээлэл тул шошгоор ил.
            */}
            {m.normResult && normStateLabel(m.normResult) && (
              <Badge variant="outline" className="text-[11px] font-normal" title={m.normResult.reason}>
                {normStateLabel(m.normResult)}
              </Badge>
            )}
            {m.engine === 'retrieval-only' && (
              <Badge variant="outline" className="text-[11px] font-normal">
                хайлтын горим
              </Badge>
            )}
            {m.firstTokenMs != null && (
              <span className="text-[11px] text-muted-foreground">
                эхний токен {m.firstTokenMs} мс
                {m.totalMs != null ? ` · нийт ${m.totalMs} мс` : ''}
              </span>
            )}
          </div>

          <SourceChips citations={m.citations ?? []} evidence={m.evidence} />

          <FeedbackBar
            convUid={convUid}
            msgUid={m.msgUid}
            vote={m.vote ?? null}
            onVoted={(v) => onVoted(m.msgUid, v)}
          />
        </>
      )}
    </div>
  );
}

/** Детерминист нормын үр дүнгийн ТӨВИЙГ САХИСАН шошго — `null` бол шошгогүй (энгийн ээлж). */
function normStateLabel(r: NonNullable<ChatMessage['normResult']>): string | null {
  switch (r.verification) {
    case 'verified':
      return r.answerKind === 'calculation'
        ? `тооцоо: ${r.documentCode ?? 'бүртгэл'}`
        : r.answerKind === 'insufficient_context'
          ? 'оролт дутуу'
          : `баталгаажсан дүрэм: ${r.documentCode ?? 'бүртгэл'}`;
    case 'needs_human_review':
      return 'хүний хяналт шаардлагатай';
    case 'data_version_mismatch':
      return 'нормын сангийн хувилбар зөрсөн';
    case 'named_document_absent':
      return 'нэрлэсэн баримт санд алга';
    case 'retrieval_failed':
      return 'хайлт амжсангүй';
    case 'superseded':
      return 'солигдсон баримт';
    case 'historical':
      return 'түүхэн баримт';
    default:
      return null;
  }
}

/**
 * ⚠️ ЭНЭ `memo` БАЙХГҮЙ БОЛ БҮХ ФАЙЛ УТГАГҮЙ.  Дууссан мессежийн бүх
 *    props нь тогтмол лавлагаа тул React энэ бүрэлдэхүүнийг БҮРЭН
 *    алгасна — 40 мессежтэй ярианд токен бүрд хийгдэх ажил тогтмол
 *    хэвээр үлдэнэ (§25).
 */
export const MessageBubble = memo(MessageBubbleView);

/**
 * Хэрэглэгчийн ӨӨРИЙН асуулт — сонгогдоно, хуулагдана (эзний хүсэлт 2026-09-11).
 * `select-text` + `cursor-text` нь текстийг ил тод сонгогдохоор болгоно;
 * «Хуулах» товч нь бүхэл асуултыг нэг товшилтоор clipboard-д хийнэ.
 */
function UserBubble({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="group flex items-end justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100"
        onClick={copy}
        aria-label={copied ? 'Хуулагдлаа' : 'Асуултыг хуулах'}
        title={copied ? 'Хуулагдлаа' : 'Асуултыг хуулах'}
      >
        {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </Button>
      <div className="max-w-[85%] cursor-text rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground select-text">
        {text}
      </div>
    </div>
  );
}

