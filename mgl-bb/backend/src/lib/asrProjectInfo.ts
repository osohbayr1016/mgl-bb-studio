/**
 * Зохиогчийн хяналтын баримт дээр хэвлэгдэх ТӨСЛИЙН ТОВЧ ТАНИЛЦУУЛГА.
 *
 * Эзний шийдвэр 2026-09-04: ЗХ-ийн маягтын ДЭЭР нэг блок болж гарна, БА
 * тайлан ИЛГЭЭГДЭХ агшинд ХӨЛДӨНӨ (`author_supervision_reports.
 * project_info_json`, миграц 0256).
 *
 * ⚠️ ШАТЛАЛЫГ ЭНД ЗОХИОХГҮЙ.  Бүх утга `lib/projectIdentity.ts`-ийн
 *    `resolveProjectIdentity()`-оос ирнэ — тэр нь гүйцэтгэлийн тайлан,
 *    захиалагчийн PDF, багийн баримттай НЭГ ижил ладдер.  Энэ файл нь
 *    зөвхөн тэр үр дүнгээс ЗХ-д хэрэгтэй ЕС талбарыг сонгож, JSON болгож
 *    хөлдөөх/задлах ажлыг хийнэ.  Шинэ талбар нэмэх шаардлагатай бол
 *    эхлээд `ProjectIdentity`-д байгаа эсэхийг шалга.
 *
 * ⚠️ Хөлдөөсөн JSON нь ТҮҮХ.  Энд талбар нэмэх нь хуучин мөрүүдэд тэр
 *    талбарыг үүсгэхгүй — уншигч тал `?? ''` / `?? null`-аар эвдрэлгүй
 *    буурах ёстой.  Талбарыг ХЭЗЭЭ Ч бүү нэрлэж сольж бич.
 */

import { resolveProjectIdentity, type ProjectIdentityInput } from './projectIdentity';

export interface AsrProjectInfo {
  /** Албан ёсны УРТ нэр (паспорт → display_title → name). */
  title: string;
  /** `projects.name` — богино, кодтой нэр. */
  shortName: string;
  /** Зургийн шифр. */
  drawingNo: string;
  /** Doc. No. */
  docNo: string;
  /** Захиалагч — `project_clients`-ээс (паспортад тийм багана БАЙХГҮЙ). */
  clientName: string;
  /** Байршил — `projects.location`-оос (паспортад тийм багана БАЙХГҮЙ). */
  location: string;
  startDate: string | null;
  finishDate: string | null;
  /** Ажлын хэсгүүдийн код (БА / ББ / ХАС …). */
  disciplines: string[];
}

/** Паспорт + төсөл + захиалагчаас ЗХ-ийн танилцуулга гаргана. */
export function buildAsrProjectInfo(input: ProjectIdentityInput): AsrProjectInfo {
  const id = resolveProjectIdentity(input);
  /*
   * ⚠️ `id.clientName`-ийг ЭНД ХЭРЭГЛЭХГҮЙ — санаатай.  Тэр нь нэр бүрийг
   *    хашилтад хийдэг (`"НЭР"`), учир нь гүйцэтгэлийн тайлангийн §1-д
   *    «"АЧИД-ОРГ" ХХК-ийн захиалгаар…» гэсэн ӨГҮҮЛБЭР дотор ордог.
   *    Прод дээр нэр нь өөрөө хашилттай хадгалагдсан байдаг тул
   *    (`''АЧИД-ОРГ'' ХХК`) давхарлавал `"''АЧИД-ОРГ'' ХХК"` болно.
   *    ЗХ-ийн танилцуулга нь ХҮСНЭГТИЙН НҮД — өгүүлбэр биш, тиймээс нэрийг
   *    байгаагаар нь бичнэ.  Энэ нь шатлалын давхардал БИШ: захиалагчийн
   *    эх сурвалж нь `project_clients` ганцаараа (резолверийн тайлбарыг үз).
   */
  const clientName = (input.clients ?? [])
    .map((c) => c.name.trim())
    .filter(Boolean)
    .join(', ');
  return {
    title: id.title,
    shortName: id.shortName,
    drawingNo: id.drawingNo,
    docNo: id.docNo,
    clientName,
    location: id.location,
    startDate: id.startDate,
    finishDate: id.finishDate,
    disciplines: id.disciplines,
  };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const dateOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * Хөлдөөсөн JSON-г задлана.
 *
 * ⚠️ Хатуу схем шалгахгүй, талбар БҮРИЙГ тусад нь эвдрэлгүй уншина:
 *    энэ өгөгдөл нь өнгөрсөн хувилбарын кодоор бичигдсэн байж болно.
 *    Задрахгүй / объект биш бол `null` — дуудагч амьд утга руу унана.
 */
export function parseAsrProjectInfo(raw: string | null | undefined): AsrProjectInfo | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const disciplines = Array.isArray(o.disciplines)
    ? o.disciplines.filter((d): d is string => typeof d === 'string')
    : [];
  return {
    title: str(o.title),
    shortName: str(o.shortName),
    drawingNo: str(o.drawingNo),
    docNo: str(o.docNo),
    clientName: str(o.clientName),
    location: str(o.location),
    startDate: dateOrNull(o.startDate),
    finishDate: dateOrNull(o.finishDate),
    disciplines,
  };
}

export function serialiseAsrProjectInfo(info: AsrProjectInfo): string {
  return JSON.stringify(info);
}
