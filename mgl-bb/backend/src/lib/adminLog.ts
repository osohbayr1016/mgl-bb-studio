/**
 * Ирц/чөлөөн дээрх админ үйлдлийн audit лог (migration 0102).
 *
 * Админ (эсвэл ахлах) ирц нөхөж бүртгэх, гарах цаг нөхөх, нөхсөн ирц
 * устгах, чөлөө шууд бүртгэх/зөвшөөрөх/татгалзах/цуцлах/устгах бүрд
 * нэг мөр бичигдэнэ.  Append-only — засах/устгах endpoint байхгүй.
 * Бичилт best-effort: лог унавал үндсэн үйлдлийг унагахгүй (notify.ts
 * загвартай ижил).
 */

export type AttendanceAdminAction =
  | 'session_create'
  | 'session_edit'
  | 'session_clock_out'
  | 'session_delete'
  | 'leave_create'
  | 'leave_approve'
  | 'leave_reject'
  | 'leave_cancel'
  | 'leave_delete';

export async function logAdminAction(
  db: D1Database,
  args: {
    actorId: number;
    targetUserId: number | null;
    action: AttendanceAdminAction;
    /** Хамаарах огноо — ирцийн өдөр / чөлөөний эхлэх огноо. */
    date?: string | null;
    /** Хүний унших тайлбар (цаг, тэмдэглэл г.м.). */
    details?: string | null;
  },
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO attendance_admin_logs (actor_id, target_user_id, action, date, details)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(args.actorId, args.targetUserId, args.action, args.date ?? null, args.details ?? null)
      .run();
  } catch (err) {
    console.error('admin-log failed', err);
  }
}
