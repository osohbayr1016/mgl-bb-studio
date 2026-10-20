/* =============================================================
 * Team Report — universal status-questions block (backend mirror).
 * -------------------------------------------------------------
 * Kept byte-identical with
 * `frontend/src/components/team-reports/status-questions.ts`.
 * The print page renders from the frontend copy; this copy is
 * here so any future server-side renderer or validator can pull
 * the same wording without round-tripping through HTTP.
 *
 * IDs (q1–q5) intentionally match `TEAM_NOTE_QUESTIONS` in
 * `teamNotesAi.ts`. q6 is new to this block.
 * ============================================================= */

export interface TeamReportStatusQuestion {
  id: 'q1' | 'q2' | 'q3' | 'q4' | 'q5';
  /** Internal interrogative phrasing — used by the editor and the
   *  internal "Урьдчилан харах" view. */
  text: string;
  /** Client-facing declarative title — used by the "Тайлан"
   *  client preview/print where headings should read as topics. */
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

export function statusFieldKey(id: TeamReportStatusQuestion['id']): string {
  return `status_${id}`;
}
