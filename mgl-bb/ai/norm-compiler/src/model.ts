/**
 * Хөрвүүлэгчийн загвар = backend-ийн `registryTypes.ts` — ЯГ ТЭР файл.
 *
 * ⚠️ Хуулбар БИШ, дахин экспорт.  Хоёр тусдаа тодорхойлолт байвал
 *    хөрвүүлэгч нэг хэлбэр бичиж, хөдөлгүүр өөр хэлбэр уншина гэсэн
 *    зөрүү чимээгүй үүснэ; нэг эх сурвалжтай бол `tsc` барина.
 */
export type {
  CompiledBoundaryConflict,
  CompiledCase,
  CompiledClause,
  CompiledDocument,
  CompiledFormula,
  CompiledPredicate,
  CompiledProvenance,
  CompiledRule,
  CompiledRuleFamily,
  CurrentnessState,
  RegistryManifest,
  RegistryManifestEntry,
} from '../../../backend/src/lib/mglai/norm/registryTypes.ts';
