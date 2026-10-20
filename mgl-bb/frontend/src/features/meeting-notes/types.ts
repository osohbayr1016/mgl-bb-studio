export interface ParticipantMember {
  name: string;
  position?: string;
  /** Linked employee (users.id) — enables the saved-signature auto-insert. */
  user_id?: number;
  /** Populated server-side on GET for display/print (not sent on save). */
  signature_url?: string | null;
}

export interface ParticipantGroup {
  org: string;
  members: ParticipantMember[];
}

/** "Хэлэлцсэн асуудал"-ын нэг хэсэг — print дээр "1.N <heading>" гарчигтай
 *  № / Хүсэлт гаргагч / Тайлбар хүснэгт болж хэвлэгдэнэ (migration 0101). */
export interface DiscussionSection {
  /** Хэсгийн гарчиг, ж: "Захиалагч". */
  heading: string;
  /** Хүсэлт гаргагч байгууллага (хүснэгтийн нэгдсэн багана). */
  org: string;
  /** Тайлбарууд — мөр тус бүр автоматаар дугаарлагдана. */
  items: string[];
}

/** Хурлын төрөл — `company` = төсөлтэй холбоогүй компанийн хурал
 *  (инвариант: company ⇔ project_ids хоосон, сервер шалгана). */
export type MeetingKind = 'project' | 'company';

export interface MeetingProjectRef {
  id: number;
  name: string;
}

/** Editable minutes metadata — shared by the create dialog and the detail edit. */
export interface MeetingMeta {
  title: string;
  meeting_date: string;
  meeting_time: string;
  location: string;
  purpose: string;
  conclusion: string;
  language: string;
  kind: MeetingKind;
  /** Холбогдсон төслүүд (олон) — migration 0333 `meeting_projects`. */
  project_ids: number[];
  participants: ParticipantGroup[];
  discussion: DiscussionSection[];
  next_meeting_date: string;
  next_meeting_time: string;
}

export interface ActionItem {
  text: string;
  owner?: string;
  due?: string;
}

export interface MeetingListItem {
  id: number;
  title: string;
  meeting_date: string | null;
  meeting_time?: string | null;
  kind: MeetingKind;
  /** Эхний (үндсэн) төсөл — тусгал; бүх төсөл `projects`-д. */
  project_id: number | null;
  project_name: string | null;
  projects: MeetingProjectRef[];
  attendee_count: number;
  has_transcript?: number;
  has_final_text?: number;
  attendees: string | null;
  language: string;
  status: string;
  error: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  duration_seconds: number | null;
  submitted_at: string | null;
  has_analysis: number;
}

export interface MeetingProjectRow {
  id: number;
  name: string;
  meeting_count: number;
  last_meeting_date: string | null;
}

export const EMPTY_META: MeetingMeta = {
  title: '',
  meeting_date: '',
  meeting_time: '',
  location: '',
  purpose: '',
  conclusion: '',
  language: 'mn',
  kind: 'project',
  project_ids: [],
  participants: [],
  discussion: [],
  next_meeting_date: '',
  next_meeting_time: '',
};
