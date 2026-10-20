/**
 * ЗХ-ийн төслийн query түлхүүрүүд.
 *
 * ⚠️ Урьд нь энд `useAsrTargets()` hook болон `AsrTarget` төрөл байсан бөгөөд
 * тэдгээрийг ЗӨВХӨН `AsrTargetsPanel` (ЗХ хуудасны «Зохиогчийн хяналтын
 * төслүүд» самбар) хэрэглэдэг байв.  Эзний хүсэлтээр 2026-09-04-нд тэр
 * самбарыг хассан тул хоёулаа дагаж хасагдсан.  Backend-ийн
 * `GET/PATCH/DELETE /author-supervision/targets` замууд ХЭВЭЭР байгаа —
 * `CreateAsrProjectDialog` нь `POST`-ыг ашигласаар байна.
 */

export const ASR_TARGETS_KEY = ['asr', 'targets'] as const;
export const ASR_PROJECT_OPTIONS_KEY = ['asr', 'project-options'] as const;
