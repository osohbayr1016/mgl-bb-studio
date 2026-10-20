/**
 * @mgl/mglai-common — MGL AI-ийн ХУВААЛЦСАН цэвэр TypeScript модулиуд.
 *
 * ⚠️ ЭНД Node, Cloudflare Workers, DOM-ын API ОРОХГҮЙ (`tsconfig` `lib: ES2023`,
 *    `types: []` — импортлоход л tsc унана).  Ингэснээр backend (Worker),
 *    ai/runtime + ai/deployment (Node), frontend (хөтөч) гурвуулаа ИЖИЛ
 *    хэрэгжүүлэлтийг ачаална — «twin файл» заншлын оронд.
 */
export * from './redaction.ts';
export * from './normIdentity.ts';
// Session R — хуваалцсан ээлжийн хөдөлгүүр нь ДЭД ЗАМААР: `@mgl/mglai-common/turn` (WinterCG глобал хэрэглэдэг тул энд export хийхгүй).
