/**
 * Assessments (Ур чадвар / зан чанарын үнэлгээ) feature-ийн НИЙТИЙН гадаргуу.
 *
 * Cross-feature хэрэглэгчид (ProfilePage, routes, ирээдүйн тайлангууд) эндээс
 * import хийнэ — `@/features/assessments/...` гэж дотоод файл руу гүнзгий орох
 * шаардлагагүй.  Гэрээ: docs/dev/assessments-spec.md
 *
 * ⚠️ ЗОРИУДААР ГАДУУР ҮЛДЭЭСЭН зүйлс (chunk-ийн хил хамгаалах үүднээс — репогийн
 *    «бүх хуудас lazy» конвенц, CLAUDE.md → Frontend):
 *      · `AssessmentFillPage`, `admin/AssessmentAdminPage` — маршрутын хуудсууд,
 *        routes.tsx-д `lazy(() => import(...))`-аар шууд ачаалагдана.  Барел
 *        дундуур гаргавал тэдгээр нь эцгийнхээ chunk руу шингэнэ.
 *      · `components/SkillScatterChart`, `components/BehaviorRadarChart` —
 *        `recharts` (өөрийн chunk) чирдэг тул зөвхөн хэрэглэх газраасаа шууд.
 *      · `lib/exportAssessmentXlsx` (exceljs), `lib/docxParse`, `lib/schemaDraft`,
 *        `lib/chartImage` — зөвхөн админы урсгалд, мөн хүнд.
 */

// Схем + API-ийн төрлүүд (backend/src/lib/assessmentSchema.ts-ийн ихэр).
export * from './types';

// `/api/assessments` давхарга: fetch функцүүд + TanStack query түлхүүрүүд.
export * from './api';

// Оноо бодох цэвэр функцүүд (backend/src/lib/assessmentScore.ts-ийн ихэр).
export * from './lib/score';

// Хөнгөн, дахин ашиглагдах UI хэсгүүд.
export { default as MyAssessmentsSection } from './MyAssessmentsSection';
export { AssessmentProfilePrompt } from './components/AssessmentProfilePrompt';
export { LevelBadge, type LevelBadgeLevel } from './components/LevelBadge';
export { RatingRow } from './components/RatingRow';
export { ScaleLegend } from './components/ScaleLegend';
export { SectionPage, type AssessmentPageDef } from './components/SectionPage';
