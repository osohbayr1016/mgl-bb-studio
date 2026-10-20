import type { PgpPlan } from '@/shared/types';
import { PGP_SECTIONS } from './pgpFields';

/**
 * «Хөгжлийн төлөвлөгөөгөө бөглөсөн» гэж үзэх нэгдсэн дүрэм — ирцийн гарах
 * бүртгэлийн хаалт үүнийг ашиглана.
 *
 * PGP-д статус/submit огт байхгүй (санаатай, 0125 migration), тиймээс
 * бөглөлтийг зөвхөн агуулгаас нь гаргана: АЛЬ Ч period-ийн plan-д textarea
 * талбаруудаас дор хаяж нэг нь хоосон биш байвал хангалттай. Он шалгадаггүй —
 * ажилтнууд өсөлтийн төлөвлөгөөгөө ирэх оноор (жишээ нь 2026 онд '2027')
 * бөглөдөг тул тухайн-он шаардлага жинхэнэ бөглөсөн хүмүүсийг хаадаг байсан.
 * POST /pgp нь answers='{}' мөр үүсгэдэг тул зөвхөн мөр байгаа эсэхийг
 * шалгавал юу ч бичээгүй хүн «бөглөсөн» болно; select талбар (career_direction)
 * нь ''-г «Хараахан тодорхойгүй» гэсэн зөв утгаар хадгалдаг тул тооцохгүй.
 */
const TEXTAREA_KEYS = PGP_SECTIONS.flatMap((s) =>
  s.fields.filter((f) => f.type === 'textarea').map((f) => f.key),
);

export function isPgpFilled(plans: PgpPlan[]): boolean {
  // Backend answers_json-ийн утгуудыг string гэж баталгаажуулдаггүй тул
  // typeof-оор хамгаална (гараар хийсэн API дуудлага тоо ч хийж чадна).
  return plans.some((plan) =>
    TEXTAREA_KEYS.some((key) => {
      const v: unknown = plan.answers[key];
      return typeof v === 'string' && v.trim().length > 0;
    }),
  );
}
