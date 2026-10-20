/**
 * L2.1 · НЭР ТОМЬЁОНЫ ХОЛБООС — консерватив залгаварын жигдрэл.  Нэр томьёоны үг бүр заалтын дараалсан үгтэй тулгарна:
 * (а) яг ижил, эсвэл (б) заалтын үг = томьёоны үг/язгуур (≥4 тэмдэгт, залгаварыг ТАНИГДСАН жагсаалтаар хассан) + мэдэгдэж
 * буй ТИЙН ЯЛГАЛ/ОЛОН ТООНЫ залгавар («бүс» → «бүсэд», «хэрэгсэл» → «хэрэгслийн»).  Түрэмгий stemming БИШ: «аюулын» ≠
 * «аюулгүйн» (аюулын бүс ≠ аюулгүйн бүс), «өргөжсөн» ≠ «өргөжин» (үүсмэл үг).  Итгэл: exact 1.0 · stem_suffix 0.9 · mixed 0.8.
 * Хэмжсэн (2026-09-18, БНбД 31-17-10): 22 тодорхойлолтын нэг нь ч заалтад үг үсгээрээ/залгавартайгаар давтагддаггүй → 0 холбоос;
 * нэг үг алгасах сул тулгалт 62 «холбоос» өгсөн ч дийлэнх нь худал («хувиас хэтрээгүйгээр авах хэрэгтэй» ≠ «хувийн аврах хэрэгсэл»).
 */
export const MN_SUFFIXES = ['нуудын', 'нүүдийн', 'уудын', 'үүдийн', 'нуудыг', 'нүүдийг', 'уудыг', 'үүдийг', 'нуудад', 'нүүдэд', 'уудад', 'үүдэд', 'нууд', 'нүүд', 'ууд', 'үүд',
  'ийнх', 'ынх', 'ийн', 'ын', 'ний', 'ны', 'ийг', 'ыг', 'аас', 'ээс', 'оос', 'өөс', 'аар', 'ээр', 'оор', 'өөр', 'тай', 'тэй', 'той', 'анд', 'энд', 'онд', 'өнд', 'нд', 'ад', 'эд', 'од', 'өд', 'д', 'т', 'г', 'а', 'э', 'о', 'ө'];
export function stemWord(w) {
  for (const suf of MN_SUFFIXES) if (w.length - suf.length >= 4 && w.endsWith(suf)) return w.slice(0, -suf.length);
  return w;
}
export function wordMatches(termWord, clauseWord) {
  if (termWord === clauseWord) return 'exact';
  if (clauseWord.startsWith(termWord) && MN_SUFFIXES.includes(clauseWord.slice(termWord.length))) return 'stem_suffix';
  if (termWord.length < 5) return null;
  const stem = stemWord(termWord);
  if (stem.length < 4) return null;
  if (clauseWord.startsWith(stem)) {
    const rest = clauseWord.slice(stem.length);
    if (rest === '' || MN_SUFFIXES.includes(rest)) return 'stem_suffix';
  }
  const stem2 = stem.replace(/[аэиоөуүы]([лнрмсвгдтжзчшх])$/u, '$1');
  if (stem2 !== stem && stem2.length >= 4 && clauseWord.startsWith(stem2)) {
    const rest2 = clauseWord.slice(stem2.length);
    if (MN_SUFFIXES.includes(rest2)) return 'stem_suffix';
  }
  return null;
}
/**
 * @param {string} text заалтын эх бичвэр
 * @param {Array<{term:string, definition_id:string, appendix?:string|null, page?:number|null, definition?:string}>} definitions
 */
export function linkTerms(text, definitions) {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out = [];
  for (const d of definitions) {
    const tw = d.term.toLowerCase().split(/\s+/).filter(Boolean);
    if (tw.length === 0) continue;
    for (let i = 0; i + tw.length <= words.length; i += 1) {
      const methods = [];
      let ok = true;
      for (let j = 0; j < tw.length; j += 1) {
        const m = wordMatches(tw[j], words[i + j]);
        if (!m) { ok = false; break; }
        methods.push(m);
      }
      if (!ok) continue;
      const surface = words.slice(i, i + tw.length).join(' ');
      const method = methods.every((m) => m === 'exact') ? 'exact' : methods.every((m) => m === 'stem_suffix') ? 'stem_suffix' : 'mixed';
      out.push({ term: d.term, definition_id: d.definition_id, appendix: d.appendix ?? null, ...(d.clause ? { clause: d.clause } : {}), page: d.page ?? null, definition: String(d.definition ?? '').slice(0, 400), matched_surface: surface, match_method: method, confidence: method === 'exact' ? 1 : method === 'stem_suffix' ? 0.9 : 0.8 });
      break;
    }
  }
  return out;
}
