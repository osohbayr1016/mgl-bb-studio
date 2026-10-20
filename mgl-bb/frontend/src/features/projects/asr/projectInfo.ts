/**
 * ЗХ-ийн товч танилцуулгыг БЭЛТГЭХ / ХАРУУЛАХ туслахууд.
 *
 * ⚠️ ИХЭР: `backend/src/lib/asrProjectInfo.ts`.  Хоёулаа `resolveProjectIdentity`
 *    дээр суурилдаг тул шатлал давхардахгүй; энд зөвхөн ХАДГАЛААГҮЙ ноорогийн
 *    зам (сервер хараахан мэдэхгүй тайлан) ба ХАРАГДАХ мөрүүд амьдарна.
 *
 * ⚠️ Мөрийн ШОШГО нь ЗОРИУДААР монголоор hardcode — `AsrDocument.tsx`-ийн яг
 *    тэр зарчим: энэ бол ЦААСАН МАЯГТ дээр хэвлэгдэх бичвэр, хэлээр хувирдаг
 *    UI биш.  Засварлагч дэлгэц дээр ЯГ хэвлэгдэх мөрүүдийг харуулна —
 *    ингэснээр инженер юу гарахыг урьдчилан мэднэ.
 */

import { resolveProjectIdentity } from '@/shared/lib/projectIdentity';
import type { AsrProjectInfo } from './types';

/** `GET /api/projects/:id`-ийн хариунаас танилцуулга гаргана. */
export function asrProjectInfoFrom(detail: {
  project: Parameters<typeof resolveProjectIdentity>[0]['project'];
  passport?: Parameters<typeof resolveProjectIdentity>[0]['passport'];
  clients?: Parameters<typeof resolveProjectIdentity>[0]['clients'];
}): AsrProjectInfo {
  const id = resolveProjectIdentity({
    project: detail.project,
    passport: detail.passport ?? null,
    clients: detail.clients ?? [],
  });
  return {
    title: id.title,
    shortName: id.shortName,
    drawingNo: id.drawingNo,
    docNo: id.docNo,
    clientName: id.clientName,
    location: id.location,
    startDate: id.startDate,
    finishDate: id.finishDate,
    disciplines: id.disciplines,
  };
}

/** `2026-07-09` → `2026.07.09`.  Задлаагүй чөлөөт текстийг хэвээр үлдээнэ. */
function dot(v: string | null): string {
  if (!v) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.replace(/-/g, '.') : v;
}

export interface AsrInfoRow {
  label: string;
  value: string;
}

/**
 * Баримт БА засварлагч дээр гарах мөрүүд — НЭГ л жагсаалт.
 *
 * ⚠️ Хоосон утгатай мөр ОГТ гарахгүй: ЗХ нь нэг хуудсанд багтах ёстой бөгөөд
 *    прод дээр паспортын ихэнх талбар хоосон байна (16 паспортын 8-д нь л
 *    шифр, Doc. No. нэг ч мөрөнд алга).  Хоосон мөр хэвлэх нь баримтыг
 *    «дутуу бөглөсөн» мэт харагдуулна.
 */
export function asrInfoRows(info: AsrProjectInfo | null | undefined): AsrInfoRow[] {
  if (!info) return [];
  const period = [dot(info.startDate), dot(info.finishDate)].filter(Boolean).join(' – ');
  const rows: AsrInfoRow[] = [
    /* ⚠️ «Албан ёсны нэр» ба «Байршил» ЭНД БАЙХГҮЙ — эзэн 2026-09-28-нд
       ЗХ-ийн маягтаас (хэвлэлт, засварлагч, Word) хасуулсан.  Паспорт дээр
       хэвээр. */
    /* ⚠️ «Ажлын хэсэг» (паспортын disciplines) ч ЭНД БАЙХГҮЙ — эзэн 2026-09-30
       хасуулсан; ЗХ-д аль баг явсныг «Хяналтаар явсан» мөр аль хэдийн хэлдэг. */
    /* ⚠️ «Зургийн шифр» ЭНД БАЙХГҮЙ — санаатай.  Тэр нь баримтын running
       толгойд БА маягтын 2-р мөрөнд аль хэдийн гардаг; блокт давхардуулбал
       нэг хуудсан дээр гурван удаа гарна.  Засварлагч дээр ч мөн адил:
       «Шифр» гэсэн бөглөх талбар тусдаа байна. */
    /* ⚠️ «Төслийн» гэсэн угтвар ЗААВАЛ: маягтын толгойн «Doc. No.» нь
       `headerDocNo()`-оор гардаг ЗХ-ийн ӨӨРИЙН дугаар (ASR-001), энэ нь
       ПАСПОРТЫН баримтын дугаар — хоёр өөр зүйл. */
    { label: 'Төслийн Doc. No.', value: info.docNo },
    { label: 'Захиалагч', value: info.clientName },
    { label: 'Гэрээний хугацаа', value: period },
  ];
  return rows.filter((r) => r.value.trim().length > 0);
}

/* ------------------------------------------------------------------ */
/*  Маягтын мөрүүдийг хослуулах — хэвлэх баримт БА засварлагч хоёулаа    */
/*  (2026-09-25-аас засварлагч нь баримтын хэлбэртэй тул ЭНД нэг газар). */
/*  ⚠️ `buildAsrDocx.ts`-ийн `FULL_WIDTH_INFO` ихэр хэвээр — хамт өөрчил. */
/* ------------------------------------------------------------------ */

/** Төслийн мэдээллийн монгол шошго → англи дэд шошго. */
export const INFO_LABEL_EN: Record<string, string> = {
  'Албан ёсны нэр': 'Official title',
  'Төслийн Doc. No.': 'Project Doc. No.',
  Захиалагч: 'Client',
  Байршил: 'Location',
  'Гэрээний хугацаа': 'Contract period',
  'Ажлын хэсэг': 'Discipline',
};

/**
 * Утга нь урт байх нь тодорхой мөрүүд — ХОСЛОХГҮЙ, бүтэн өргөнөөр гарна.
 * Бусад мөр нь 44 тэмдэгтээс урт бол мөн бүтэн өргөнд шилжинэ (`pairInfoRows`).
 */
export const FULL_WIDTH_INFO = new Set(['Албан ёсны нэр', 'Байршил']);

/** Маягтын нэг мөр: зүүн хос, сонголттой баруун хос (эсвэл бүтэн өргөн). */
export interface InfoFormRow {
  left: AsrInfoRow;
  right: AsrInfoRow | null;
  /** `true` бол зүүн утга гурван баганыг эзэлнэ (урт бичвэр). */
  full: boolean;
}

/**
 * Богино мөрүүдийг ХОСООРОО нэг мөрөнд байрлуулна (шошго|утга|шошго|утга).
 * Хоосон мөрийг `asrInfoRows` өөрөө хаясан байдаг тул энд зөвхөн багцлалт.
 *
 * Хос үүсээгүй сүүлчийн мөр нь мөн бүтэн өргөнд шилжинэ — нэг талдаа хоосон
 * нүдтэй мөр нь цаасан дээр «дутуу бөглөсөн» мэт харагддаг.
 */
export function pairInfoRows(rows: AsrInfoRow[]): InfoFormRow[] {
  const out: InfoFormRow[] = [];
  let pending: AsrInfoRow | null = null;
  const flush = () => {
    if (!pending) return;
    out.push({ left: pending, right: null, full: true });
    pending = null;
  };
  for (const r of rows) {
    if (FULL_WIDTH_INFO.has(r.label) || r.value.length > 44) {
      flush();
      out.push({ left: r, right: null, full: true });
      continue;
    }
    if (pending) {
      out.push({ left: pending, right: r, full: false });
      pending = null;
    } else {
      pending = r;
    }
  }
  flush();
  return out;
}
