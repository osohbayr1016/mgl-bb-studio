import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send, Square, RotateCcw, Plus, Sparkles, ListPlus, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import { Card } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { apiFetch } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';

import { RuntimeGate } from './components/RuntimeGate';
import { ChatHistory } from './components/ChatHistory';
import { MessageBubble } from './components/MessageBubble';
import {
  probe,
  modelStateOf,
  MODEL_STATE_LABEL,
  pair,
  warmup,
  type ProbeResult,
} from './lib/runtime';
import { markMglAiUsed } from './lib/usage';
import { createFrameScheduler, isImmediateEvent } from './lib/frameBatch';
import { useStickyScroll } from './lib/useStickyScroll';
import { MAX_QUEUED_QUESTIONS, useQuestionQueue } from './lib/questionQueue';
import { runTurn, type StageCache } from './lib/browserTurn';
import { emptyRun, reduce, isRunning, type AiRun } from '@mgl/mglai-common/turn';
import { newRequestId } from '@mgl/mglai-common/turn';
import { isInvalidAnswer } from '@mgl/mglai-common/turn';
import {
  loadMemories,
  saveMemories,
  upsertFromHint,
  isStandingHint,
  markUsed,
  removeMemory,
  type MemoryItem,
} from './lib/memory';
import { MemoryPanel } from './components/MemoryPanel';
import type { AiSession, ChatMessage, AiCitation, ConfidenceState } from '@mgl/mglai-common/turn';

/**
 * MGL AI — ЧАТЫН ХУУДАС.
 *
 * ⚠️ УРСГАЛЫН ЗАГВАР (энэ файлын хамгийн чухал зүйл):
 *
 *    1. Хөтөч → Worker  `/api/mgl-ai/context`
 *         Worker нь ХЭН болохыг токеноос шийдэж, нотолгоог ЭРХЭЭР шүүж,
 *         prompt-ыг УГСАРЧ буцаана.  Нууц мөр энэ алхмаас цааш ГАРАХГҮЙ.
 *    2. Хөтөч → 127.0.0.1  `/generate`
 *         Локал llama.cpp токен үүсгэнэ.  ТОКЕН ТУТМЫН ТӨЛБӨР БАЙХГҮЙ.
 *    3. Хөтөч → Worker  `/api/mgl-ai/messages`
 *         Хариуг хадгалж, ЭШЛЭЛИЙГ СЕРВЕР ДЭЭР ДАХИН ШИЙДНЭ (загварын
 *         зохиосон эшлэл энд хаягдана), итгэлийн төлөв тооцогдоно.
 *
 * ⚠️ WORKER ДУНД НЬ ОРЖ ИНФЕРЕНС ХИЙХГҮЙ.  Хэрэв хэзээ нэгэн цагт
 *    «Worker-ээр дамжуулъя» гэсэн санаа гарвал тэр нь §3-ийн эдийн
 *    засгийн шаардлагыг зөрчинө (токен тутмын төлбөр) ба энэ бүтээгдэхүүн
 *    оршин байх шалтгааныг устгана.
 *
 * ⚠️ ЛОКАЛ ХӨДӨЛГҮҮР БАЙХГҮЙ ҮЕД ХУУДАС АЖИЛЛАСАН ХЭВЭЭР.  Тэр үед
 *    «хайлт + эх сурвалж» горим руу шилжинэ — олдсон заалтыг эшлэлтэй нь
 *    үзүүлнэ, өгүүлбэр зохиохгүй.  Энэ нь ХООСОН дэлгэцээс хамаагүй
 *    ашигтай бөгөөд ҮНЭН.
 */

const SUGGESTIONS_MN = [
  'Манай одоо идэвхтэй хэдэн төсөл байна?',
  'Deadline хамгийн ойрхон ямар төсөл байна?',
  'Миний хугацаа хэтэрсэн даалгаврууд юу вэ?',
  'Олон нийтийн барилгад хэдэн эвакуацын гарц шаардлагатай вэ?',
];

function newUid(prefix: string): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${rnd.slice(0, 24)}`;
}

export default function MglAiPage() {
  const { lang } = useLanguage();
  const [session, setSession] = useState<AiSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<ProbeResult | null>(null);
  const [convUid, setConvUid] = useState<string>(() => newUid('conv'));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /**
   * ⚠️ `send` нь closure-ээрээ ХУУЧИН `messages`-ыг барьдаг (useCallback).  «Дахин»
   *    товч мессежийг таслаад ШУУД `send` дуудахад тэр нь таслагдаагүй жагсаалтаас
   *    `seq`, `history` тооцоолж, унасан хариулт prompt-д орж, seq давхардаж байв
   *    (2026-09-11 хэмжсэн).  Ref нь үргэлж ХАМГИЙН СҮҮЛИЙН жагсаалт.
   */
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [input, setInput] = useState('');
  /**
   * ⚠️ `busy: boolean` НЬ ХАНГАЛТГҮЙ (§19).  Хуучин хуудас нь ганц тугтай
   *    байсан тул «яг одоо юу болж байна» гэдгийг гаргаж авах боломжгүй
   *    байв — үр дүн нь анивчсан ▌ гэсэн ганц дүрслэл.  Одоо ажиллаж
   *    байгаа ээлжийн БҮРЭН төлөв `activeRun`-д амьдарна.
   */
  const [activeRun, setActiveRun] = useState<AiRun | null>(null);
  const busy = activeRun !== null && isRunning(activeRun.state);
  /** ⚠️ Дахин оролдоход үе шатыг ДАХИН АЖИЛЛУУЛАХГҮЙН тулд (§21). */
  const cacheRef = useRef<StageCache | undefined>(undefined);
  const lastQuestionRef = useRef<{ q: string; seq: number; aiMsgUid: string } | null>(null);
  /**
   * ЯРИАНЫ БҮТЭЦТЭЙ ТӨЛӨВ — серверийн `conv_state_next`.
   *
   * ⚠️ ХӨТӨЧ ҮҮНИЙГ УНШИХГҮЙ, ЗАСАХГҮЙ — зөвхөн дараагийн ээлжид буцааж
   *    өгнө.  Яриа солиход ЗААВАЛ цэвэрлэнэ; эс тэгвэл өмнөх ярианы
   *    төсөл шинэ ярианы «яагаад?»-д орж ирнэ.
   */
  const convStateRef = useRef<unknown>(null);
  /**
   * ЛОКАЛ УРТ ХУГАЦААНЫ САНАМЖ (§34) — энэ хөтөч, энэ хэрэглэгч.  Серверт
   * ХЭЗЭЭ Ч хадгалагдахгүй; ээлж бүрд хамааралтай нь л prompt-д орно.
   */
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const memoryNs = session ? `${session.memory_namespace}:${session.user_id ?? 'anon'}` : null;
  useEffect(() => {
    if (memoryNs) setMemories(loadMemories(memoryNs));
  }, [memoryNs]);
  const persistMemories = useCallback(
    (next: MemoryItem[]) => {
      setMemories(next);
      if (memoryNs) saveMemories(memoryNs, next);
    },
    [memoryNs],
  );
  // Мессеж илгээгдэх бүрд өснө — түүхийн жагсаалтыг шинэчлэх дохио.
  const [historyKey, setHistoryKey] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  /**
   * ⚠️ ГҮЙЛГЭЛТ НЬ ЗӨВХӨН ЁРООЛД НААЛДСАН ҮЕД ДАГАНА (§30).  Токен
   *    багцлагдсны дараа `messages` нь урсгал дундуур ӨӨРЧЛӨГДӨХГҮЙ
   *    тул хуучин `useEffect(..., [messages])` нь урсгалыг ОГТ
   *    дагахаа болино — хэрэглэгч хариултаа гараар хөөх байсан.
   */
  const scroll = useStickyScroll();

  /* ── Сесс + локал хөдөлгүүр ───────────────────────────────────── */

  const refreshRuntime = useCallback((requestPermission = false) => {
    void probe({ requestPermission }).then((p) => {
      setRuntime(p);
      if (p.installed && p.authorized) {
        const token = localStorage.getItem('auth_token');
        if (token) void pair(token);
        void warmup();
      }
    });
  }, []);

  useEffect(() => {
    let alive = true;
    apiFetch<AiSession>('/mgl-ai/session')
      .then((s) => {
        if (alive) setSession(s);
      })
      .catch((err: Error) => {
        if (alive) setSessionError(err.message);
      });
    // Background probe only. Chrome 142+ дээр loopback permission нь
    // хэрэглэгчийн товч даралтаар л хүсэгдэнэ; pair/warmup нь probe
    // амжилттай болсон үед refreshRuntime дотор хийгдэнэ.
    refreshRuntime(false);

    // «Энэ хөтөч AI хэрэглэдэг» — дараагийн удаа ERP нээгдэхэд `Layout`
    // (`useMglAiPrewarm`) загварыг ЭНЭ хуудас нээгдэхээс ӨМНӨ халаана.
    markMglAiUsed();

    return () => {
      alive = false;
    };
  }, [refreshRuntime]);

  /**
   * ⚠️ БЭЛЭН БОЛТОЛ ӨӨРӨӨ ДАХИН ШАЛГАНА.  Өмнө нь `probe()` хуудас
   *    нээгдэхэд НЭГ удаа явдаг байсан: runtime дөнгөж асаж байсан,
   *    загвар ачаалж байсан, эсвэл суулгагч саяхан дуусч байсан бол
   *    «суугаагүй / бэлдэж байна» гэсэн мөр хэрэглэгч «Дахин оролдох»
   *    дартал ХӨЛДДӨГ байв.  Одоо READY болтол 4 секунд тутам шалгаад
   *    зогсоно — 127.0.0.1 руу хийх хүсэлт нь сүлжээ ч биш, GPU ч биш.
   *
   *    NOT_INSTALLED → суусан гэсэн шилжилтэд хосолт + халаалтыг ДАХИН
   *    хийнэ: хуудас нээгдэх үеийн эхний оролдлого хоосон порт руу
   *    явж алга болсон байдаг.
   */
  const modelStateForPoll = modelStateOf(runtime);
  useEffect(() => {
    if (modelStateForPoll === 'READY' || modelStateForPoll === 'BUSY' || modelStateForPoll === 'ERROR') return;
    let alive = true;
    const wasInstalled = runtime?.installed ?? false;
    const id = setInterval(() => {
      void probe().then((p) => {
        if (!alive) return;
        setRuntime(p);
        if (!wasInstalled && p.installed && p.authorized) {
          const token = localStorage.getItem('auth_token');
          if (token) void pair(token);
          void warmup();
        }
      });
    }, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // `runtime` нь тик бүрд солигдоно — хамаарал нь ТӨЛӨВ, объект биш,
    // эс тэгвэл interval 4 секунд тутам дахин үүснэ (ажиллах ч дэмий).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelStateForPoll]);

  // Шинэ мессеж нэмэгдэхэд (асуулт илгээх, яриа нээх) доош гүйлгэнэ.
  useEffect(() => {
    scroll.follow();
  }, [messages, scroll]);

  /**
   * ⚠️ УРСГАЛЫГ ДАГАХ — `activeRun.answer` нь кадр тутам ӨСНӨ.
   *    `follow` нь өөрөө rAF-аар товлодог тул энд нэмэлт хязгаарлалт
   *    хэрэггүй; наалдац тасарсан бол ЮУ Ч ХИЙХГҮЙ.
   */
  useEffect(() => {
    if (activeRun === null) return;
    scroll.follow();
  }, [activeRun, scroll]);

  /* ── Яриа шинэчлэх ────────────────────────────────────────────── */

  function newChat() {
    questionQueue.clear();
    abortRef.current?.abort();
    setConvUid(newUid('conv'));
    setMessages([]);
    setActiveRun(null);
    cacheRef.current = undefined;
    lastQuestionRef.current = null;
    convStateRef.current = null;
  }

  /**
   * Хуучин яриаг сэргээнэ.
   *
   * ⚠️ Мессежийг СЕРВЕРЭЭС дахин татна, локал кэшээс биш — өөр
   *    төхөөрөмжөөс үргэлжлүүлэх нь ажилладаг байх ёстой.
   * ⚠️ `msgUid` нь ХЭВЭЭР — санал хүсэлт нь тэр түлхүүрээр холбогддог
   *    тул хуучин мессежид ч 👍/👎 өгөх боломжтой хэвээр үлдэнэ.
   */
  const openConversation = useCallback(
    async (uid: string) => {
      questionQueue.clear();
      abortRef.current?.abort();
      setActiveRun(null);
      try {
        const r = await apiFetch<{
          messages: {
            msg_uid: string;
            role: 'user' | 'assistant';
            content: string;
            citations_json: string | null;
            confidence: string | null;
            error: string | null;
          }[];
        }>(`/mgl-ai/conversations/${uid}/messages`);

        setConvUid(uid);
        // Сэргээсэн яриа: бүтэцтэй төлөв алга — сервер түүхээс дахин
        // тайлна (сул горим), эхний ээлжийн дараа төлөв сэргэнэ.
        convStateRef.current = null;
        setMessages(
          (r.messages ?? []).map((m) => {
            let citations: AiCitation[] = [];
            try {
              const parsed: unknown = JSON.parse(m.citations_json ?? '[]');
              if (Array.isArray(parsed)) citations = parsed as AiCitation[];
            } catch {
              // эвдэрсэн JSON нь яриаг нээхийг зогсоохгүй
            }
            return {
              msgUid: m.msg_uid,
              role: m.role,
              content: m.content,
              citations,
              confidence: (m.confidence as ConfidenceState | null) ?? undefined,
              error: m.error ?? undefined,
            };
          }),
        );
      } catch {
        // Уншиж чадсангүй — шинэ яриа руу унана, хоосон дэлгэц үзүүлэхгүй.
        newChat();
      }
    },
    // `questionQueue.clear` нь тогтвортой (useCallback + ref) тул deps-д хэрэггүй; `newChat` нь
    // render бүрд шинэ ч зөвхөн state setter + тогтвортой `clear` дууддаг.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* ── Гол урсгал ───────────────────────────────────────────────── */

  /**
   * ⚠️ ЭНЭ ФУНКЦ БАРАГ ЮУ Ч ХИЙХГҮЙ, ЗОРИУД.  Гинжийг `lib/orchestrator.ts`
   *    ажиллуулж, ҮЙЛ ЯВДАЛ ялгаруулна; энд зөвхөн тэдгээрийг React-ийн
   *    төлөв рүү буулгана.  Ингэснээр бүх зохион байгуулалт (хугацаа,
   *    зэрэгцүүлэлт, цуцлалт, кэш) нь ХӨТӨЧГҮЙГЭЭР тестлэгддэг
   *    (`frontend/scripts/check-ai-stream.mjs`).
   *
   * ⚠️ ХАМГИЙН ЧУХАЛ ДҮРЭМ: `setActiveRun` нь ЯМАР Ч AWAIT-ААС ӨМНӨ
   *    дуудагдана.  Хэрэглэгч «Илгээх» дарснаас хойш дэлгэц <100 мс-д
   *    өөрчлөгдөх ёстой (§2) — сүлжээг хүлээх нь тэр амлалтыг зөрчинө.
   */
  const send = useCallback(
    async (question: string, opts: { generationOnly?: boolean; aiMsgUid?: string } = {}) => {
      const q = question.trim();
      if (q.length === 0 || busy) return;

      const userMsgUid = newUid('msg');
      const aiMsgUid = opts.aiMsgUid ?? newUid('msg');
      const current = messagesRef.current;
      const seq = current.length;

      // ⚠️ УНАСАН ХАРИУЛТ ТҮҮХЭД ОРОХГҮЙ (P0-13, Session A).  `error` нь зөвхөн улаан гэмтэлд
      //    тавигддаг; «нотолгоо олдсонгүй», давталт, хугацаа, цуцлалт (`errorShape`,
      //    `incomplete`) нь notice-түвшний ч гэсэн загварын prompt-д орвол дараагийн
      //    ээлжийг бохирдуулна.  + `aiErrors.isInvalidAnswer` (Session C — давталт/тасралт/
      //    цуцлалт).  Хэрэглэгчийн мессеж ҮРГЭЛЖ үлдэнэ.
      const history = current
        .filter((m) => m.role === 'user' || (!m.error && !m.errorShape && !isInvalidAnswer(m.errorShape) && !m.incomplete && m.content.trim().length > 0))
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));

      // ── ШУУД ХҮЛЭЭН АВЛАА — сүлжээг хүлээхгүй ──────────────────
      let run = emptyRun(newRequestId());
      setActiveRun(run);
      if (!opts.generationOnly) {
        setMessages((prev) => [
          ...prev,
          { msgUid: userMsgUid, role: 'user', content: q },
          { msgUid: aiMsgUid, role: 'assistant', content: '', streaming: true },
        ]);
        setInput('');
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.msgUid === aiMsgUid
              ? { ...m, content: '', streaming: true, error: null, errorShape: null }
              : m,
          ),
        );
      }
      lastQuestionRef.current = { q, seq, aiMsgUid };

      const controller = new AbortController();
      abortRef.current = controller;

      /**
       * ⚠️ ҮЙЛ ЯВДАЛ БҮРЭЭР `setMessages` ДУУДАХГҮЙ.  Токен нь секундэд
       *    ~100 удаа ирдэг тул мессежийн бүтэн массивыг тухай бүрд
       *    хуулбарлах нь UI-г гацаана.  Урсгалын текст нь
       *    `activeRun.answer`-т амьдарч, ЭЦЭСТ нь Л мессежид бичигдэнэ.
       *
       * ⚠️ ТҮҮНЭЭС ГАДНА: `setActiveRun`-ЫГ ЧЕ ТОКЕН БҮРД ДУУДАХГҮЙ (§23).
       *
       *    `reduce` нь ЦЭВЭР бөгөөд хямд тул токен бүрд СИНХРОНООР
       *    ажиллана — төлөв ҮРГЭЛЖ ЯГ ЗӨВ, нэг ч токен алдагдахгүй.
       *    Гэвч React-ийн дахин рендерийг кадрын хурдад (≤60/сек)
       *    барина.  Локал загвар секундэд 60-105 токен гаргадаг тул
       *    энэ нь рендерийн тоог 2 дахин, урт хариулт дээр түүнээс ч
       *    их бууруулна.
       *
       * ⚠️ ТОКЕН БИШ ҮЙЛ ЯВДЛЫГ ХОЙШЛУУЛАХГҮЙ.  «Эх сурвалж оллоо»,
       *    «үүсгэлт эхэллээ», «алдаа» нь ХОВОР бөгөөд УТГА УЧИРТАЙ —
       *    16 мс хойшлуулах нь ямар ч ашиггүй, харин гүйцэтгэлийн
       *    самбарыг бодит цагаас хоцроож §26-г зөрчинө.
       */
      const scheduler = createFrameScheduler({ flush: () => setActiveRun(run) });
      const onEvent = (e: Parameters<typeof reduce>[1]) => {
        run = reduce(run, e);
        if (isImmediateEvent(e.type)) scheduler.flushNow();
        else scheduler.schedule();
      };

      /**
       * ХЯЗГААРЛАГДСАН АВТОМАТ ДАХИЛТ — ЯГ НЭГ УДАА (§7).
       *
       * ⚠️ ГОГЦОО, ЭНГИЙН РЕКУРС БИШ.  `send` өөрийгөө дуудах нь React
       *    Compiler-ийн `immutability` дүрмийг зөрчөөд зогсохгүй (хуучин
       *    closure-ыг барина), «хэдэн удаа дахисан» гэдэг нь дуудлагын
       *    гүнд нуугдана.  Гогцоо нь хязгаарыг ИЛ болгоно.
       *
       * ⚠️ ЭВДЭРСЭН ХАРИУЛТЫГ PROMPT-Д ОРУУЛАХГҮЙ.  Хоёр дахь
       *    оролдлого нь `cacheRef`-ийн ХАДГАЛАГДСАН `context.turns`-ыг
       *    дахин ашиглана — тэнд эвдэрсэн текст БАЙХГҮЙ.  Мөн хуучин
       *    текст дээр НЭМЖ бичихгүй, БҮХЭЛД НЬ солино.
       *
       * ⚠️ ЗӨВХӨН ДАВТАЛТАД.  Сүлжээ, эрх, нотолгооны алдаанд дахихгүй —
       *    тэдгээр нь дахилтаар засагдахгүй бөгөөд дахилт нь зөвхөн
       *    хэрэглэгчийн хүлээлтийг ХОЁР ДАХИН уртасгана.
       */
      const MAX_ATTEMPTS = 2;
      let result = await runTurn({
        question: q,
        convUid,
        userMsgUid,
        aiMsgUid,
        seq,
        history,
        convState: convStateRef.current,
        memories,
        runtime,
        mode: session?.mode ?? 'employee',
        signal: controller.signal,
        emit: onEvent,
        cache: opts.generationOnly ? cacheRef.current : undefined,
        generationOnly: opts.generationOnly,
      });
      cacheRef.current = result.cache;

      for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
        if (result.error?.code !== 'GENERATION_REPETITION') break;
        if (controller.signal.aborted) break;

        // ⚠️ Хуримтлагдсан текстийг БҮХЭЛД НЬ хаяна — дахилт нь
        //    эвдэрсэн хариултын ард НЭМЭГДЭХГҮЙ.
        run = emptyRun(newRequestId());
        setActiveRun(run);
        setMessages((prev) =>
          prev.map((m) => (m.msgUid === aiMsgUid ? { ...m, content: '' } : m)),
        );

        result = await runTurn({
          question: q,
          convUid,
          userMsgUid,
          aiMsgUid,
          seq,
          history,
          convState: convStateRef.current,
          memories,
          runtime,
          mode: session?.mode ?? 'employee',
          signal: controller.signal,
          emit: onEvent,
          // ⚠️ Хайлт, ERP, нормыг ДАХИН ажиллуулахгүй — тэд хүчинтэй
          //    хэвээр.  Зөвхөн үүсгэлт дахин явна (§21).
          cache: cacheRef.current,
          generationOnly: true,
        });
        cacheRef.current = result.cache;
      }

      // ── ЛОКАЛ САНАМЖ (§34) ────────────────────────────────────────
      // ⚠️ Зөвхөн БАЙНГЫН («цаашид», «үргэлж») хүсэлтийг хадгална; «энэ
      //    удаа богино» нь нэг удаагийн.  Хадгалсан бол ил мэдэгдэнэ —
      //    далд санамж итгэлийг эвддэг.  Хэрэглэсэн санамжийн
      //    `lastUsedAt` шинэчлэгдэнэ (90 хоногийн хуучралт).
      {
        let next = markUsed(memories, result.usedMemoryIds);
        const saved: string[] = [];
        for (const hint of result.memoryHints) {
          if (!isStandingHint(hint)) continue;
          const up = upsertFromHint(next, hint);
          next = up.items;
          saved.push(up.item.label);
        }
        if (next !== memories) persistMemories(next);
        if (saved.length > 0) {
          run = reduce(run, {
            requestId: run.requestId,
            atMs: 0,
            type: 'warning',
            stage: 'persist',
            safeUserMessage: `Тохиргоог энэ компьютерт санав: ${saved.join(', ')}`,
          });
          scheduler.flushNow();
        }
      }

      // ⚠️ Төлөвийг ЗӨВХӨН амжилттай ээлжийн дараа урагшлуулна — унасан
      //    ээлж сэдвийг сольж болохгүй (хэрэглэгч дахин асууна).
      if (!controller.signal.aborted && result.answer.length > 0 && !result.error) {
        convStateRef.current = result.convStateNext;
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.msgUid === aiMsgUid
            ? {
                ...m,
                streaming: false,
                content: result.answer,
                citations: result.citations,
                evidence: result.evidence,
                confidence: result.confidence,
                firstTokenMs: result.firstTokenMs,
                totalMs: result.totalMs,
                engine: result.engine,
                runtimeVariant: result.runtimeVariant,
                regulatory: result.regulatory,
                verificationStates: result.verificationStates,
                run,
                incomplete: run.incomplete,
                // ⚠️ ЗӨВХӨН ЖИНХЭНЭ ГЭМТЛИЙГ `error` болгоно.  «Нотолгоо
                //    олдсонгүй», «цуцлагдсан» зэрэг нь `errorShape`-аар
                //    ТӨВИЙГ САХИСАН байдлаар харагдана (§20).
                errorShape: result.error,
                error: result.error?.severity === 'error' ? result.error.message : null,
                // Детерминист нормын үр дүн — UI-ийн нотолгоо (P0-16), загварын текст биш.
                normResult: result.normResult,
              }
            : m,
        ),
      );

      // ⚠️ ТОВЛОГДСОН КАДРЫГ ЦУЦЛАНА.  Үлдсэн flush нь `setActiveRun(run)`
      //    -ыг ДАРААХ рендерт ажиллуулж, дөнгөж `null` болгосон идэвхтэй
      //    ээлжийг СЭРГЭЭНЭ — хариулт дууссан ч курсор эргэлдсээр байх
      //    ба мессеж хоёр удаа харагдана.
      scheduler.cancel();
      abortRef.current = null;
      setActiveRun(null);
      setHistoryKey((k) => k + 1);
    },
    [busy, convUid, runtime, session?.mode, memories, persistMemories],
  );

  /**
   * АСУУЛТЫН ДАРААЛАЛ — хариулт гарч байхад илгээсэн асуулт энд хүлээж, өмнөх нь
   * ДУУССАНЫ дараа нэг нэгээр автоматаар эхэлнэ (`lib/questionQueue.ts`).
   * ⚠️ `send`-ээс ДАРАА зарлана: `start` нь `send`-ийн хамгийн сүүлийн хувилбар байх ёстой.
   */
  const questionQueue = useQuestionQueue(busy, (text) => void send(text));
  const [queueFull, setQueueFull] = useState(false);
  const submitInput = () => {
    if (!busy) {
      void send(input);
      return;
    }
    const r = questionQueue.add(input);
    if (r.ok) {
      setInput('');
      setQueueFull(false);
    } else if (r.reason === 'full') {
      setQueueFull(true);
    }
  };

  /**
   * ⚠️ ЗӨВХӨН ҮҮСГЭЛТИЙГ ДАХИН (§21).  Хэл, санаа, олдсон эх сурвалж,
   *    ERP-ийн үр дүн бүгд ХҮЧИНТЭЙ хэвээр байхад тэднийг дахин
   *    ажиллуулах нь цэвэр алдагдал — ялангуяа нормын хайлт нь
   *    ажилтны диск рүү ханддаг.  `cacheRef` нь тэр үр дүнг хадгална.
   */
  const retryGeneration = useCallback(
    (aiMsgUid: string) => {
      const last = lastQuestionRef.current;
      if (last === null || cacheRef.current === undefined) return;
      void send(last.q, { generationOnly: true, aiMsgUid });
    },
    [send],
  );

  /**
   * ⚠️ ЭДГЭЭР `useCallback` НЬ ЧИМЭГЛЭЛ БИШ, ГҮЙЦЭТГЭЛИЙН ШААРДЛАГА.
   *
   *    `MessageBubble` нь `memo`-логдсон: props нь ХӨДӨЛДӨГГҮЙ бол
   *    дахин рендерлэгдэхгүй.  Хэрэв энд шинэ функц бүр рендерт
   *    үүсвэл `memo` нь ХЭЗЭЭ Ч ажиллахгүй ба токен бүрд 40 мессеж
   *    дахин рендерлэгдэнэ — §25-ийн яг тэр гажиг.
   */
  const handleVoted = useCallback((msgUid: string, vote: 1 | -1) => {
    setMessages((prev) => prev.map((x) => (x.msgUid === msgUid ? { ...x, vote } : x)));
  }, []);

  /** ⚠️ БОДИТ төлөв, цагийн таамаг БИШ (§5). */
  const modelState = modelStateOf(runtime);

  /**
   * ⚠️ ЗАГВАР БЭЛТГЭГДЭЖ БАЙХ МӨР — `useMemo`-ТОЙ.  Мөр өөрөө хямд ч
   *    `MessageBubble`-ийн props болох тул тогтмол лавлагаа байх ёстой.
   */
  const loadingLabel = useMemo(
    () =>
      modelState === 'MODEL_LOADING' || modelState === 'STARTING'
        ? MODEL_STATE_LABEL[modelState]
        : 'MGL AI ажиллаж байна…',
    [modelState],
  );

  /* ── Дэлгэц ───────────────────────────────────────────────────── */

  if (sessionError) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card className="p-6">
          <h1 className="text-lg font-semibold">MGL AI</h1>
          <p className="mt-2 text-sm text-muted-foreground">{sessionError}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-6xl gap-3 p-4">
      {/* ⚠️ Түүх нь ЖИЖИГ дэлгэцэд нуугдана — чат өөрөө үндсэн зорилго. */}
      <div className="hidden md:flex">
        <ChatHistory
          activeUid={convUid}
          onSelect={(uid) => void openConversation(uid)}
          onNew={newChat}
          refreshKey={historyKey}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
      {/* Толгой */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" aria-hidden />
          <h1 className="text-lg font-semibold">{session?.model.display_name ?? 'MGL AI'}</h1>
          {session && (
            <Badge variant="secondary" className="text-[11px] font-normal">
              {session.mode === 'admin' ? 'админ' : session.mode === 'client' ? 'захиалагч' : 'ажилтан'}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <MemoryPanel items={memories} onRemove={(id) => persistMemories(removeMemory(memories, id))} />
          <Button size="sm" variant="outline" className="gap-1" onClick={newChat}>
            <Plus className="size-3.5" aria-hidden />
            Шинэ яриа
          </Button>
        </div>
      </div>

      <RuntimeGate
        probe={runtime}
        serverModel={session?.model ?? null}
        onRefresh={() => refreshRuntime(false)}
        onConnect={() => refreshRuntime(true)}
      />

      {/* Мессежүүд */}
      <div
        ref={scroll.containerRef}
        className="flex-1 space-y-4 overflow-y-auto rounded-lg border bg-card/40 p-4"
      >
        {messages.length === 0 && (
          <div className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Монголоор асууж болно. Компанийн мэдээллийг амьд өгөгдлөөс, нормыг баталгаажсан
              эх сурвалжаас хариулна.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS_MN.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="outline"
                  className="h-auto whitespace-normal py-1.5 text-xs"
                  onClick={() => void send(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          /**
           * ⚠️ БӨМБӨЛӨГ БҮР `memo`-ЛОГДСОН (§25).  Урсаж буй мессежид Л
           *    `live` дамжина; бусдад `null` — тэдгээрийн props нь
           *    ХӨДӨЛДӨГГҮЙ тул React тэднийг БҮРЭН алгасна.  Өмнө нь
           *    бүх бөмбөлөг энэ файлд ШУУД бичигдсэн байсан тул токен
           *    бүрд БҮХ түүх дахин рендерлэгддэг байв.
           */
          <MessageBubble
            key={m.msgUid}
            message={m}
            live={m.streaming ? activeRun : null}
            convUid={convUid}
            loadingLabel={loadingLabel}
            onRetry={retryGeneration}
            onVoted={handleVoted}
          />
        ))}


      </div>

      {/* Асуултын дараалал */}
      {questionQueue.queue.length > 0 && (
        <div
          className="rounded-lg border bg-muted/30 p-2"
          role="region"
          aria-label={lang === 'en' ? 'Question queue' : 'Асуултын дараалал'}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-label font-medium">
              {lang === 'en'
                ? `Queued: ${questionQueue.queue.length} — answered one by one`
                : `Дараалалд ${questionQueue.queue.length} асуулт — нэг нэгээр хариулна`}
            </span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-micro" onClick={questionQueue.clear}>
              {lang === 'en' ? 'Clear' : 'Цэвэрлэх'}
            </Button>
          </div>
          <ol className="space-y-1">
            {questionQueue.queue.map((item, i) => (
              <li key={item.id} className="flex items-center gap-2 rounded-md bg-background px-2 py-1 text-sm">
                <span className="w-5 shrink-0 text-center text-micro text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate" title={item.text}>
                  {item.text}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 shrink-0 p-0"
                  aria-label={lang === 'en' ? 'Remove from queue' : 'Дарааллаас хасах'}
                  onClick={() => questionQueue.remove(item.id)}
                >
                  <X className="size-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {queueFull && (
        <p role="alert" className="text-micro text-warning">
          {lang === 'en'
            ? `The queue is full (${MAX_QUEUED_QUESTIONS}). Wait for an answer or clear the queue.`
            : `Дараалал дүүрсэн (${MAX_QUEUED_QUESTIONS}). Хариулт гартал хүлээх эсвэл дарааллыг цэвэрлэнэ үү.`}
        </p>
      )}

      {/* Оролт */}
      <div className="flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (queueFull) setQueueFull(false);
          }}
          onKeyDown={(e) => {
            // IME (монгол/хятад) сонголтын Enter-ийг илгээлт гэж ТООЦОХГҮЙ.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submitInput();
            }
          }}
          placeholder={
            busy
              ? lang === 'en'
                ? 'Answering… type your next question — it will be queued'
                : 'Хариулж байна… дараагийн асуултаа бичээрэй — дараалалд орно'
              : lang === 'en'
                ? 'Ask in Mongolian or English…'
                : 'Монголоор бичнэ үү…'
          }
          rows={2}
          className="resize-none"
        />
        {busy ? (
          <div className="flex flex-col gap-1">
            <Button
              className="gap-1"
              onClick={submitInput}
              disabled={input.trim().length === 0 || questionQueue.queue.length >= MAX_QUEUED_QUESTIONS}
            >
              <ListPlus className="size-3.5" aria-hidden />
              {lang === 'en' ? 'Add to queue' : 'Дараалалд'}
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => abortRef.current?.abort()}>
              <Square className="size-3.5" aria-hidden />
              Зогсоох
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Button className="gap-1" onClick={submitInput} disabled={input.trim().length === 0}>
              <Send className="size-3.5" aria-hidden />
              Илгээх
            </Button>
            {messages.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-2 text-xs"
                onClick={() => {
                  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
                  if (lastUser) {
                    // ⚠️ Ref-ийг СИНХРОНООР шинэчилнэ — `send` дараагийн рендерийг хүлээхгүй
                    //    тул `setMessages` ганцаараа хангалтгүй (хуучин closure-ийн алдаа).
                    const trimmed = messages.slice(0, messages.length - 2);
                    messagesRef.current = trimmed;
                    setMessages(trimmed);
                    void send(lastUser.content);
                  }
                }}
              >
                <RotateCcw className="size-3" aria-hidden />
                Дахин
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
