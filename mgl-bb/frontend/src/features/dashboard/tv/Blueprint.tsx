/**
 * TV самбарын суурь гадаргуу — техникийн зургийн хуудас.
 *
 * Энэ нь өмнөх хоёр `blur-[140px]` өнгөт бөмбөлгийг ОРЛОНО.  Тэдгээр
 * бөмбөлөг нь ямар ч ерөнхий dashboard дээр байдаг чимэглэл бөгөөд
 * инженерийн компанид ямар ч утга агуулаагүй.  Оронд нь:
 *
 *   1. Зургийн тор — нарийн модуль + 5 тутам бүдүүн шугам (миллиметрийн цаас).
 *   2. Булангийн зэрэгцүүлэх тэмдэг (registration mark) — хэвлэлийн хуудасны
 *      дөрвөн буланд байдаг загалмай.
 *   3. Төвийг тодруулах vignette — тор ирмэг рүүгээ бүдгэрч, контент дээр
 *      харагдац саадгүй болно.
 *
 * Тор нь CSS gradient-ээр зурагдана (DOM зангилаа нэмэхгүй), registration
 * mark нь ганц inline SVG.  24/7 ажиллах kiosk тул анимаци огт байхгүй —
 * зөвхөн PixelShift давхарга бүхнийг аажим хөдөлгөнө (burn-in-ээс хамгаална).
 */
import { useEffect, useState } from 'react';
import { TV } from './theme';

/** Торны нэг модулийн хэмжээ (px).  1080p дээр 5 модуль = 200px бүдүүн нүд. */
const MODULE = 40;

export function BlueprintSurface() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* Нарийн тор — модуль тутам. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, ${TV.gridFine} 1px, transparent 1px),
            linear-gradient(to bottom, ${TV.gridFine} 1px, transparent 1px)
          `,
          backgroundSize: `${MODULE}px ${MODULE}px`,
        }}
      />
      {/* Бүдүүн тор — 5 модуль тутам. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, ${TV.gridBold} 1px, transparent 1px),
            linear-gradient(to bottom, ${TV.gridBold} 1px, transparent 1px)
          `,
          backgroundSize: `${MODULE * 5}px ${MODULE * 5}px`,
        }}
      />
      {/* Vignette — тор ирмэгтээ л харагдаж, төв нь цэвэр байна. */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 75% 65% at 50% 45%, ${TV.bg} 20%, transparent 100%)`,
        }}
      />
      {/* Дээд/доод ирмэгийн зөөлөн бараан — гарчиг, үндсэн бичээс тод болно. */}
      <div
        className="absolute inset-x-0 top-0 h-[22vh]"
        style={{ background: `linear-gradient(to bottom, ${TV.bg}, transparent)` }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-[18vh]"
        style={{ background: `linear-gradient(to top, ${TV.bg}, transparent)` }}
      />
      <RegistrationMarks />
    </div>
  );
}

/** Дөрвөн буланд зэрэгцүүлэх загалмай — хэвлэлийн хуудасны тэмдэглэгээ. */
function RegistrationMarks() {
  const positions = [
    { top: '2.2vh', left: '1.6vw' },
    { top: '2.2vh', right: '1.6vw' },
    { bottom: '2.2vh', left: '1.6vw' },
    { bottom: '2.2vh', right: '1.6vw' },
  ] as const;
  return (
    <>
      {positions.map((pos, i) => (
        <svg
          key={i}
          className="absolute"
          style={{ ...pos, width: '1.6vw', height: '1.6vw' }}
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle cx="12" cy="12" r="7" stroke={TV.line} strokeWidth="1" />
          <path d="M12 0v24M0 12h24" stroke={TV.line} strokeWidth="1" />
        </svg>
      ))}
    </>
  );
}

/**
 * Burn-in-ээс хамгаалах давхарга.
 *
 * Зурагт 24/7 асаалттай байх тул тогтмол байрлалд байгаа тод элемент (лого,
 * цаг, гарчиг) дэлгэцэнд хөшиж үлддэг.  Энэ бүрхүүл бүх контентоо 90 секунд
 * тутам ±4px-ээр аажим шилжүүлнэ — нүдэнд мэдэгдэхгүй ч пиксел солигдоно.
 *
 * `transition` нь 8 секундын турш үргэлжилдэг тул шилжилт нь харагдахгүй.
 */
export function PixelShift({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % SHIFT_PATH.length), SHIFT_MS);
    return () => clearInterval(id);
  }, []);
  const [x, y] = SHIFT_PATH[step]!;
  return (
    <div
      className="absolute inset-0"
      style={{ transform: `translate(${x}px, ${y}px)`, transition: 'transform 8s linear' }}
    >
      {children}
    </div>
  );
}

/** Шилжилтийн зам — 4 булангаар аажим тойрно.  Далд байлгахын тулд ±4px. */
const SHIFT_PATH: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [4, 2],
  [2, 4],
  [-2, 3],
  [-4, 0],
  [-2, -3],
  [2, -4],
  [4, -2],
];
const SHIFT_MS = 90_000;
