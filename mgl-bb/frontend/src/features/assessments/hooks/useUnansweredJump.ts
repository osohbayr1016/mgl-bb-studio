import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AssessmentAnswers } from '../types';
import type { AssessmentPageDef } from '../components/SectionPage';
import { nextUnansweredFrom, rowSelector } from '../lib/progress';

interface Options {
  pages: AssessmentPageDef[];
  answers: AssessmentAnswers;
  pageIndex: number;
  reduceMotion: boolean | null;
  goTo: (next: number, dir: 1 | -1) => void;
}

export function useUnansweredJump({
  pages,
  answers,
  pageIndex,
  reduceMotion,
  goTo,
}: Options) {
  const [highlightRequested, setHighlightUnanswered] = useState(false);
  const [spotlightTarget, setSpotlightId] = useState<string | null>(null);
  const [jumpTick, setJumpTick] = useState(0);

  // Highlight ба spotlight-ыг effect-ээр цэвэрлэхийн оронд render дээр
  // гаргаж авна — cascading render үүсэхгүй.
  const hasUnanswered = useMemo(
    () => nextUnansweredFrom(pages, answers, 0) !== null,
    [pages, answers],
  );

  /** Бүрэн бөглөгдсөн бол highlight автоматаар унтарна. */
  const highlightUnanswered = highlightRequested && hasUnanswered;

  /** Хариулт өгмөгц spotlight арилна. */
  const spotlightId = spotlightTarget && answers[spotlightTarget] ? null : spotlightTarget;

  const jumpRef = useRef<string | null>(null);
  const skipTopScrollRef = useRef(false);
  const jumpFromOtherPageRef = useRef(false);

  const jumpToUnanswered = useCallback(() => {
    const target = nextUnansweredFrom(pages, answers, pageIndex);
    if (!target) return;
    setHighlightUnanswered(true);
    setSpotlightId(target.itemId);
    jumpRef.current = target.itemId;
    if (target.pageIndex !== pageIndex) {
      jumpFromOtherPageRef.current = true;
      skipTopScrollRef.current = true;
      goTo(target.pageIndex, target.pageIndex > pageIndex ? 1 : -1);
    } else {
      setJumpTick((n) => n + 1);
    }
  }, [pages, answers, pageIndex, goTo]);

  // Jump effect — хуудас солигдсон эсвэл ижил хуудсан дээр tick.
  useEffect(() => {
    const itemId = jumpRef.current;
    if (!itemId) return;

    const delay = reduceMotion ? 150 : jumpFromOtherPageRef.current ? 320 : 0;
    jumpFromOtherPageRef.current = false;

    const timer = window.setTimeout(() => {
      requestAnimationFrame(() => {
        const el = document.querySelector(rowSelector(itemId));
        if (!el) {
          jumpRef.current = null;
          return;
        }
        el.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'center',
        });
        el.querySelector<HTMLInputElement>('input[type="radio"]')?.focus({ preventScroll: true });
        jumpRef.current = null;
      });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [pageIndex, jumpTick, reduceMotion]);

  return {
    highlightUnanswered,
    setHighlightUnanswered,
    spotlightId,
    jumpRef,
    skipTopScrollRef,
    jumpToUnanswered,
  };
}
