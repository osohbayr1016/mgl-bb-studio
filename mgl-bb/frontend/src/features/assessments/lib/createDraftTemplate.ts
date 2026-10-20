/**
 * Ноорогоос сервер дээр `status='draft'` template үүсгээд id-г нь буцаана.
 *
 * Яагаад ШУУД хадгалдаг вэ: бүтэн дэлгэцийн засварлагч руу ШИЛЖИХ (navigate)
 * тул санах ойд байсан ноорог үлдэхгүй — Word-оос уншсан 206 мөр tab хаагдахад
 * алга болно.  Draft төлөв нь «хагас дутуу, хараахан хэрэглэгдэхгүй» гэдгийг
 * илэрхийлдэг тул spec §8-ийн «заавал нүдээр шалгаж батал» зарчим хэвээр:
 * админ засварлагчийг дуустал асуулга ямар ч раундад ороогүй хэвээр байна.
 *
 * `code` нь UNIQUE тул мөргөлдвөл (409) араас нь `-2`, `-3`… залгаж дахин
 * оролдоно — админыг нэр бодох гацаанд оруулахгүй.
 */
import { ApiError } from '@/shared/api/client';

import { createTemplate } from '../api';
import { draftToSchema } from './schemaDraft';
import type { SchemaDraft } from './schemaDraft';
import type { AssessmentTemplateDetail } from '../types';

const MAX_CODE_ATTEMPTS = 20;

export async function createDraftTemplate(draft: SchemaDraft): Promise<AssessmentTemplateDetail> {
  const { schema } = draftToSchema(draft);
  const baseCode = (draft.code.trim() || 'assessment').slice(0, 40);
  const titleMn = draft.titleMn.trim() || baseCode;

  for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt += 1) {
    const code = attempt === 1 ? baseCode : `${baseCode}-${attempt}`;
    try {
      const res = await createTemplate({
        code,
        title_mn: titleMn,
        title_en: draft.titleEn.trim() || null,
        description: draft.description.trim() || null,
        status: 'draft',
        team_codes: draft.teamCodes,
        schema,
      });
      return res.template;
    } catch (err) {
      // 409 = ижил кодтой загвар бий.  Бусад алдааг дуудагч талд шиднэ.
      if (err instanceof ApiError && err.status === 409) continue;
      throw err;
    }
  }
  throw new Error('code-collision');
}
