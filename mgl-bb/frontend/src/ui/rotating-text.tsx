/**
 * RotatingText — үг/өгүүлбэрийг тэмдэгт тус бүрээр нь анимацлан солих текст.
 *
 * Эх сурвалж: reactbits.dev (RotatingText, JavaScript + CSS хувилбар).
 * Энэ репод буулгахдаа ХОЁР зүйлийг өөрчилсөн:
 *
 *  1. **TypeScript + Tailwind.** Эх хувилбар нь `.jsx` + дагалдах `RotatingText.css`
 *     файлтай. `src/ui/`-д CSS файл байдаггүй (бүх примитив Tailwind-аар бичигдсэн)
 *     тул тэр 6 дүрмийг ангиуд болгож шингээв:
 *       .text-rotate         → relative inline-flex flex-wrap whitespace-pre-wrap
 *       .text-rotate-sr-only → sr-only
 *       .text-rotate-word    → inline-flex
 *       .text-rotate-lines   → flex w-full flex-col
 *       .text-rotate-element → inline-block
 *       .text-rotate-space   → whitespace-pre
 *
 *  2. **Хөдөлгөөнд мэдрэг хэрэглэгчийг хүндэтгэнэ.** Эх хувилбар нь `auto` үед
 *     ХЭЗЭЭ Ч зогсдоггүй `setInterval`-тай. Тасралтгүй эргэлдэх текст нь
 *     vestibular эмгэгтэй хүнд бэрхшээл учруулдаг тул `prefers-reduced-motion`
 *     тохируулсан үед эргэлт огт эхлэхгүй, эхний текст л хөдөлгөөнгүй харагдана.
 *     Аппын бусад хэсэг (`useReducedMotion`) мөн ижил зарчимтай.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
} from 'react';
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react';

import { cn } from '@/shared/lib/utils';

type SplitBy = 'characters' | 'words' | 'lines' | (string & {});
type StaggerFrom = 'first' | 'last' | 'center' | 'random' | number;

export interface RotatingTextHandle {
  next: () => void;
  previous: () => void;
  jumpTo: (index: number) => void;
  reset: () => void;
}

export interface RotatingTextProps
  extends Omit<ComponentPropsWithoutRef<typeof motion.span>, 'children'> {
  /** Ээлжлэн харагдах текстүүд. Хоосон массив бол юу ч гарахгүй. */
  texts: string[];
  rotationInterval?: number;
  animatePresenceMode?: 'wait' | 'sync' | 'popLayout';
  animatePresenceInitial?: boolean;
  staggerDuration?: number;
  staggerFrom?: StaggerFrom;
  loop?: boolean;
  auto?: boolean;
  splitBy?: SplitBy;
  onNext?: (index: number) => void;
  mainClassName?: string;
  splitLevelClassName?: string;
  elementLevelClassName?: string;
}

/**
 * Эможи/лигатурыг задлахгүйгээр тэмдэгтэд хуваах.
 *
 * ⚠️ `Intl.Segmenter` нь энэ төслийн TS `lib` зорилтод (ES2021) БАЙХГҮЙ тул
 * шууд бичвэл эмхэтгэгдэхгүй. Репо даяар `lib`-ийг ахиулах нь энэ жижиг
 * компонентын төлөө хэт том өөрчлөлт учир орон нутгийн төрлөөр тодорхойлж,
 * ажиллах үедээ БАЙГАА эсэхийг шалгана (дэмжигдээгүй хөтөч дээр `Array.from`).
 */
type SegmenterCtor = new (
  locale?: string,
  options?: { granularity?: 'grapheme' | 'word' | 'sentence' },
) => { segment: (input: string) => Iterable<{ segment: string }> };

function splitIntoCharacters(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (typeof Segmenter === 'function') {
    return Array.from(new Segmenter('en', { granularity: 'grapheme' }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

export const RotatingText = forwardRef<RotatingTextHandle, RotatingTextProps>(
  function RotatingText(
    {
      texts,
      transition = { type: 'spring', damping: 25, stiffness: 300 },
      initial = { y: '100%', opacity: 0 },
      animate = { y: 0, opacity: 1 },
      exit = { y: '-120%', opacity: 0 },
      animatePresenceMode = 'wait',
      animatePresenceInitial = false,
      rotationInterval = 2000,
      staggerDuration = 0,
      staggerFrom = 'first',
      loop = true,
      auto = true,
      splitBy = 'characters',
      onNext,
      mainClassName,
      splitLevelClassName,
      elementLevelClassName,
      ...rest
    },
    ref,
  ) {
    const [currentTextIndex, setCurrentTextIndex] = useState(0);
    const reduceMotion = useReducedMotion();

    const elements = useMemo(() => {
      const currentText = texts[currentTextIndex] ?? '';
      if (splitBy === 'characters') {
        const words = currentText.split(' ');
        return words.map((word, i) => ({
          characters: splitIntoCharacters(word),
          needsSpace: i !== words.length - 1,
        }));
      }
      const parts =
        splitBy === 'words'
          ? currentText.split(' ')
          : splitBy === 'lines'
            ? currentText.split('\n')
            : currentText.split(splitBy);
      return parts.map((part, i, arr) => ({
        characters: [part],
        needsSpace: i !== arr.length - 1,
      }));
    }, [texts, currentTextIndex, splitBy]);

    const getStaggerDelay = useCallback(
      (index: number, total: number) => {
        if (staggerFrom === 'first') return index * staggerDuration;
        if (staggerFrom === 'last') return (total - 1 - index) * staggerDuration;
        if (staggerFrom === 'center') {
          return Math.abs(Math.floor(total / 2) - index) * staggerDuration;
        }
        if (staggerFrom === 'random') {
          return Math.abs(Math.floor(Math.random() * total) - index) * staggerDuration;
        }
        return Math.abs(staggerFrom - index) * staggerDuration;
      },
      [staggerFrom, staggerDuration],
    );

    const handleIndexChange = useCallback(
      (newIndex: number) => {
        setCurrentTextIndex(newIndex);
        onNext?.(newIndex);
      },
      [onNext],
    );

    const next = useCallback(() => {
      const nextIndex =
        currentTextIndex === texts.length - 1
          ? loop
            ? 0
            : currentTextIndex
          : currentTextIndex + 1;
      if (nextIndex !== currentTextIndex) handleIndexChange(nextIndex);
    }, [currentTextIndex, texts.length, loop, handleIndexChange]);

    const previous = useCallback(() => {
      const prevIndex =
        currentTextIndex === 0 ? (loop ? texts.length - 1 : currentTextIndex) : currentTextIndex - 1;
      if (prevIndex !== currentTextIndex) handleIndexChange(prevIndex);
    }, [currentTextIndex, texts.length, loop, handleIndexChange]);

    const jumpTo = useCallback(
      (index: number) => {
        const valid = Math.max(0, Math.min(index, texts.length - 1));
        if (valid !== currentTextIndex) handleIndexChange(valid);
      },
      [texts.length, currentTextIndex, handleIndexChange],
    );

    const reset = useCallback(() => {
      if (currentTextIndex !== 0) handleIndexChange(0);
    }, [currentTextIndex, handleIndexChange]);

    useImperativeHandle(ref, () => ({ next, previous, jumpTo, reset }), [
      next,
      previous,
      jumpTo,
      reset,
    ]);

    useEffect(() => {
      // ⚠️ Хөдөлгөөнд мэдрэг хэрэглэгчид эргэлт ОГТ эхлэхгүй (дээрх тайлбар).
      if (!auto || reduceMotion) return;
      const id = setInterval(next, rotationInterval);
      return () => clearInterval(id);
    }, [next, rotationInterval, auto, reduceMotion]);

    const totalChars = elements.reduce((sum, w) => sum + w.characters.length, 0);

    return (
      <motion.span
        className={cn(
          'relative inline-flex flex-wrap whitespace-pre-wrap',
          mainClassName,
        )}
        {...rest}
        layout
        transition={transition as Transition}
      >
        {/* Дэлгэц уншигчид — анимацлагдсан хэсэг `aria-hidden`. */}
        <span className="sr-only">{texts[currentTextIndex]}</span>
        <AnimatePresence mode={animatePresenceMode} initial={animatePresenceInitial}>
          <motion.span
            key={currentTextIndex}
            /*
              ⚠️ ДОТООД давхаргад ч `mainClassName`-ийг дамжуулна. Эх хувилбар
              үүнийг хийдэггүй тул гаднаас `flex-nowrap` өгсөн ч дотоод сав
              `flex-wrap` хэвээр үлдэж, нарийн хайрцагт тэмдэгт бүр өөр мөрөнд
              буудаг байв (2026-08-13-нд брэндийн нэр дээр илэрсэн).
            */
            className={cn(
              splitBy === 'lines'
                ? 'flex w-full flex-col'
                : 'relative inline-flex flex-wrap whitespace-pre-wrap',
              mainClassName,
            )}
            layout
            aria-hidden="true"
          >
            {elements.map((wordObj, wordIndex, array) => {
              const previousCharsCount = array
                .slice(0, wordIndex)
                .reduce((sum, w) => sum + w.characters.length, 0);
              return (
                <span key={wordIndex} className={cn('inline-flex', splitLevelClassName)}>
                  {wordObj.characters.map((char, charIndex) => (
                    <motion.span
                      key={charIndex}
                      initial={initial}
                      animate={animate}
                      exit={exit}
                      transition={{
                        ...(transition as Transition),
                        delay: getStaggerDelay(previousCharsCount + charIndex, totalChars),
                      }}
                      className={cn('inline-block', elementLevelClassName)}
                    >
                      {char}
                    </motion.span>
                  ))}
                  {wordObj.needsSpace && <span className="whitespace-pre"> </span>}
                </span>
              );
            })}
          </motion.span>
        </AnimatePresence>
      </motion.span>
    );
  },
);

export default RotatingText;
