/**
 * MGL AI · НУУЦЫН РЕДАКЦ — backend-ийн ОРОЛТ (GAP-027, эзний шийдвэр 2026-09-11).
 *
 * ⚠️ ЭНД АЛГОРИТМ БАЙХГҮЙ, ЗОРИУД.  Канон хэрэгжүүлэлт нь `packages/mglai-common/src/redaction.ts`
 *    (runtime-agnostic, `file:../packages/mglai-common` хамаарал); ai/deployment (Session B)
 *    ИЖИЛ файлыг импортлоно — backend-only, deployment-only хуулбар ХОРИОТОЙ.
 *    Session C-ийн анхны хэрэгжүүлэлт ба тестүүд тэр багц руу шилжсэн (тест хэвээр).
 *
 * ⚠️ MERGE (A → C → B): Session C-ийн ижил нэртэй файл (бүтэн алгоритм) ↔ энэ re-export —
 *    ЭНЭ хувилбар ялна; C-ийн `redaction.test.ts` нь `./redaction.ts`-ээр энэ re-export-ыг
 *    ачаалж канон модулийн эсрэг ажиллана.
 *
 * Бодлого (ямар түлхүүр telemetry-д явах, ямар түвшинд) нь сервер/админ + B-ийн эзэмшил
 * (`ai/deployment/src/telemetry.ts FORBIDDEN_KEY_PARTS`); энд зөвхөн УТГЫН маск.
 */
export * from '@mgl/mglai-common/redaction';
