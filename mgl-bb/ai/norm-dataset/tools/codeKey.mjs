/**
 * Нормын кодын ГАНЦ түлхүүр («БНбД 2.01.07-90» ≡ «БНбД 2-01-07-90» → `bnbd2-01-07-90`).
 * build-registry.mjs ба build-l2.mjs хоёулаа эндээс импортолно (build-registry.mjs-ийг импортлох нь бүтэн
 * бүртгэл угсрах скриптийг ажиллуулдаг тул тусдаа модуль).  retrieval/src/topicRouter.ts нь ижил дүрмийн хуулбар.
 */
export function codeKey(code) {
  return String(code)
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, '')
    .replace(/бнбд/g, 'bnbd')
    .replace(/бнод/g, 'bnod')
    .replace(/убб/g, 'ubb')
    .replace(/бд/g, 'bd')
    .replace(/снип/g, 'snip')
    .replace(/(\d)\.(\d)/g, '$1-$2');
}
