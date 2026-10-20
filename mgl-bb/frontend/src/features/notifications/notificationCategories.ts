import type { NotificationType } from '@/shared/types';

/** UI-д харагдах ангиллын түлхүүр — push `CATEGORY_OF`-оос өөр, хэрэглэгчид ойлгомжтой. */
export const NOTIFICATION_UI_CATEGORIES = [
  'all',
  'leaves',
  'projects',
  'attendance',
  'asr',
  'feedback',
  'assessments',
  /* Захиалагчийн портал — ирсэн материал, нийтлэлийн хариу.  `projects`-т
     нийлүүлээгүй нь санаатай: ажилтан «захиалагчаас ирсэн» урсгалыг тусад
     нь шүүх шаардлагатай болно. */
  'client',
  /* Нийтийн мэдээлэл — системийн шинэчлэлт, компанийн мэдээлэл, зарлал. */
  'announcements',
] as const;

export type UiCategory = (typeof NOTIFICATION_UI_CATEGORIES)[number];

/** ⚠️ Шинэ `NotificationType` нэмэхэд энд map заавал нэмнэ. */
export const UI_CATEGORY_OF: Record<NotificationType, Exclude<UiCategory, 'all'>> = {
  leave_requested: 'leaves',
  leave_approved: 'leaves',
  leave_rejected: 'leaves',
  leave_cancelled: 'leaves',
  project_deadline: 'projects',
  project_nudge: 'projects',
  progress_pending: 'projects',
  progress_approved: 'projects',
  progress_rejected: 'projects',
  task_assigned: 'projects',
  attendance_adjusted: 'attendance',
  attendance_confirm_requested: 'attendance',
  attendance_confirm_responded: 'attendance',
  attendance_announcement: 'attendance',
  asr_submitted: 'asr',
  asr_approved: 'asr',
  asr_rejected: 'asr',
  asr_visit_assigned: 'asr',
  asr_visit_cancelled: 'asr',
  suggestion_submitted: 'feedback',
  suggestion_updated: 'feedback',
  suggestion_resolved: 'feedback',
  pgp_feedback: 'feedback',
  assessment_assigned: 'assessments',
  assessment_submitted: 'assessments',
  client_submission_received: 'client',
  client_submission_reviewed: 'client',
  client_publication: 'client',
  client_message: 'client',
  client_signature_requested: 'client',
  client_signed: 'client',
  announcement_published: 'announcements',
  // Захирлаас ахлах руу — багийн гишүүдийн бүтээмжийн зөрүүнд анхаар (PGP-ийн санал шиг).
  team_gap_warning: 'feedback',
  // Баримтын гарын үсэг — «Баримт бичиг» нь төслийн хэсэг.
  doc_sign_requested: 'projects',
  doc_sign_decided: 'projects',
  // Revit-ийн өөрчлөлтийн мэдэгдэл — төслийн зураг дээрх ажил.
  revit_change_notice: 'projects',
  // Програмын хүсэлт — «Санал» ангилалд (шинэ ангиллын чип үүсгэхгүй: reviewer биш хүнд шинэ төрөл ил гарахгүй).
  engineering_request_new: 'feedback',
  engineering_request_activity: 'feedback',
  engineering_request_update: 'feedback',
};

export function matchesCategory(type: NotificationType, category: UiCategory): boolean {
  if (category === 'all') return true;
  return UI_CATEGORY_OF[type] === category;
}

export const UI_CATEGORY_I18N: Record<UiCategory, string> = {
  all: 'notifications.categoryAll',
  leaves: 'notifications.categoryLeaves',
  projects: 'notifications.categoryProjects',
  attendance: 'notifications.categoryAttendance',
  asr: 'notifications.categoryAsr',
  feedback: 'notifications.categoryFeedback',
  assessments: 'notifications.categoryAssessments',
  client: 'notifications.categoryClient',
  announcements: 'notifications.categoryAnnouncements',
};
