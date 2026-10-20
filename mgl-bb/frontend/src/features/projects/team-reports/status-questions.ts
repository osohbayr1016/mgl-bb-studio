/* =============================================================
 * Team Report — universal status-questions block.
 * -------------------------------------------------------------
 * Every team's Тайлбар бичиг starts with this short Q&A,
 * regardless of discipline.  The answers live alongside each
 * team's discipline-specific fields inside the same free-form
 * `answers_json` column (`status_q1`, `status_q2`, …) so no
 * migration is needed.
 *
 * Kept byte-identical with the backend copy at
 * `backend/src/lib/teamReportStatusQuestions.ts` so the print
 * route, the editing form, and any future server-side renderer
 * all show the exact same wording.
 *
 * The IDs (q1–q5) intentionally match the existing
 * `TEAM_NOTE_QUESTIONS` so a future feature can cross-reference
 * the two surfaces without re-keying.  q6 is new to this block.
 * ============================================================= */

export interface TeamReportStatusQuestion {
  /** Stable key used as both the React id and the
   *  `status_<id>` field name inside `answers_json`. */
  id: 'q1' | 'q2' | 'q3' | 'q4' | 'q5';
  /** Internal question text (interrogative) — shown in the editor
   *  and in the internal "Урьдчилан харах" preview/print.
   *  Update both this file and the backend mirror whenever it changes. */
  text: string;
  /** Client-facing declarative title — shown in the "Тайлан" client
   *  preview/print where the heading should read as a section topic,
   *  not a question. Same answer body, polished heading. */
  title: string;
}

export const TEAM_REPORT_STATUS_QUESTIONS: readonly TeamReportStatusQuestion[] = [
  {
    id: 'q1',
    text: 'Захиалагчаас бичиг баримт хугацаандаа бүрэн ирсэн үү?',
    title: 'Захиалагчаас ирэх бичиг баримт',
  },
  {
    id: 'q2',
    text: 'Бусад багаас шаардлагатай зураг / даалгавар / шийдэл ирсэн үү? Өөрчлөлт орж байгаа юу? Хүлээгдэж буй зүйл байгаа юу?',
    title: 'Бусад багийн хамаарал ба өөрчлөлт',
  },
  {
    id: 'q3',
    text: 'Дээрх асуудлыг шийдсэн үү? Хэрхэн шийдсэн, эсвэл яагаад шийдэгдээгүй байгааг бичнэ үү.',
    title: 'Шийдвэрлэлт',
  },
  {
    id: 'q4',
    text: 'Ажлын зургийн явц төлөвлөгөөт хугацаандаа үргэлжилж байна уу? Хэрэв үгүй бол нэмэлт шаардлагатай зүйл (хүн хүч, хугацаа г.м.) байгаа юу?',
    title: 'Ажлын явц ба нэмэлт шаардлага',
  },
  {
    id: 'q5',
    text: 'Энэ хугацаанд гүйцэтгэсэн гол ажил юу вэ? (товч 2–3 өгүүлбэрээр)',
    title: 'Гүйцэтгэсэн гол ажил',
  },
] as const;

/** Key used inside `answers_json` for a given question id. */
export function statusFieldKey(id: TeamReportStatusQuestion['id']): string {
  return `status_${id}`;
}
