/**
 * `@mgl/mglai-common/turn` — ХУВААЛЦСАН, КЛИЕНТЭЭС ХАМААРАХГҮЙ ЭЭЛЖИЙН ХӨДӨЛГҮҮРИЙН нийтийн гадаргуу.
 *
 * Хөтөч (BrowserTurnAdapter) · ажилтны runtime (`POST /turn`) · Revit add-in (runtime-аар) —
 * бүгд ЭНЭ нэг хэрэгжүүлэлтийг импортлоно.  Оркестраци, validator, гэрээ, давталтын
 * хамгаалалт, санамжийн сонголт бүгд энд; клиент нь ЗӨВХӨН тээвэр (transports.ts) +
 * хадгалалт (MemoryStorage) + UI өгнө.
 *
 * Нэр давхцсан модулиуд (`contract` ↔ `validator`: numbersIn/splitSentences;
 * `validate` ↔ `validator`: validateAnswer/ValidationResult) энд НИЙЛҮҮЛЭГДЭЭГҮЙ —
 * тэдгээрийг дэд замаар импортлоно: `@mgl/mglai-common/turn/validator` г.м.
 */
export * from './engine.ts';
export * from './transports.ts';
export * from './fetchTransports.ts';
export * from './types.ts';
export * from './aiEvents.ts';
export * from './aiErrors.ts';
export * from './aiBudget.ts';
export * from './aiMachine.ts';
export * from './runtimeTypes.ts';
export * from './memory.ts';
export * from './revitAction.ts';
