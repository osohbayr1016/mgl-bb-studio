import { textToItems } from '../../daily-log/lib';

/**
 * «Өнөөдөр юу хийв?» хурдан бичлэгийн (баруун доод тэмдэглэл) цэвэр туслахууд.
 * Шинэ өгөгдлийн сан БИШ — `/daily-work-logs/:date` (бичилт) дээр суурилна.
 */

/**
 * Хурдан бичлэг: шинэ мөр(үүд)-ийг өнөөдрийн жагсаалтын АРД залгана.  Олон
 * мөр буулгавал мөр бүр тусдаа ажил; «1.», «-» угтвар серверийн дүрмээр
 * хасагдана (`textToItems` ↔ backend `normalizeItems`).  Хоосон бол null.
 */
export function appendItems(existing: readonly string[], input: string): string[] | null {
  const added = textToItems(input);
  if (added.length === 0) return null;
  return [...existing, ...added];
}

/**
 * Хурдан бичлэгийн НЭГ үйлдэл = өдрийн жагсаалтын нэг хэсгийг солих:
 *   нэмэх   — `expected: []` (төгсгөлд залгана),
 *   засах   — `expected: [хуучин]`, `next: [шинэ]`,
 *   устгах / буцаах — `next: []`.
 * Сервер дээрх ХАМГИЙН СҮҮЛИЙН жагсаалтад дахин хэрэгжүүлэх тул байрлал нь зөвхөн
 * зөвлөмж: тэнд яг тэр мөр(үүд) байхгүй бол бичвэрээр нь хайна, олдохгүй бол
 * null (өөр газраас засагдсан — дарж бичихгүй).
 */
export interface ReplaceOp {
  index: number;
  expected: readonly string[];
  next: readonly string[];
}

export function locateBlock(
  items: readonly string[],
  index: number,
  expected: readonly string[],
): number | null {
  if (expected.length === 0) return items.length;
  const at = (i: number) => expected.every((s, k) => items[i + k] === s);
  if (index >= 0 && index + expected.length <= items.length && at(index)) return index;
  for (let i = 0; i + expected.length <= items.length; i++) if (at(i)) return i;
  return null;
}

export function applyReplace(items: readonly string[], op: ReplaceOp): string[] | null {
  const i = locateBlock(items, op.index, op.expected);
  if (i == null) return null;
  return [...items.slice(0, i), ...op.next, ...items.slice(i + op.expected.length)];
}
