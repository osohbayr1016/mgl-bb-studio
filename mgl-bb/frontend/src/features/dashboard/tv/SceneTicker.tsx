/**
 * Кадрын үлдсэн хугацааг харуулах үсний ширхэг шугам.
 *
 * Дэлгэцийн хамгийн доод ирмэгт, 2px өндөртэй.  Өмнөх 4px өнгөт бар нь
 * ирмэгийг тасалж байсан; түүнээс хойш доор нь суудаг байсан «зургийн үндсэн
 * бичээсийн хүснэгт» нь 2026-08-19-нд бүтнээрээ устсан (хэрэглэгчийн шийдвэр —
 * самбарт илүүц мэдээлэл байв), тул энэ шугам одоо ганцаараа үлдэв.
 */
import { TV } from './theme';

export function SceneTicker({
  durationMs,
  resetKey,
  paused,
}: {
  durationMs: number;
  resetKey: string;
  /** Хүн удирдаж байгаа эсвэл түгжээтэй — шугам зогсоно. */
  paused: boolean;
}) {
  // Зогссон үед анимацийг ТҮР ЗОГСООХГҮЙ, өөр элемент рүү сольж байна.
  // Шалтгаан: эргэлт үргэлжлэхэд JS тоолуур ТЭГЭЭС эхэлдэг тул CSS анимаци
  // зогссон байрнаасаа үргэлжилбэл шугам тоолуураас түрүүлж дүүрнэ.  Өөр
  // элемент рүү солиход React зангилааг дахин холбож, анимаци мөн адил
  // эхнээсээ эхэлнэ — хоёул синхрон болно.
  if (paused) {
    return (
      <div className="shrink-0" style={{ height: '2px', background: TV.line }}>
        <div style={{ height: '100%', background: TV.gold, opacity: 0.55 }} />
      </div>
    );
  }
  return (
    <div className="shrink-0" style={{ height: '2px', background: TV.line }}>
      <div
        key={resetKey}
        style={{
          height: '100%',
          transformOrigin: 'left',
          background: `linear-gradient(to right, ${TV.accent}, ${TV.accentSoft})`,
          animation: `tvSceneBar ${durationMs}ms linear forwards`,
        }}
      />
    </div>
  );
}
