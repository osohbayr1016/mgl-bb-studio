/**
 * `WorkbookDoc`-ийн ЦЭВЭР (immutable) үйлдлүүд — хуудас нэмэх/устгах/нэр солих/
 * дараалал солих/идэвхжүүлэх. Excel-ийн доод табын логик энд төвлөрнө.
 *
 * Бүх функц шинэ `WorkbookDoc` буцаана (React state-д шууд тавихад тохиромжтой)
 * ба хүчингүй үйлдэлд (муж гадуур индекс, хоосон/давхардсан нэр, ганц хуудсыг
 * устгах гэх мэт) ХУУЧ `wb`-г ӨӨРЧЛӨЛГҮЙ буцаана — дуудагч тал алдаа шидэхгүйгээр
 * хайхрамжгүй хамгаалагдана.
 *
 * ⚠️ Нэг нарийн зүйл: хөндлөн лавлагаа (`=ИГС!G17`) хуудсыг НЭРЭЭР нь заадаг тул
 * `renameSheet` нь бусад хуудасны томьёог ДАГААД засдаггүй — тэдгээр томьёо
 * хуучин нэрээ хайж `#ТОМЬЁО!` болно. Anchor-ууд харин хуудсыг `id`-аар заадаг тул
 * нэр солиход эвдрэхгүй. (Нэр солиход томьёо дагуулах ажил энэ ажлын хүрээнээс
 * гадуур — дараагийн агент анхаараарай.)
 */
import { nanoid } from 'nanoid';

import { emptySheet } from './sheetOps';
import type { AnchorKey, NamedSheet, WorkbookDoc } from '../types/quotes';

/** id өгөгдөөгүй үед ашиглах анхдагч nanoid үүсгэгч. */
function defaultMakeId(): string {
  return nanoid(8);
}

/** Хуудасны нэрийг харьцуулахад ашиглах хэлбэр (regcase/зай үл ялгана). */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Одоо ашиглагдаж буй нэрсийн олонлог (харьцуулах хэлбэрээр). */
function takenNames(wb: WorkbookDoc): Set<string> {
  return new Set(wb.sheets.map((s) => nameKey(s.name)));
}

/**
 * `base`-ээс эхлэн давхардаагүй нэр үүсгэнэ: `Хуудас2`, `Хуудас3`… Дугаарыг
 * `sheets.length + 1`-ээс эхлүүлж (шинэ хуудасны байгалийн дугаар) сул нэр хүртэл
 * ахиулна — `normalizeWorkbook`-ийн `Хуудас${i+1}` анхдагчтай нийцнэ.
 */
function nextSheetName(wb: WorkbookDoc, base: string): string {
  const taken = takenNames(wb);
  let n = wb.sheets.length + 1;
  let candidate = `${base}${n}`;
  while (taken.has(nameKey(candidate))) {
    n += 1;
    candidate = `${base}${n}`;
  }
  return candidate;
}

/** Индекс `[0, length)` мужид эсэх. */
function inRange(wb: WorkbookDoc, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < wb.sheets.length;
}

function clampActive(length: number, index: number): number {
  return Math.max(0, Math.min(index, length - 1));
}

/**
 * Шинэ хоосон хуудас нэмээд ИДЭВХЖҮҮЛНЭ.
 *
 * `name` өгвөл түүнийг ашиглана (давхардвал base болгож дугаарлана); өгөөгүй бол
 * анхдагч «Хуудас» base-ээс давхардаагүй нэр үүсгэнэ.
 */
export function addSheet(
  wb: WorkbookDoc,
  name?: string,
  makeId: () => string = defaultMakeId,
): WorkbookDoc {
  const desired = name?.trim() ?? '';
  const base = desired || 'Хуудас';
  const finalName =
    desired && !takenNames(wb).has(nameKey(desired)) ? desired : nextSheetName(wb, base);

  const sheet: NamedSheet = { ...emptySheet(), id: makeId(), name: finalName };
  const sheets = [...wb.sheets, sheet];
  return { ...wb, sheets, activeSheet: sheets.length - 1 };
}

/**
 * Хуудас устгана. Дор хаяж НЭГ хуудас үлдэнэ (сүүлчийнхийг устгах хүсэлтийг үл
 * тоомсорлоно). Устсан хуудсыг заасан anchor-ууд арилна. `activeSheet`-ийг
 * хүчинтэй болгож дахин байрлуулна.
 */
export function removeSheet(wb: WorkbookDoc, index: number): WorkbookDoc {
  if (!inRange(wb, index) || wb.sheets.length <= 1) return wb;

  const removedId = wb.sheets[index]!.id;
  const sheets = wb.sheets.filter((_, i) => i !== index);

  // Устсан хуудас руу заасан anchor-уудыг хая.
  let anchors = wb.anchors;
  const staleKeys = (Object.keys(anchors) as AnchorKey[]).filter(
    (k) => anchors[k]?.sheet === removedId,
  );
  if (staleKeys.length > 0) {
    anchors = { ...anchors };
    for (const k of staleKeys) delete anchors[k];
  }

  // Идэвхтэй табыг шилжүүлнэ: устсанаас өмнөх нь хэвээр, дараах нь нэгээр ухарна,
  // устсан нь өөрөө байвал тухайн байрлалд үлдэнэ (одоо тэнд байгаа хуудас руу).
  let active = wb.activeSheet ?? 0;
  if (active > index) active -= 1;
  else if (active === index) active = index; // clampActive доор хязгаарлана
  active = clampActive(sheets.length, active);

  return { ...wb, sheets, anchors, activeSheet: active };
}

/**
 * Хуудасны нэрийг солино. Хоосон эсвэл (өөр хуудастай) давхардсан нэрийг
 * хориглож ХУУЧ `wb`-г буцаана — дуудагч тал нэр буруу гэдгийг тусдаа
 * (`quotes.tabs.nameRequired/nameDuplicate`) шалгаж мэдэгдэнэ.
 */
export function renameSheet(wb: WorkbookDoc, index: number, name: string): WorkbookDoc {
  if (!inRange(wb, index)) return wb;
  const trimmed = name.trim();
  if (trimmed === '') return wb;

  const key = nameKey(trimmed);
  const clash = wb.sheets.some((s, i) => i !== index && nameKey(s.name) === key);
  if (clash) return wb;

  const sheets = wb.sheets.slice();
  sheets[index] = { ...sheets[index]!, name: trimmed };
  return { ...wb, sheets };
}

/**
 * Хуудсыг `from`-оос `to` рүү зөөнө. Идэвхтэй хуудсыг НЭРЭЭР нь бус ID-аар нь
 * дагах тул зөөсний дараа мөн адил хуудас идэвхтэй хэвээр үлдэнэ.
 */
export function moveSheet(wb: WorkbookDoc, from: number, to: number): WorkbookDoc {
  if (!inRange(wb, from) || !inRange(wb, to) || from === to) return wb;

  const activeId = wb.sheets[wb.activeSheet ?? 0]?.id;
  const sheets = wb.sheets.slice();
  const [moved] = sheets.splice(from, 1);
  sheets.splice(to, 0, moved!);

  const active = activeId ? sheets.findIndex((s) => s.id === activeId) : (wb.activeSheet ?? 0);
  return { ...wb, sheets, activeSheet: active >= 0 ? active : 0 };
}

/** Идэвхтэй табыг сонгоно (муж гадуур индексийг хязгаарлана). */
export function setActiveSheet(wb: WorkbookDoc, index: number): WorkbookDoc {
  if (wb.sheets.length === 0) return wb;
  return { ...wb, activeSheet: clampActive(wb.sheets.length, index) };
}
