import type { HdReportAnswers } from '@/features/projects/team-reports/hd/types';
import { makeDocHelpers, type DocMode } from '@/features/projects/team-reports/docHelpers';
import { useDrawingRows } from '@/features/projects/team-reports/drawingList';
import { T } from '@/features/performance-reports/lib/reportText';

/* =============================================================
 * ХД report printable document.  Same conditional-section
 * pattern as the other disciplines. Empty values render as
 * "_____" in internal mode and vanish in client mode (see
 * ../docHelpers).
 * -------------------------------------------------------------
 * A4 ХУУДАСЛАЛТ (`data-a4-item`)
 * -------------------------------------------------------------
 * Гүйцэтгэлийн тайлангийн `A4Paginator` нь `[data-a4-item]`-ээр
 * тэмдэглэсэн элементийг хуудасны заагт унавал дараагийн хуудас руу
 * түлхдэг.  Тэмдэглэгээгүй агуулга цаасны ирмэгийг давж хуудас
 * хоорондын цоорхойд бичигдэнэ — тиймээс энд:
 *   • гарчиг + түүнийг дагасан ХЯЗГААРЛАГДМАЛ жагсаалт = НЭГ нэгж
 *     (гарчиг ганцаараа хуудасны ёроолд үлдэхээс сэргийлнэ),
 *   • чөлөөт текст (answers-ийн narrative) бүр ТУСДАА нэгж,
 *   • зургийн жагсаалт админы нэмсэн мөрөөр УРТСАХ боломжтой
 *     (`team_drawing_items`) тул мөр бүр ТУСДАА нэгж — бүхэлд нь нэг
 *     нэгж болговол нэг A4-ээс урт үед түлхэлт огт ажиллахгүй.
 * ⚠️ ҮҮРЛЭСЭН `data-a4-item` хийхгүй: paginator зөвхөн гаднахыг тооцно.
 *
 * СТАТИК ТЕКСТ (`<T>`)
 * -------------------------------------------------------------
 * Хатуу бичигдсэн шошго/гарчгийг `<T k="hd.…">`-ээр боов —
 * гүйцэтгэлийн тайлангийн засварлах горимд хэрэглэгч өөрчилнө.
 * Provider байхгүй үед (Багийн тайлангийн таб) энгийн текст рүү
 * уначих тул тэнд харагдац ЯГ ХЭВЭЭР.
 * ============================================================= */

const CABLE_TV_LABEL: Record<string, string> = {
  star: 'од хэлбэрийн (star)',
  tree: 'мод хэлбэрийн (tree)',
  mixed: 'холимог',
};

const ACCESS_KIND_LABEL: Record<string, string> = {
  card: 'карт',
  biometric: 'биометр',
  pin: 'PIN код',
  mixed: 'холимог',
};


const DRAWING_LIST_ROWS: Array<{ no: number; key: keyof HdReportAnswers; label: string }> = [
  { no: 1, key: 'dl_cover', label: 'Нүүр хуудас' },
  { no: 2, key: 'dl_drawing_list', label: 'Зургийн жагсаалт' },
  { no: 3, key: 'dl_explanatory_note', label: 'Тайлбар бичиг' },
  { no: 4, key: 'dl_phone_plan', label: 'Утасны сүлжээний төлөвлөгөө' },
  { no: 5, key: 'dl_computer_plan', label: 'Компьютерын сүлжээний төлөвлөгөө' },
  { no: 6, key: 'dl_cctv_plan', label: 'CCTV-ийн төлөвлөгөө' },
  { no: 7, key: 'dl_access_plan', label: 'Нэвтрэх хяналтын төлөвлөгөө' },
  { no: 8, key: 'dl_fa_plan', label: 'Гал дохиоллын төлөвлөгөө' },
  { no: 9, key: 'dl_pa_plan', label: 'Зарлан мэдээллийн төлөвлөгөө' },
  { no: 10, key: 'dl_cable_tv_plan', label: 'Кабелийн ТВ-ийн төлөвлөгөө' },
  { no: 11, key: 'dl_server_room', label: 'Серверийн өрөөний зураг' },
  { no: 12, key: 'dl_riser_diagram', label: 'Босоо шугамын схем' },
  { no: 13, key: 'dl_equipment_schedule', label: 'Тоног төхөөрөмжийн жагсаалт' },
  { no: 14, key: 'dl_details', label: 'Деталь, зангилаа' },
];

interface HdReportDocumentProps {
  answers: HdReportAnswers;
  mode?: DocMode;
}

export function HdReportDocument({ answers, mode = 'internal' }: HdReportDocumentProps) {
  const { withSuffix } = makeDocHelpers(mode);
  const blank = mode === 'client' ? '' : '_____';
  const drawingRows = useDrawingRows('HD', DRAWING_LIST_ROWS);
  const answerOf = answers as Record<string, unknown>;
  return (
    <article className="hd-doc">
      <div data-a4-item>
        <h1 className="hd-doc__title">
          <T k="hd.h.title">ТАЙЛБАР БИЧИГ</T>
        </h1>
        <p className="hd-doc__subtitle">
          <T k="hd.h.subtitle">ХОЛБОО ДОХИОЛОЛ, ДОТООД СҮЛЖЭЭ, ХЯНАЛТ ХАМГААЛАЛТ</T>
        </p>
      </div>

      {(answers.fiber_inlet_cores || answers.fiber_inlet_route) && (
        <>
          <div className="hd-doc__grp" data-a4-item>
            <Heading>
              <T k="hd.h.fiber">ШИЛЭН КАБЕЛЬ</T>
            </Heading>
            <ul className="hd-doc__list">
              {answers.fiber_inlet_cores && (
                <li>
                  <T k="hd.lbl.fiber_cores">Шилэн кабель:</T>{' '}
                  <strong>{withSuffix(answers.fiber_inlet_cores, 'судал')}</strong>.
                </li>
              )}
            </ul>
          </div>
          {answers.fiber_inlet_route && <Para item>{answers.fiber_inlet_route}</Para>}
        </>
      )}

      {(answers.phone_per_office ||
        answers.computer_per_office ||
        answers.network_speed ||
        answers.cable_category) && (
        <div className="hd-doc__grp" data-a4-item>
          <Heading>
            <T k="hd.h.network">УТАС, КОМПЬЮТЕРЫН СҮЛЖЭЭ</T>
          </Heading>
          <ul className="hd-doc__list">
            {answers.phone_per_office && (
              <li>
                <T k="hd.txt.phone_per_office">Оффис бүрд телефоны розетка.</T>
              </li>
            )}
            {answers.phone_separate_service_res && (
              <li>
                <T k="hd.txt.phone_separate">Үйлчилгээ, орон сууцны телефон тусдаа систем.</T>
              </li>
            )}
            {answers.computer_multi_isp && (
              <li>
                <T k="hd.txt.multi_isp">Олон ISP сонголтоор үйлчилнэ.</T>
              </li>
            )}
            {answers.computer_per_office && (
              <li>
                <T k="hd.txt.computer_per_office">Оффис бүрд компьютерын розетка.</T>
              </li>
            )}
            {answers.computer_separate_service_res && (
              <li>
                <T k="hd.txt.computer_separate">
                  Үйлчилгээ, орон сууцны компьютерын сүлжээ тусдаа систем.
                </T>
              </li>
            )}
            {answers.network_speed && (
              <li>
                <T k="hd.lbl.network_speed">Сүлжээний хурд:</T>{' '}
                <strong>{answers.network_speed}</strong>.
              </li>
            )}
            {answers.cable_category && (
              <li>
                <T k="hd.lbl.cable_category">Кабелийн төрөл:</T>{' '}
                <strong>{answers.cable_category}</strong>.
              </li>
            )}
          </ul>
        </div>
      )}

      {(answers.mobile_booster_basement ||
        answers.mobile_booster_high_floors ||
        answers.cable_tv_present) && (
        <div className="hd-doc__grp" data-a4-item>
          <Heading>
            <T k="hd.h.mobile_tv">ГАР УТАСНЫ СҮЛЖЭЭ ӨРГӨГЧ, КАБЕЛИЙН ТВ</T>
          </Heading>
          <ul className="hd-doc__list">
            {answers.mobile_booster_basement && (
              <li>
                <T k="hd.txt.booster_basement">B1/B2 зоорийн давхарт гар утасны сүлжээ өргөгч.</T>
              </li>
            )}
            {answers.mobile_booster_high_floors && (
              <li>
                <T k="hd.txt.booster_high">15-р давхраас дээш гар утасны сүлжээ өргөгч.</T>
              </li>
            )}
            {answers.cable_tv_present && (
              <li>
                <T k="hd.txt.cable_tv">Кабелийн ТВ систем</T>
                {answers.cable_tv_topology && (
                  <>
                    , <strong>{CABLE_TV_LABEL[answers.cable_tv_topology] ?? blank}</strong>{' '}
                    <T k="hd.lbl.cable_tv_topology">топологитой</T>
                  </>
                )}
                .
              </li>
            )}
          </ul>
        </div>
      )}

      {(answers.access_main_entry ||
        answers.access_server_room ||
        answers.access_kind ||
        answers.access_narrative) && (
        <>
          <div className="hd-doc__grp" data-a4-item>
            <Heading>
              <T k="hd.h.access">НЭВТРЭХ ХЯНАЛТЫН СИСТЕМ</T>
            </Heading>
            <ul className="hd-doc__list">
              {answers.access_main_entry && (
                <li>
                  <T k="hd.txt.access_main">Гол орц гарцад нэвтрэх хяналт.</T>
                </li>
              )}
              {answers.access_server_room && (
                <li>
                  <T k="hd.txt.access_server">Серверийн өрөөнд нэвтрэх хяналт.</T>
                </li>
              )}
              {answers.access_comms_rooms && (
                <li>
                  <T k="hd.txt.access_comms">Холбооны өрөөнүүдэд нэвтрэх хяналт.</T>
                </li>
              )}
              {answers.access_auto_unlock_on_fire && (
                <li>
                  <T k="hd.txt.access_fire">Гал гарсан үед автомат нээгдэх.</T>
                </li>
              )}
              {answers.access_kind && (
                <li>
                  <T k="hd.lbl.access_kind">Хяналтын төрөл:</T>{' '}
                  <strong>{ACCESS_KIND_LABEL[answers.access_kind] ?? blank}</strong>.
                </li>
              )}
            </ul>
          </div>
          {answers.access_narrative && <Para item>{answers.access_narrative}</Para>}
        </>
      )}

      {(answers.cctv_camera_count ||
        answers.cctv_nvr_retention_days ||
        answers.cctv_coverage_text) && (
        <>
          <div className="hd-doc__grp" data-a4-item>
            <Heading>
              <T k="hd.h.cctv">ХЯНАЛТЫН КАМЕРЫН СИСТЕМ (CCTV)</T>
            </Heading>
            <ul className="hd-doc__list">
              {answers.cctv_camera_count && (
                <li>
                  <T k="hd.lbl.camera_count">Камерын нийт тоо:</T>{' '}
                  <strong>{withSuffix(answers.cctv_camera_count, 'ширхэг')}</strong>
                  {answers.cctv_camera_min_resolution && (
                    <>
                      <T k="hd.lbl.camera_resolution">, доод нягтрал</T>{' '}
                      <strong>{answers.cctv_camera_min_resolution}</strong>
                    </>
                  )}
                  .
                </li>
              )}
              {answers.cctv_nvr_retention_days && (
                <li>
                  <T k="hd.lbl.nvr_retention">NVR-ийн бичлэг хадгалах хугацаа:</T>{' '}
                  <strong>{withSuffix(answers.cctv_nvr_retention_days, 'хоног')}</strong>.
                </li>
              )}
              {answers.cctv_outdoor_cameras && (
                <li>
                  <T k="hd.txt.cctv_outdoor">
                    Гадна суурилуулсан камерууд (өдөр шөнийн ажиллагаатай, цаг уурын нөхцлөөс
                    хамгаалагдсан).
                  </T>
                </li>
              )}
              {answers.cctv_lift_cabs && (
                <li>
                  <T k="hd.txt.cctv_lift">Цахилгаан шатны кабинд камерууд.</T>
                </li>
              )}
              {answers.cctv_parking && (
                <li>
                  <T k="hd.txt.cctv_parking">Зогсоолд камерууд.</T>
                </li>
              )}
              {answers.cctv_poe_powered && (
                <li>
                  <T k="hd.txt.cctv_poe">Камерууд PoE-ээр тэжээгддэг.</T>
                </li>
              )}
              {answers.cctv_max_cable_run && (
                <li>
                  <T k="hd.lbl.cctv_cable_run">Камерын кабелийн дээд урт:</T>{' '}
                  <strong>{withSuffix(answers.cctv_max_cable_run, 'м')}</strong>.
                </li>
              )}
              {(answers.cctv_monitor_size || answers.cctv_monitor_floor) && (
                <li>
                  <T k="hd.lbl.cctv_monitor">Хяналтын дэлгэц:</T>{' '}
                  <strong>{withSuffix(answers.cctv_monitor_size, 'инч')}</strong>
                  {answers.cctv_monitor_floor && (
                    <>
                      , {answers.cctv_monitor_floor} <T k="hd.lbl.cctv_monitor_floor">давхарт</T>
                    </>
                  )}
                  .
                </li>
              )}
            </ul>
          </div>
          {answers.cctv_coverage_text && <Para item>{answers.cctv_coverage_text}</Para>}
        </>
      )}

      {answers.pa_present && (
        <div className="hd-doc__grp" data-a4-item>
          <Heading>
            <T k="hd.h.pa">ЗАРЛАН МЭДЭЭЛЭЛ</T>
          </Heading>
          <ul className="hd-doc__list">
            <li>
              <T k="hd.txt.pa_system">Зарлан мэдээллийн систем</T>
              {answers.pa_background_music && (
                <T k="hd.txt.pa_music">, дэвсгэр хөгжимтэй</T>
              )}
              {answers.pa_emergency_override && (
                <T k="hd.txt.pa_emergency">, гал гарсан үед автомат зарлан мэдээлэх</T>
              )}
              {answers.pa_zoned && <T k="hd.txt.pa_zoned">, бүсчилсэн чанга яригчтай</T>}.
            </li>
          </ul>
        </div>
      )}

      {drawingRows.some((r) => answerOf[r.key] === true) && (
        <>
          <Heading item>
            <T k="hd.h.drawing_list">ХД-ИЙН ЗУРГИЙН ЖАГСААЛТ</T>
          </Heading>
          <ul className="hd-doc__list">
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

/** `item` — A4 хуудаслалтын бие даасан нэгж болгоно (бүлэг ДОТОР хэрэггүй,
 *  учир нь үүрлэсэн `data-a4-item`-ийг paginator хаядаг). */
function Heading({ children, item }: { children: React.ReactNode; item?: boolean }) {
  if (item) {
    return (
      <h2 className="hd-doc__heading" data-a4-item>
        {children}
      </h2>
    );
  }
  return <h2 className="hd-doc__heading">{children}</h2>;
}

function Para({ children, item }: { children: React.ReactNode; item?: boolean }) {
  if (item) {
    return (
      <p className="hd-doc__para" data-a4-item>
        {children}
      </p>
    );
  }
  return <p className="hd-doc__para">{children}</p>;
}

export const HD_REPORT_STYLES = `
.hd-doc { font-family: "Arial", Helvetica, sans-serif; color: #111; line-height: 1.55; max-width: 760px; margin: 0 auto; padding: 0 16px; }
.hd-doc__title { text-align: center; font-size: 18pt; font-weight: 700; margin: 0; letter-spacing: 0.06em; }
.hd-doc__subtitle { text-align: center; font-size: 11pt; font-weight: 600; margin: 4px 0 18px; letter-spacing: 0.04em; color: #444; }
.hd-doc__meta { margin-bottom: 18px; }
.hd-doc__meta-row { font-size: 11pt; margin: 2px 0; }
.hd-doc__meta-label { font-weight: 600; }
.hd-doc__heading { font-size: 12pt; font-weight: 700; text-transform: uppercase; margin: 18px 0 6px; letter-spacing: 0.04em; border-bottom: 1px solid #999; padding-bottom: 3px; }
/* A4 хуудаслалтын БҮЛЭГ (.hd-doc__grp[data-a4-item]) — гарчгийн дээд
 * зайг БҮЛЭГ нь ӨӨРТӨӨ авна.  Эс бөгөөс эцэг↔хүүхдийн margin
 * collapsing үүсэж A4Paginator-ийн getComputedStyle(el).marginTop
 * 0 уншигдана; тэгвэл түлхэлт 18px-ээр ДУТАЖ хэрэгжиж, бүлэг цаасны
 * дээд захын маск дор орж таслагдана.  Дэлгэц дээрх зай хуучинтай
 * ЯГ ИЖИЛ (18px) тул Багийн тайлангийн таб хөндөгдөхгүй. */
.hd-doc__grp { margin-top: 18px; }
.hd-doc__grp > .hd-doc__heading { margin-top: 0; }
.hd-doc__para { font-size: 11pt; margin: 6px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
.hd-doc__list { font-size: 11pt; margin: 6px 0 6px 18px; padding: 0; }
/* Үргэлжилсэн бичвэр — хоёр талаар тэгшилнэ.  «text-align-last: left» нь
 * сүүлийн мөрийг сунгахгүй.  Монгол бичвэрт «hyphens» ТАВИХГҮЙ — үг
 * таслах дүрэм байхгүй тул буруу таслана. */
.hd-doc__list li { margin: 2px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
/* ЗАЛГАА тодорхойлолтын мөрүүдийн хооронд харагдахуйц зай.  Дэлгэц ба
 * хэвлэл хоёуланд үйлчилнэ («+» тул эхний мөрөнд зай нэмэгдэхгүй). */
.hd-doc__list li + li { margin-top: 0.5em; }
.hd-doc__signatures { margin-top: 32px; font-size: 11pt; }
.hd-doc__sig-row { display: flex; gap: 24px; margin-top: 18px; flex-wrap: wrap; }
.hd-doc__sig-cell { flex: 1; min-width: 200px; }
.hd-doc__sig-role { font-weight: 600; margin-bottom: 24px; }
.hd-doc__sig-line { border-bottom: 1px solid #444; padding-bottom: 2px; min-height: 22px; }
.hd-doc__sig-meta { font-size: 10pt; color: #555; margin-top: 4px; }
@media print {
  .hd-doc { max-width: none; padding: 0; }
  .hd-doc__heading { break-after: avoid; }
  .hd-doc__para, .hd-doc__list { break-inside: avoid-page; }
}
`;
