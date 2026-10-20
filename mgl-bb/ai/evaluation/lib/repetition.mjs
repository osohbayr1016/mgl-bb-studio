/**
 * ДАВТАЛТЫН ХЭМЖҮҮР (§20) — үүсгэсэн хариултын давхардлыг тоогоор.
 *
 *   exactDuplicateSentenceRate — ижил өгүүлбэр (фолдолсон) / бүх өгүүлбэр
 *   duplicateParagraphRate     — ижил догол мөр / бүх догол мөр
 *   repeatedNgramRate          — 4-грамын давхардал (олон удаа тааралдсан 4-грам / нийт)
 *   loopingSuffix              — сүүлийн 40 тэмдэгт өмнө нь ≥2 удаа гарсан эсэх
 *
 *   ── 2026-09-10 нэмэгдсэн ХҮЧТЭЙ дохио (§11 — хууль ёсны хэллэгийг шийтгэхгүй):
 *   exactRepeatedSentences     — ижил өгүүлбэрийн ТОО (хувь биш — урт хариултад хувь буурч нуугддаг)
 *   exactRepeatedParagraphs    — ижил догол мөрийн тоо
 *   contiguousRepeatedBlock    — ≥ 8 үгийн блок ЗАЛГАА давтагдсан эсэх («A B C A B C»)
 *   nearDuplicateAdjacent      — зэргэлдээ хоёр өгүүлбэрийн Jaccard ≥ 0.8 (нэг өгүүлбэрийг
 *                                хувилбарласан давталт — case J-ийн хэлбэр)
 *   longestRepeatedRun         — нэг өгүүлбэрийн ХАМГИЙН олон удаа гарсан ижил ≥ 6 үгийн
 *                                хэсэг (цонх) — «…тодорхойлох, хэрэглэгчидтэй болохыг
 *                                хүснэгтээр дүрсэлж…» 4 удаа гэх мэт
 *   severe                     — ДЭЭРХ хүчтэй дохионы аль нэг нь; ХААЛГА үүнийг Л уншина
 *
 * ⚠️ 4-грамын хувь нь ТАЙЛАНД үлдэнэ, ХААЛГА БИШ.  Нормын нэр, «галын
 *    аюулын ангилал», «хүчин төгөлдөр» гэх мэт хууль ёсны хэллэг урт
 *    техникийн хариултад олон удаа зүй ёсоор давтагддаг тул 15%-ийн
 *    босго нь зөв хариултыг унагаж байв.
 *
 * ⚠️ Хууль ёсны давталтыг (нормын код, томьёо, жагсаалтын шошго) ХЭТ
 *    шийтгэхгүй: 3-аас богино үгтэй өгүүлбэр, markdown тэмдэг, зөвхөн
 *    тоо/кодоос бүрдсэн мөрийг тоолохгүй.  Хэмжүүр нь ТӨЛӨВ БИШ — тайланд
 *    тоог л бичнэ; босго нь тестийн үзэмж.
 */

function fold(s) {
  return s.toLowerCase().replace(/[*_`#>|-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sentences(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((s) => fold(s))
    .filter((s) => s.length > 0 && s.split(' ').length >= 3 && /\p{L}/u.test(s));
}

function paragraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => fold(p))
    .filter((p) => p.length >= 20);
}

function ngrams(text, n = 4) {
  const words = fold(text).split(' ').filter((w) => w.length > 0);
  const out = [];
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(' '));
  return out;
}

function countDup(arr) {
  const seen = new Map();
  for (const x of arr) seen.set(x, (seen.get(x) ?? 0) + 1);
  let dup = 0;
  for (const n of seen.values()) if (n > 1) dup += n - 1;
  return dup;
}

const wordSet = (s) => new Set(s.split(' ').filter((w) => w.length > 2));
function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter || 1);
}

/** Зэргэлдээ хоёр өгүүлбэр бараг ижил (≥ 4 үгтэй, Jaccard ≥ 0.8) — хэдэн хос. */
function nearDuplicateAdjacentPairs(sents) {
  let n = 0;
  for (let i = 1; i < sents.length; i++) {
    const a = wordSet(sents[i - 1]);
    const b = wordSet(sents[i]);
    if (a.size >= 4 && b.size >= 4 && jaccard(a, b) >= 0.8) n += 1;
  }
  return n;
}

/** ≥ `k` үгийн блок ЗАЛГАА давтагдсан («... x y z x y z ...»). */
function contiguousRepeatedBlock(text, k = 8) {
  const w = fold(text).split(' ').filter((x) => x.length > 0);
  for (let len = k; len <= 40 && 2 * len <= w.length; len++) {
    for (let i = 0; i + 2 * len <= w.length; i++) {
      let same = true;
      for (let j = 0; j < len; j++) {
        if (w[i + j] !== w[i + len + j]) { same = false; break; }
      }
      if (same) return true;
    }
  }
  return false;
}

/**
 * Ижил ≥ `k` үгийн цонх хариултад ХЭДЭН УДАА гарсан (хамгийн их).  Зөвхөн
 * үсэгтэй үгээс бүрдсэн цонх — тоо, нэгж, кодын мөрийг тоолохгүй.
 */
function longestRepeatedRun(text, k = 6) {
  const w = fold(text).split(' ').filter((x) => x.length > 0);
  const counts = new Map();
  for (let i = 0; i + k <= w.length; i++) {
    const win = w.slice(i, i + k);
    if (!win.every((x) => /\p{L}/u.test(x))) continue;
    const key = win.join(' ');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let max = 0;
  for (const n of counts.values()) if (n > max) max = n;
  return max;
}

export function repetitionMetrics(text) {
  const s = sentences(text);
  const p = paragraphs(text);
  const g = ngrams(text, 4);
  const gramCounts = new Map();
  for (const x of g) gramCounts.set(x, (gramCounts.get(x) ?? 0) + 1);
  let repeatedGrams = 0;
  for (const n of gramCounts.values()) if (n > 1) repeatedGrams += n - 1;

  const tail = fold(text).slice(-40);
  const body = fold(text).slice(0, -40);
  const loopingSuffix = tail.length >= 20 && body.split(tail).length - 1 >= 2;

  const exactRepeatedSentences = countDup(s);
  const exactRepeatedParagraphs = countDup(p);
  const contiguous = contiguousRepeatedBlock(text);
  const nearAdjacent = nearDuplicateAdjacentPairs(s);
  const run = longestRepeatedRun(text);
  // Хүчтэй дохио: ижил өгүүлбэр ≥ 2, ижил догол ≥ 1, залгаа блок, гогцоо
  // суффикс, зэргэлдээ хувилбар ≥ 2, эсвэл ≥ 6 үгийн цонх ≥ 3 удаа.
  const severe = exactRepeatedSentences >= 2 || exactRepeatedParagraphs >= 1 || contiguous || loopingSuffix || nearAdjacent >= 2 || run >= 3;

  return {
    sentences: s.length,
    exactDuplicateSentenceRate: s.length ? exactRepeatedSentences / s.length : 0,
    duplicateParagraphRate: p.length ? exactRepeatedParagraphs / p.length : 0,
    repeatedNgramRate: g.length ? repeatedGrams / g.length : 0,
    loopingSuffix,
    exactRepeatedSentences,
    exactRepeatedParagraphs,
    contiguousRepeatedBlock: contiguous,
    nearDuplicateAdjacent: nearAdjacent,
    longestRepeatedRun: run,
    severe,
  };
}

/** Тайланд: дундаж + хамгийн муу. */
export function summarizeRepetition(list) {
  const n = list.length || 1;
  const avg = (k) => Math.round((list.reduce((a, m) => a + (m[k] ?? 0), 0) / n) * 1000) / 1000;
  const max = (k) => Math.round(Math.max(0, ...list.map((m) => m[k] ?? 0)) * 1000) / 1000;
  return {
    n: list.length,
    exactDuplicateSentenceRate: { avg: avg('exactDuplicateSentenceRate'), max: max('exactDuplicateSentenceRate') },
    duplicateParagraphRate: { avg: avg('duplicateParagraphRate'), max: max('duplicateParagraphRate') },
    repeatedNgramRate: { avg: avg('repeatedNgramRate'), max: max('repeatedNgramRate') },
    loopingSuffix: list.filter((m) => m.loopingSuffix).length,
    severe: list.filter((m) => m.severe).length,
    contiguousRepeatedBlock: list.filter((m) => m.contiguousRepeatedBlock).length,
    nearDuplicateAdjacent: list.filter((m) => (m.nearDuplicateAdjacent ?? 0) >= 2).length,
    longestRepeatedRunMax: Math.max(0, ...list.map((m) => m.longestRepeatedRun ?? 0)),
  };
}
