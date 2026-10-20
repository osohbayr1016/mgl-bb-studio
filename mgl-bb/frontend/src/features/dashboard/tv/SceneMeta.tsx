/**
 * Кадрын тайлбарын мөр — «энэ юуны график вэ» гэсэн асуултын хариу.
 *
 * ЯАГААД БАЙХ ЁСТОЙ ВЭ: лоббид зогсож байгаа хүн график руу 3-5 секунд
 * хардаг.  Хугацааны цонх, хэмжигдэхүүний тодорхойлолт хоёрыг мэдэхгүй бол
 * ямар ч муруй утгагүй — «сүүлийн 30 хоног уу, эсвэл жилийн эхнээс үү?»,
 * «энэ хувь нь юуны хувь вэ?» гэдэг нь дэлгэц дээр ил бичигдээгүй бол хэн ч
 * таамаглаж чадахгүй.  Өмнө нь Багуудын явц болон 30 хоногийн идэвхжил хоёр
 * хоёулаа зөвхөн муруй + өдрийн дугаартай байсан.
 *
 * ЗОХИОМЖ: хайрцаг БИШ — доод талдаа үсний ширхэг шугамтай label/value хос,
 * `theme.ts`-ийн mono metadata хэвээр.  Кадрын биеийн дээд талд сууна.
 */
import { TV, metaStyle } from './theme';

export interface SceneMetaItem {
  /** Шошгогүй байж болно — жишээ нь «НЭГДСЭН ЯВЦ» гэсэн хэмжигдэхүүний нэр
   *  ганцаараа (эзний 2026-09-10-ны шийдвэрээр «ХЭМЖИГДЭХҮҮН» шошго устсан). */
  label?: string;
  value: string;
  /** Утгыг онцлох өнгө (жишээ нь «өнөөдөр»).  Өгөөгүй бол ink2. */
  tone?: string;
}

export function SceneMeta({ items }: { items: SceneMetaItem[] }) {
  return (
    <div
      className="flex shrink-0 flex-wrap items-baseline gap-x-[2.6vw] gap-y-[0.8vh] pb-[1.4vh]"
      style={{ borderBottom: `1px solid ${TV.line}` }}
    >
      {items.map((it) => (
        <div key={it.label ?? it.value} className="flex items-baseline gap-[0.6vw]">
          {it.label && <span style={{ ...metaStyle, color: TV.ink3 }}>{it.label}</span>}
          <span style={{ ...metaStyle, color: it.tone ?? TV.ink2, letterSpacing: '0.1em' }}>
            {it.value}
          </span>
        </div>
      ))}
    </div>
  );
}
