import type {
  IzReportAnswers,
  IzZoneRow,
} from '@/features/projects/team-reports/iz/types';
import { makeDocHelpers, type DocMode } from '@/features/projects/team-reports/docHelpers';
import { useDrawingRows } from '@/features/projects/team-reports/drawingList';
import { T } from '@/features/performance-reports/lib/reportText';

/* =============================================================
 * IZ (Интерьер зураг) report printable document.
 * -------------------------------------------------------------
 * Концепц → бүс бүрийн өнгөлгөө, тоноглолын narrative → 3D рендерийн индекс →
 * зургийн жагсаалт. Бодит MGL интерьер тайлангийн бүтэцтэй ижил.
 * Хоосон хэсгүүд харагдахгүй (хагас бөглөсөн ноорог цэвэрхэн).
 * -------------------------------------------------------------
 * A4 ХУУДАСЛАЛТ (`data-a4-item`)
 * -------------------------------------------------------------
 * Гүйцэтгэлийн тайлангийн `A4Paginator` нь `[data-a4-item]`-ээр
 * тэмдэглэсэн элементийг хуудасны заагт унавал дараагийн хуудас руу
 * түлхдэг.  Тэмдэглэгээгүй агуулга цаасны ирмэгийг давж хуудас
 * хоорондын цоорхойд бичигдэнэ.
 *
 * ⚠️ Энэ бичиг баримтын БҮХ хэсэг ХЯЗГААРГҮЙ УРТ байж болно (бүс, давхар,
 * зургийн мөрийг хэрэглэгч/админ дурын тоогоор нэмнэ; концепц нь чөлөөт
 * текст).  Иймд ЖИЖИГ нэгжээр тэмдэглэв: гарчиг тус тусдаа, бүс бүр,
 * давхар бүр, жагсаалтын мөр бүр.  Гарчгийг доорх блоктойгоо БҮЛЭГЛЭВЭЛ
 * тэр бүлэг нэг A4-ээс урт болж, paginator түлхэхээ болино (нэг хуудсанд
 * багтахгүй нэгжийг тасрахыг зөвшөөрдөг) — яг тэр үед агуулга цаасны
 * ирмэгээс давж бичигддэг.
 * ⚠️ ҮҮРЛЭСЭН `data-a4-item` хийхгүй: бүсийн дотоод `<li>`-үүд бүсийнхээ
 * нэгжид багтдаг тул тэмдэглэхгүй.
 *
 * СТАТИК ТЕКСТ (`<T>`)
 * -------------------------------------------------------------
 * Хатуу бичигдсэн шошго/гарчгийг `<T k="iz.…">`-ээр боов —
 * гүйцэтгэлийн тайлангийн засварлах горимд хэрэглэгч өөрчилнө.
 * Provider байхгүй үед (Багийн тайлангийн таб) энгийн текст рүү
 * уначих тул тэнд харагдац ЯГ ХЭВЭЭР.
 * ============================================================= */

const ZONE_FACETS: ReadonlyArray<{ key: keyof Omit<IzZoneRow, 'name'>; label: string }> = [
  { key: 'wall', label: 'Хана' },
  { key: 'floor', label: 'Шал' },
  { key: 'ceiling', label: 'Тааз' },
  { key: 'lighting', label: 'Гэрэлтүүлэг' },
  { key: 'doors', label: 'Хаалга, цонх' },
  { key: 'furniture', label: 'Тавилга' },
  { key: 'fixtures', label: 'Тоноглол (АЦӨ)' },
  { key: 'general', label: 'Ерөнхий шийдэл' },
];

const DRAWING_LIST_ROWS: Array<{ no: number; key: keyof IzReportAnswers; label: string }> = [
  { no: 1, key: 'dl_wall_model', label: 'Хана модельчлох' },
  { no: 2, key: 'dl_floor_model', label: 'Шал модельчлох' },
  { no: 3, key: 'dl_ceiling_model', label: 'Тааз модельчлох' },
  { no: 4, key: 'dl_furniture_model', label: 'Тавилга модельчлох' },
  { no: 5, key: 'dl_demo_wall_layout', label: 'Нураах ханын байгуулалт' },
  { no: 6, key: 'dl_main_layout', label: 'Үндсэн байгуулалт' },
  { no: 7, key: 'dl_ceiling_layout', label: 'Таазны байгуулалт' },
  { no: 8, key: 'dl_floor_layout', label: 'Шалны байгуулалт' },
  { no: 9, key: 'dl_lighting_layout', label: 'Гэрлийн байгуулалт' },
  { no: 10, key: 'dl_furniture_layout', label: 'Тавилгын байгуулалт' },
  { no: 11, key: 'dl_sockets_switches', label: 'Розетка, унтраалга' },
  { no: 12, key: 'dl_comms_alarm', label: 'Холбоо дохиолол' },
  { no: 13, key: 'dl_wall_elevations', label: 'Ханын дэлгээс' },
  { no: 14, key: 'dl_furniture_details', label: 'Тавилгын хэсэгчилсэн зураг' },
  { no: 15, key: 'dl_ceiling_wall_sections', label: 'Тааз, хана хэсэгчлэл' },
  { no: 16, key: 'dl_quantities', label: 'Тоо хэмжээ' },
];

const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');

interface IzReportDocumentProps {
  answers: IzReportAnswers;
  mode?: DocMode;
}

export function IzReportDocument({ answers, mode = 'internal' }: IzReportDocumentProps) {
  const { v } = makeDocHelpers(mode);
  // Нийтлэг нэмэлт мөр + нэрийн override-тэй эцсийн зургийн жагсаалт.
  const drawingRows = useDrawingRows('IZ', DRAWING_LIST_ROWS);
  const answerOf = answers as Record<string, unknown>;

  const zones = (answers.iz_zones ?? []).filter(
    (z) => z && (str(z.name) || ZONE_FACETS.some((f) => str(z[f.key]))),
  );
  const floors = (answers.iz_render_index ?? []).filter(
    (fl) => fl && (str(fl.floor) || (fl.areas ?? []).some((a) => str(a.name) || str(a.pages))),
  );
  const totalPages = floors.reduce(
    (sum, fl) => sum + (fl.areas ?? []).reduce((s, a) => s + (Number(a.pages) || 0), 0),
    0,
  );

  return (
    <article className="iz-doc">
      <div data-a4-item>
        <h1 className="iz-doc__title">
          <T k="iz.h.title">ТАЙЛБАР БИЧИГ</T>
        </h1>
        <p className="iz-doc__subtitle">
          <T k="iz.h.subtitle">ИНТЕРЬЕРИЙН ЗУРАГ</T>
        </p>
      </div>

      {str(answers.iz_concept) && (
        <>
          <Heading item>
            <T k="iz.h.concept">ЕРӨНХИЙ ШИЙДЭЛ</T>
          </Heading>
          {/* Концепц нь бүтэн хуудсаас урт байж болох чөлөөт текст тул
              гарчигтайгаа БҮЛЭГЛЭХГҮЙ — тусдаа нэгж. */}
          <Para item>{str(answers.iz_concept)}</Para>
        </>
      )}

      {zones.length > 0 && (
        <>
          <Heading item>
            <T k="iz.h.zones">БҮСЧЛЭЛИЙН ШИЙДЭЛ</T>
          </Heading>
          {zones.map((z, i) => (
            <div key={i} className="iz-doc__zone" data-a4-item>
              <p className="iz-doc__zone-title">{v(z.name, `Бүс ${i + 1}`)}</p>
              <ul className="iz-doc__list iz-doc__facets">
                {ZONE_FACETS.map((f) => {
                  const val = str(z[f.key]);
                  if (!val) return null;
                  return (
                    <li key={f.key}>
                      <strong>
                        <T k={`iz.zone.lbl.${f.key}`}>{f.label}</T>:
                      </strong>{' '}
                      {val}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </>
      )}

      {floors.length > 0 && (
        <>
          <Heading item>
            <T k="iz.h.render_index">3D РЕНДЕРИЙН ИНДЕКС</T>
          </Heading>
          {floors.map((fl, i) => (
            <div key={i} className="iz-doc__zone" data-a4-item>
              <p className="iz-doc__zone-title">
                {v(fl.floor, `Давхар ${i + 1}`)}
                {str(fl.firstPage) && (
                  <span className="iz-doc__muted">
                    {' '}
                    ({str(fl.firstPage)}
                    <T k="iz.lbl.from_page">-р хуудаснаас</T>)
                  </span>
                )}
              </p>
              <ul className="iz-doc__list">
                {(fl.areas ?? []).map((a, ai) => {
                  if (!str(a.name) && !str(a.pages)) return null;
                  return (
                    <li key={ai}>
                      {v(a.name, '—')}
                      {str(a.pages) && (
                        <>
                          {' '}
                          — {str(a.pages)} <T k="iz.lbl.pages">хуудас</T>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {totalPages > 0 && (
            <Para item>
              <strong>
                <T k="iz.lbl.total">Нийт:</T> {totalPages}{' '}
                <T k="iz.lbl.total_pages">хуудас</T>
              </strong>
            </Para>
          )}
        </>
      )}

      {drawingRows.some((r) => answerOf[r.key] === true) && (
        <>
          <Heading item>
            <T k="iz.h.drawing_list">ИНТЕРЬЕРИЙН ЗУРГИЙН ЖАГСААЛТ</T>
          </Heading>
          <ul className="iz-doc__list">
            {drawingRows.filter((r) => answerOf[r.key] === true).map((r) => (
              <li key={r.key} data-a4-item>
                {r.no}. {r.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

/** `item` — A4 хуудаслалтын бие даасан нэгж болгоно (өөр нэгжийн ДОТОР
 *  хэрэггүй: үүрлэсэн `data-a4-item`-ийг paginator хаядаг). */
function Heading({ children, item }: { children: React.ReactNode; item?: boolean }) {
  if (item) {
    return (
      <h2 className="iz-doc__heading" data-a4-item>
        {children}
      </h2>
    );
  }
  return <h2 className="iz-doc__heading">{children}</h2>;
}

function Para({ children, item }: { children: React.ReactNode; item?: boolean }) {
  if (item) {
    return (
      <p className="iz-doc__para" data-a4-item>
        {children}
      </p>
    );
  }
  return <p className="iz-doc__para">{children}</p>;
}

/* Inline CSS — BB-тэй ижил харагдац, өөр class prefix (.iz-doc). */
export const IZ_REPORT_STYLES = `
.iz-doc { font-family: "Arial", Helvetica, sans-serif; color: #111; line-height: 1.55; max-width: 760px; margin: 0 auto; padding: 0 16px; }
.iz-doc__title { text-align: center; font-size: 18pt; font-weight: 700; margin: 0; letter-spacing: 0.06em; }
.iz-doc__subtitle { text-align: center; font-size: 12pt; font-weight: 600; margin: 4px 0 18px; letter-spacing: 0.08em; color: #444; }
.iz-doc__heading { font-size: 12pt; font-weight: 700; text-transform: uppercase; margin: 18px 0 6px; letter-spacing: 0.04em; border-bottom: 1px solid #999; padding-bottom: 3px; }
.iz-doc__para { font-size: 11pt; margin: 6px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
.iz-doc__zone { margin: 8px 0; }
/* ЗАЛГАА бүсүүдийн хооронд нэг мөрийн зай (эхний бүсэд нэмэгдэхгүй). */
.iz-doc__zone + .iz-doc__zone { margin-top: 1em; }
.iz-doc__zone-title { font-size: 11pt; font-weight: 700; margin: 8px 0 2px; }
.iz-doc__muted { font-weight: 400; color: #666; }
.iz-doc__list { font-size: 11pt; margin: 4px 0 6px 18px; padding: 0; }
/* Үргэлжилсэн бичвэр — хоёр талаар тэгшилнэ.  «text-align-last: left» нь
 * сүүлийн мөрийг сунгахгүй.  Монгол бичвэрт «hyphens» ТАВИХГҮЙ — үг
 * таслах дүрэм байхгүй тул буруу таслана. */
.iz-doc__list li { margin: 2px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
.iz-doc__list li + li { margin-top: 0.5em; }
/* Бүсийн тодорхойлолт (Хана / Шал / Тааз / …) бүр нь хэд хэдэн мөр
 * үргэлжлэх тул хооронд нь БҮТЭН нэг мөрийн зай өгнө.  Зөвхөн
 * «margin-top» — доод зайтай давхарлахгүй. */
.iz-doc__facets li + li { margin-top: 1em; }
@media print {
  .iz-doc { max-width: none; padding: 0; }
  .iz-doc__heading { break-after: avoid; }
  .iz-doc__zone, .iz-doc__para, .iz-doc__list { break-inside: avoid-page; }
}
`;
