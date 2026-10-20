import { createHash } from 'node:crypto';

/**
 * Fingerprints detect exact/formatting duplicates, not semantic paraphrases.
 * For a defensible "new case" count, variants share their core_id and are
 * excluded. New LLM-authored cases require independent reference review.
 */
export function normalizedQuestion(caseDef) {
  const text = Array.isArray(caseDef.turns)
    ? caseDef.turns.map((t) => t.question ?? t.q ?? '').join(' || ')
    : caseDef.question ?? '';
  return String(text).normalize('NFKC').toLocaleLowerCase('mn-MN')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}

export function fingerprint(caseDef) {
  return createHash('sha256').update(normalizedQuestion(caseDef), 'utf8').digest('hex');
}

export function validateHistory(history) {
  if (!history || typeof history !== 'object' || Array.isArray(history)) throw Error('Invalid history object');
  if (history.schema !== 'mgl-ai-quality-cycle-history/1') throw Error('Unknown history schema');
  if (!Array.isArray(history.used_core_ids) || !Array.isArray(history.used_fingerprints)) {
    throw Error('History requires used_core_ids and used_fingerprints arrays');
  }
  if (history.used_core_ids.some((x) => typeof x !== 'string') || history.used_fingerprints.some((x) => !/^[a-f0-9]{64}$/.test(x))) {
    throw Error('Invalid history content');
  }
  return history;
}

export const emptyHistory = () => ({
  schema: 'mgl-ai-quality-cycle-history/1',
  used_core_ids: [],
  used_fingerprints: [],
  completed_batches: 0,
});

export function selectBatch(coreCases, history, { size = 40, seed = 'first-batch' } = {}) {
  validateHistory(history);
  if (!Number.isInteger(size) || size < 30 || size > 50) throw Error('Batch size must be between 30 and 50');
  if (!Array.isArray(coreCases)) throw Error('coreCases must be an array');
  const usedIds = new Set(history.used_core_ids);
  const usedHashes = new Set(history.used_fingerprints);
  const allIds = new Set();
  const localHashes = new Set();
  const groups = new Map();
  for (const c of coreCases) {
    if (!c || !c.id || typeof c.category !== 'string' || !c.expected || !c.provenance) throw Error('Missing case identity/reference');
    if (allIds.has(c.id)) throw Error('Duplicate case id in catalog: ' + c.id);
    allIds.add(c.id);
    // Paraphrases do not count as new semantic cases.
    if (c.is_variant || c.core_id) continue;
    const fp = fingerprint(c);
    if (!normalizedQuestion(c) || localHashes.has(fp) || usedIds.has(c.id) || usedHashes.has(fp)) continue;
    localHashes.add(fp);
    if (!groups.has(c.category)) groups.set(c.category, []);
    groups.get(c.category).push(c);
  }
  const key = (c) => createHash('sha256').update(String(seed) + ':' + c.id).digest('hex');
  for (const rows of groups.values()) rows.sort((a, b) => key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
  const categories = [...groups.keys()].sort();
  const selected = [];
  // Round-robin across skills instead of filling each batch with one topic.
  while (selected.length < size) {
    let progressed = false;
    for (const category of categories) {
      const next = groups.get(category).shift();
      if (next) { selected.push(next); progressed = true; }
      if (selected.length === size) break;
    }
    if (!progressed) break;
  }
  if (selected.length < size) throw Error(
    'Only ' + selected.length + ' novel core cases remain; need ' + size +
    '. Add independently reviewed NEW cases; do not recycle paraphrases or invent gold answers.'
  );
  return selected;
}

export function updatedHistory(history, cases) {
  validateHistory(history);
  const ids = new Set(history.used_core_ids);
  const fps = new Set(history.used_fingerprints);
  for (const c of cases) {
    const fp = fingerprint(c);
    if (ids.has(c.id) || fps.has(fp)) throw Error('Duplicate during history update: ' + c.id);
    ids.add(c.id);
    fps.add(fp);
  }
  return {
    schema: history.schema,
    used_core_ids: [...ids].sort(),
    used_fingerprints: [...fps].sort(),
    completed_batches: history.completed_batches + 1,
  };
}
