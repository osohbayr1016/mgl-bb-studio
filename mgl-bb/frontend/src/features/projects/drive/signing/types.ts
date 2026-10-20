/**
 * Баримтын гарын үсэг + захирлын баталгаажуулалт — `backend/src/routes/driveSigning.ts`-ийн
 * хариуны хэлбэрүүд (ИХЭР — хамт өөрчлөгдөнө).
 */

export interface SignPerson {
  id: number;
  name: string;
}

export type SlotState = 'empty' | 'erp' | 'other';
export type SignRequestStatus = 'pending' | 'approved' | 'returned' | 'cancelled';
export type SigningUnsupported = 'NOT_DOCX' | 'TOO_LARGE' | 'NO_SLOTS';

export interface SignSlotView {
  key: string;
  /** Ижил толгой мөрийн бүлэг (RFI-ийн «хүсэлт» / «хариу» хэсэг). */
  group: number;
  role: string;
  position: string;
  name: string;
  date: string;
  /** Захирлын (батлах) мөр. */
  approver: boolean;
  /** Захиалагчийн мөр («Захиалагчаас баталсан») — ERP-д хэн ч зурахгүй. */
  client: boolean;
  /** empty = хоосон · erp = системээр зурсан · other = гараар оруулсан зураг. */
  state: SlotState;
  /** `external` = гаднын (login-гүй) link-ээр зурсан: `name` нь зурсан хүний бичсэн нэр,
   *  `id` null, `sent_by` нь link илгээсэн ажилтан. */
  signer: {
    id: number | null;
    name: string;
    at: string;
    action: 'sign' | 'approve' | 'external';
    sent_by: SignPerson | null;
  } | null;
  can_sign: boolean;
  /** Мөрөнд өөр хүний нэр — зурахын өмнө «энэ мөр минийх» баталгаажуулалт. */
  needs_name_confirm: boolean;
  mine: boolean;
  ask_user: SignPerson | null;
  /** Гаднын (login-гүй) link илгээж болох мөр — сервер шийднэ (хуучин worker-т байхгүй). */
  can_link?: boolean;
}

export interface SignRequestView {
  id: number;
  status: SignRequestStatus;
  requested_by: SignPerson | null;
  approver: SignPerson | null;
  note: string | null;
  created_at: string;
  decided_by: SignPerson | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface SignHistoryItem {
  id: number;
  /** add_client_row = admin «Захиалагч хүлээн авсан» мөр нэмсэн (0397+). */
  action: 'sign' | 'approve' | 'ask' | 'external' | 'add_client_row';
  /** external үед link илгээсэн ажилтан. */
  user: SignPerson | null;
  target: SignPerson | null;
  /** Гаднын link-ээр зурсан хүний нэр. */
  external_name?: string | null;
  slot_role: string | null;
  slot_name: string | null;
  created_at: string;
}

export interface SigningState {
  file: { id: string; name: string; modified_time: string | null; size: number | null; parent_id: string | null };
  supported: boolean;
  reason: SigningUnsupported | null;
  slots: SignSlotView[];
  me: {
    id: number;
    name: string;
    doc_name: string;
    position: string | null;
    is_approver: boolean;
    profile_signature_url: string | null;
  };
  approver: SignPerson | null;
  /** Захирлын «Батлах» товчны мөр (зөвхөн захиралд). */
  default_approve_slot: string | null;
  request: SignRequestView | null;
  /** Захиалагчийн гарын үсэг (хуучин worker-т байхгүй; баримт уншигдаагүй бол null). */
  client_sign?: ClientSignState | null;
  can_request: boolean;
  /** Гаднын гарын үсгийн link үүсгэх / цуцлах (зөвхөн admin). */
  can_manage_links?: boolean;
  /** Захиалагчийн мөргүй (RFI) — «Захиалагч хүлээн авсан» мөр нэмж link үүсгэж болно. */
  client_row_addable?: boolean;
  history: SignHistoryItem[];
  changed_since_signing: boolean;
  /** POST …/sign-ийн хариунд: энэ удаад захиралд хүсэлт явсан эсэх. */
  requested?: boolean;
}

export interface FileSignStatus {
  request_status: SignRequestStatus | null;
  signatures: number;
  last_signed_at: string | null;
  /** Хүлээгдэж буй гаднын гарын үсгийн link (0397; хуучин worker-т байхгүй). */
  links_pending?: number;
  /** Захиалагчийн гарын үсэг (2026-10-19; хуучин worker-т байхгүй). */
  client?: ClientSignState | null;
}

/**
 * Захиалагчийн гарын үсгийн төлөв — backend `lib/driveClientSign.ts` (ИХЭР).
 * CR нь захиалагч баталгаажуулж гарын үсэг зурсны ДАРАА л «Батлагдсан» (RFI-д шаардахгүй):
 * «Батлагдсан» = захирал баталсан (`request.status === 'approved'`) ∧ `complete`.
 */
export interface ClientSignState {
  required: boolean;
  /** Захиалагчийн талын мөр (захиалагчийн мөр + гаднын link-тэй / link-ээр зурсан мөр). */
  total: number;
  signed: number;
  complete: boolean;
  /** Баримтад захиалагчийн мөр алга — link үүсгэхдээ «Захиалагчийн мөр нэмэх». */
  missing_row: boolean;
}

/** Захирал баталсан ч захиалагчийн гарын үсэг дутуу — «Батлагдсан» биш. */
export function awaitingClient(requestStatus: SignRequestStatus | null | undefined, client: ClientSignState | null | undefined): boolean {
  return requestStatus === 'approved' && !!client && client.required && !client.complete;
}

/* ------------------------------------------------------------------ */
/*  Гаднын (login-гүй) гарын үсгийн link — backend `routes/driveSigningLinks.ts` (0397)  */
/* ------------------------------------------------------------------ */

export type SignLinkStatus = 'pending' | 'signing' | 'signed' | 'revoked' | 'expired';

export interface SignLinkView {
  id: number;
  slot_key: string;
  slot_role: string;
  slot_name: string;
  slot_client: boolean;
  role_label: string;
  signer_name_hint: string | null;
  status: SignLinkStatus;
  requested_by: number;
  requested_by_name: string | null;
  expires_at: string;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  /** Зурагчийн хуудас яг одоо нээлттэй (сүүлийн 60 сек). */
  viewing_now: boolean;
  signed_name: string | null;
  signed_position: string | null;
  signed_at: string | null;
  snapshot_ready: boolean;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
}

export interface SignLinksState {
  links: SignLinkView[];
  /** Энэ файлд Drive-д бичигдсэн хамгийн сүүлийн гарын үсгийн үйл явдал — өөрчлөгдвөл баримтыг дахин ачаална. */
  version: number;
}

export interface CreatedSignLink {
  link: SignLinkView | null;
  /** Түүхий токентой URL — ЗӨВХӨН энэ хариунд нэг удаа (DB-д hash л). */
  url: string;
}

export interface PendingSignatures {
  is_approver: boolean;
  approvals: Array<{
    id: number;
    file_id: string;
    file_name: string;
    project_name: string | null;
    requested_by: string;
    created_at: string;
    note: string | null;
    link: string;
  }>;
  asks: Array<{
    file_id: string;
    file_name: string;
    project_name: string | null;
    asked_by: string;
    created_at: string;
    link: string;
  }>;
}
