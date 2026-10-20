/**
 * MGL AI · АСУУЛТЫН ТӨРӨЛ → ДҮРМИЙН ТӨРӨЛ (2026-09-23).
 *
 * ⚠️ ЯАГААД.  `ai_rules.rule_kind` нь заалт бүрийн утгыг аль хэдийн хэлдэг (УББ 12-204-01: 3-р
 *    бүлэг = үүрэг, 4-р бүлэг = эрх, 2-р бүлэг = шаардлага, 5.1 = хариуцлага), гэвч хайлт үүнийг
 *    огт ашигладаггүй байв.  Эзний HL01 «даамал ажлыг зогсоож ЧАДАХ УУ» (= эрх) асуултад хоолой
 *    5.1 (ХАРИУЦЛАГА) заалтыг толгой болгож, 4.3/4.4 (эрх) огт гараагүй.  Асуултын хэлбэр нь
 *    ямар төрлийн заалт хүлээж буйг илэрхийлдэг — «…чадах уу / эрхтэй юу» → эрх, «…үүрэг» →
 *    үүрэг, «…болж чадах уу / шаардлага / туршлага» → шаардлага, «…хариуцлага» → хариуцлага.
 *
 * ⚠️ ЗӨВХӨН ЭРЭМБЭ (pipeline-ийн `preferRuleKinds`): тохирох төрлийн заалтыг ТОЛГОЙ БАРИМТ
 *    ДОТОР урагшлуулна; хаалга, баримт сонголт, шийдвэрт нөлөөлөхгүй.  Таних үг олдохгүй бол
 *    хоосон — эрэмбэ яг хуучнаараа.
 *
 * ⚠️ ЦЭВЭР.  `test/questionKind.test.ts`.
 */
import { foldText } from './fold.ts';

export type CuedRuleKind = 'right' | 'obligation' | 'requirement' | 'responsibility';

/**
 * Фолдолсон (кирилл ↔ латин нэг хэлбэр) асуултад ҮГИЙН ЭХНЭЭС таарах хэв.  Фолд нь «kh→h»,
 * «ts→c», «y→i» ба давхар үсгийг хураадаг тул «чадах уу» = «chadah uu» = «chadah u».
 */
const CUES: ReadonlyArray<{ kind: CuedRuleKind; re: RegExp }> = [
  // «болж чадах уу» / «болохын тулд» — ХЭН НЭГЭН БОЛОХ нөхцөл = шаардлага (эрх БИШ).
  // ⚠️ «шаардлага / шаарддаг», «requirement» ОРУУЛААГҮЙ: «X заалт юу шаарддаг вэ» гэдэг нь ЕРӨНХИЙ асуултын
  //    хэлбэр — дохио болгоход ил нэрлэсэн заалтыг ч доош түлхэж байв (хэмжсэн: 58 тест унасан).
  { kind: 'requirement', re: /(?:^| )(?:bolj chad|bolohin tuld|bolh[a-z]* nohcol|shalgur|tursh|gerchilg|qualif|eligib)/ },
  // «чадах уу», «болох уу», «эрхтэй», «зогсоож болох» — хийх ЭРХ.  «байж болох» (хэмжээ) ОРОХГҮЙ.
  // «эрх», «эрхтэй», «эрхийг» — «эрхэлдэг» (ажил эрхлэх) ОРОХГҮЙ.
  { kind: 'right', re: /(?:^| )(?:erh(?:tei|ig|in|ud)?(?: |$)|chadah u|chadna u|chadag u|entitled|allowed to|right to)/ },
  // ⚠️ «заавал», «must» ОРУУЛААГҮЙ — «…заавал биелүүлэх үү» нь шаардлагын заалт (1.4) байсан (хэмжсэн).
  // «үүрэг даалгавар» = зааварчилгаа (шаардлагын заалт 1.4), үүрэг БИШ.
  { kind: 'obligation', re: /(?:^| )(?:ureg(?! dalgavar)|obligat|duty|duties)/ },
  { kind: 'responsibility', re: /(?:^| )(?:hariucl|shitgel|liab|penalt|sanction)/ },
];

/** «болох уу» — «байж болох уу» (зөвшөөрөгдөх хэмжээ) ба «болж чадах» (болох нөхцөл)-оос бусад нь эрх. */
const MAY_DO = /(?:^| )(?!baij )[a-z]+ (?:boloh u|bolno u)(?: |$)/;
const MAY_DO_EXCLUDE = /(?:^| )(?:baij|bolj) (?:boloh|bolno)/;

/**
 * ҮЙЛДЛИЙН ҮГ — «X-ийг ЗОГСООЖ чадах уу?» асуултын «зогсоож» (фолдолсон угтвар).
 *
 * ⚠️ ЯАГААД.  Эрхийн асуултад хоолой тухайн баримтын БҮХ эрхийг (4.1–4.10) урагшлуулна; тэдгээрийн дотор
 *    асуусан ҮЙЛДЛИЙГ олгодог заалт (4.3, 4.4 «…зогсоох») нь бусдаас (4.9 «шагнал урамшуулал авах») түрүүлэх
 *    ёстой.  «чадах / болох / эрхтэй» үгийн ӨМНӨХ, ерөнхий бус эхний үг нь тэр үйлдэл.
 * ⚠️ Ерөнхий үйл үг («хийж», «болж», «байж») үйлдэл биш — түүний өмнөх нэр үгийг авна («зургийг хийж болох
 *    уу» → «зург»).  Олдохгүй бол `null`.
 */
const ABILITY = new Set(['chadah', 'chadna', 'chadag', 'boloh', 'bolno', 'erhtei']);
const GENERIC_VERB = new Set(['hij', 'hih', 'hiih', 'bolj', 'baij', 'gej', 'ni', 'n', 'ch', 'bas', 'odo', 'ter', 'ene']);
export function actionPrefix(question: string): string | null {
  const words = foldText(question ?? '').split(' ').filter((w) => w.length > 0);
  const at = words.findIndex((w) => ABILITY.has(w));
  if (at <= 0) return null;
  for (let i = at - 1; i >= 0 && i >= at - 3; i -= 1) {
    const w = words[i]!;
    if (GENERIC_VERB.has(w) || w.length < 4) continue;
    return w.slice(0, Math.max(4, w.length - 2));
  }
  return null;
}

/**
 * ХҮЧИН ТӨГӨЛДӨР БАЙДЛЫН асуулт («одоо ч хэрэглэгддэг үү», «хүчинтэй юу», «мөрдөгдөж байна уу») — заалтын
 * төрлөөр эрэмбэлэхгүй.  «…ашиглаж болох уу» гэсэн сүүл нь «эрх» мэт танигдаж СНиП-ийн статусын хэсгийг
 * толгойгоос түлхэж байв (HL07).  Фолд: «мөрдөгдөж» → `mordogdoj`, латин «murdugduj» → `murdugduj`.
 */
const STATUS_Q = /(?:^| )(?:huchin|hurchin|hereglegd|mordogd|murdugd|murdogd|mordod|murdud|huchingu|still (?:valid|used|in force)|in force|superseded)/;

/**
 * ⚠️ ГОЛ ФУНКЦ.  Асуултаас хүлээгдэж буй заалтын төрлүүд (давхардалгүй, эрэмбэгүй).
 */
export function cuedRuleKinds(question: string): Set<CuedRuleKind> {
  const f = ` ${foldText(question ?? '')} `;
  const out = new Set<CuedRuleKind>();
  if (STATUS_Q.test(f)) return out;
  for (const c of CUES) if (c.re.test(f)) out.add(c.kind);
  // «X болж ЧАДАХ уу» нь болох НӨХЦӨЛ (шаардлага) — «чадах уу» гэдгээр эрх гэж давхар тэмдэглэхгүй.
  if (/(?:^| )bolj chad/.test(f)) out.delete('right');
  if (!out.has('requirement') && MAY_DO.test(f) && !MAY_DO_EXCLUDE.test(f)) out.add('right');
  return out;
}
