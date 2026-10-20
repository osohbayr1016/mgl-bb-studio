/**
 * asrSafety.ts — Зохиогчийн хяналтын ӨМНӨХ ХАБ-ын (хөдөлмөрийн аюулгүй
 * байдал, эрүүл ахуй) мэдээлэл ба танилцсан баталгааны ЦЭВЭР дүрмүүд.
 *
 * Талбай дээр очиж зохиогчийн хяналт хийх инженер тайлан үүсгэхийн өмнө
 * компанийн ХАБ-ын шаардлагыг уншиж, ойлгосноо чагтлан, гарын үсгээ зурж
 * баталгаажуулна (эзний хүсэлт 2026-09-21).  Энэ файл нь:
 *
 *   1. ХАРУУЛАХ БИЧВЭРИЙН ГАНЦ ЭХ СУРВАЛЖ (`ASR_SAFETY_CONTENT`).  Бичвэр
 *      кодод амьдардаг — `MyLeavesCard`-ын чөлөөний журам, `workSchedule`-ын
 *      ээлж шиг — учир нь хувилбар бүр git түүхэнд үлдэж, гарын үсэг зурсан
 *      мөр `content_hash`-аараа ЯГ тэр бичвэрт холбогдоно.
 *   2. Баталгааны хүчинтэй байдлын дүрэм (`ackProblem`) — route нь үүнийг
 *      дуудна, өөрөө дүрэм бичихгүй.
 *
 * ⚠️ БИЧВЭРИЙГ ЗОХИОХГҮЙ.  Компанийн албан ёсны ХАБ-ын заавар ба зөрчсөн
 *    тохиолдолд хүлээх хариуцлагын хэллэг ERP-д 2026-09-21-ний байдлаар
 *    БАЙХГҮЙ (репо даяар хайсан: зөвхөн `0120_norm_catalog`-ийн БНбД 12-02-24
 *    гарчиг л олдсон).  Тиймээс доорх агуулга нь ЭЗНИЙ БИЧВЭР ИРТЭЛ
 *    `placeholder: true` — UI тэр тугийг ил анхааруулга болгон харуулна.
 *    Эзний бичвэр ирмэгц: хэсгүүдийг солих, `placeholder`-ыг `false`,
 *    `version`-ыг өсгөх.  Хуучин баталгаанууд хуучин hash-аараа үлдэнэ.
 */

import { isSingleSegmentMediaUrl } from './mediaUrl';

export interface AsrSafetySection {
  /** Хэсгийн гарчиг. */
  heading: string;
  /** Догол мөр / жагсаалтын мөрүүд — дарааллаар харуулна. */
  items: string[];
}

export interface AsrSafetyContent {
  /** Хувилбарын шошго — бичвэр өөрчлөгдөх бүрд өсгөнө. */
  version: string;
  title: string;
  /** Гарчгийн доорх товч танилцуулга (заавал биш). */
  intro: string | null;
  sections: AsrSafetySection[];
  /** «Уншиж ойлгосон» чагтны хажуугийн өгүүлбэр. */
  confirmText: string;
  /**
   * `true` бол компанийн албан ёсны бичвэр ХАРААХАН ороогүй — UI ил
   * анхааруулна.  Прод дээр `true` байх ёсгүй.
   */
  placeholder: boolean;
}

export const ASR_SAFETY_CONTENT: AsrSafetyContent = {
  version: '0-placeholder',
  title: 'Хөдөлмөрийн аюулгүй байдал, эрүүл ахуйн (ХАБЭА) мэдээлэл',
  intro:
    'Зохиогчийн хяналтаар барилгын талбайд очихын өмнө доорх мэдээлэлтэй танилцаж, ойлгосноо баталгаажуулна уу.',
  sections: [
    {
      heading: 'Талбай дээр мөрдөх ерөнхий шаардлага',
      items: ['[Компанийн албан ёсны ХАБ-ын заавар — бичвэр хүлээгдэж байна]'],
    },
    {
      heading: 'Хувийн хамгаалах хэрэгсэл',
      items: ['[Компанийн албан ёсны ХАБ-ын заавар — бичвэр хүлээгдэж байна]'],
    },
    {
      heading: 'Шаардлагыг зөрчсөн тохиолдолд хүлээх хариуцлага',
      items: ['[Компанийн дотоод журам / хөдөлмөрийн гэрээний холбогдох заалт — бичвэр хүлээгдэж байна]'],
    },
  ],
  confirmText:
    'Дээрх ХАБ-ын мэдээллийг бүрэн уншиж, ойлгосон бөгөөд талбай дээр мөрдөхөө хүлээн зөвшөөрч байна.',
  placeholder: true,
};

/**
 * Бичвэрийн SHA-256 (hex).  Канон хэлбэр = хувилбар + гарчиг + хэсгүүд +
 * баталгааны өгүүлбэр, JSON-оор — талбарын дараалал энд ТОГТМОЛ тул ижил
 * агуулга үргэлж ижил hash өгнө.  `placeholder`, `intro` ОРОХГҮЙ: тэд
 * хэрэглэгчийн зөвшөөрсөн шаардлагын хэсэг биш.
 */
export async function asrSafetyContentHash(content: AsrSafetyContent): Promise<string> {
  const canon = JSON.stringify({
    version: content.version,
    title: content.title,
    sections: content.sections.map((s) => ({ heading: s.heading, items: [...s.items] })),
    confirmText: content.confirmText,
  });
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Баталгаа хэр удаан хүчинтэй вэ — гарын үсэг зурснаас хойш тайлан үүсгэх
 * хүртэлх хугацаа.  UI бүр «Шинэ тайлан» дарах бүрд шинээр зуруулдаг тул
 * энэ нь зөвхөн API-г шууд дуудсан хуучин id-г хаах эрүүл ахуйн хязгаар.
 * 24 цаг: талбай дээр сүлжээгүй, орой нь хадгалах тохиолдлыг хамарна.
 */
export const ASR_SAFETY_ACK_VALID_MS = 24 * 60 * 60 * 1000;

export interface AsrSafetyAckBody {
  project_id?: unknown;
  content_version?: unknown;
  content_hash?: unknown;
  signature_url?: unknown;
  confirmed?: unknown;
}

export type AsrSafetyAckBodyResult =
  | {
      ok: true;
      projectId: number | null;
      signatureUrl: string;
    }
  | { ok: false; status: 400 | 409; code: string; error: string };

/**
 * `POST /safety/acknowledgements`-ийн биеийг шалгана.
 *
 * - `confirmed` ЯГ `true` байх — чагтыг серверт ч шаардана.
 * - `signature_url` нь `/media/<нэг сегмент>` бөгөөд ТЭР ХЭРЭГЛЭГЧИЙН
 *   upload (`<sub>-` угтвар, upload.ts-ийн `ownsKey` дүрэм) — өөр хүний
 *   гарын үсгийн зургийг залгаж баталгаажуулж болохгүй.
 * - Хувилбар/hash нь ОДООГИЙН бичвэртэй таарах — таарахгүй бол 409
 *   `STALE_CONTENT`, клиент бичвэрээ дахин татаж дахин уншуулна.
 */
export function validateAckBody(
  body: AsrSafetyAckBody,
  userSub: number,
  current: { version: string; hash: string },
): AsrSafetyAckBodyResult {
  if (body.confirmed !== true) {
    return { ok: false, status: 400, code: 'NOT_CONFIRMED', error: 'Уншиж ойлгосноо баталгаажуулна уу.' };
  }
  if (!isSingleSegmentMediaUrl(body.signature_url)) {
    return { ok: false, status: 400, code: 'SIGNATURE_REQUIRED', error: 'Гарын үсэг зурна уу.' };
  }
  const key = body.signature_url.slice('/media/'.length);
  if (!key.startsWith(`${userSub}-`)) {
    return { ok: false, status: 400, code: 'SIGNATURE_NOT_OWNED', error: 'Гарын үсгийн зураг таных биш байна.' };
  }
  if (body.content_version !== current.version || body.content_hash !== current.hash) {
    return {
      ok: false,
      status: 409,
      code: 'STALE_CONTENT',
      error: 'ХАБ-ын мэдээлэл шинэчлэгдсэн байна — дахин уншиж баталгаажуулна уу.',
    };
  }
  let projectId: number | null = null;
  if (body.project_id != null && body.project_id !== '') {
    const n = Number(body.project_id);
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, status: 400, code: 'BAD_PROJECT', error: 'Invalid project id' };
    }
    projectId = n;
  }
  return { ok: true, projectId, signatureUrl: body.signature_url };
}

export interface AsrSafetyAckRow {
  id: number;
  user_id: number;
  project_id: number | null;
  acknowledged_at: string;
  report_id: number | null;
}

/**
 * Тайлан үүсгэх агшинд баталгааг шалгана.  `null` = зүгээр; мөр = хаах
 * шалтгаан.  Бүх тохиолдол 403 `SAFETY_ACK_REQUIRED` — клиент ялгахгүй,
 * ХАБ-ын цонхыг дахин нээнэ; `reason` нь зөвхөн лог/оношилгоонд.
 */
export function ackProblem(
  row: AsrSafetyAckRow | null,
  ctx: { userSub: number; projectId: number; nowMs: number },
): string | null {
  if (!row) return 'missing';
  if (row.user_id !== ctx.userSub) return 'other_user';
  if (row.report_id != null) return 'already_used';
  if (row.project_id != null && row.project_id !== ctx.projectId) return 'other_project';
  const at = Date.parse(row.acknowledged_at);
  if (!Number.isFinite(at)) return 'bad_timestamp';
  if (ctx.nowMs - at > ASR_SAFETY_ACK_VALID_MS) return 'expired';
  if (at - ctx.nowMs > 5 * 60 * 1000) return 'future';
  return null;
}
