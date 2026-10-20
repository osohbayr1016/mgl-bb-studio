import { getMediaBaseUrl } from '@/shared/api/client';

/**
 * Login-гүй гарын үсгийн link-ийн API.  Эдгээр нь `/api` БИШ `/public/signing`
 * дор (bearer token өөрөө тухайн НЭГ баримтын эрх) тул `apiFetch` (auth толгой,
 * 401 redirect) ашиглахгүй — энгийн `fetch`.
 */
export type PublicSigningStatus = 'pending' | 'signed' | 'revoked' | 'expired';

export interface PublicSigningPayload {
  request: {
    status: PublicSigningStatus;
    role_label: string;
    signer_name_hint: string | null;
    expires_at: string;
    signed_name: string | null;
    signed_at: string | null;
  };
  company: {
    name: string;
    legal_name: string;
    tagline: string;
    website: string;
    contact_email: string;
  };
  /** revoked/expired үед null — хаагдсан link баримтын мэдээлэл задруулахгүй. */
  document: {
    project_name: string;
    document_type: string;
    document_no: string | null;
    title: string;
    document_date: string;
    prepared_by: string | null;
    prepared_by_position: string | null;
    /**
     * `pdf` (өгөгдмөл — RFI/CR, ЗХ тайлан: сервер рендерлэсэн PDF) | `docx` («Баримт бичиг»-ийн
     * Drive дахь Word файл: хөтөч өөрөө render хийнэ, гарын үсэг ЯГ тэр файлд суна — 0397).
     */
    format?: 'pdf' | 'docx';
    file_name?: string;
    /** docx: зурагчийн мөр (баримт дээрх үүрэг, албан тушаал, нэр). */
    slot?: { role: string; position: string; name: string; client: boolean };
    /** docx: мөрийн албан тушаалын нүд хоосон — зурагч өөрөө бичиж болно. */
    ask_position?: boolean;
    /** docx: зурсны дараа гарын үсэгтэй баримтыг (7 хоног) харах боломжтой. */
    signed_preview?: boolean;
    /**
     * docx: зурсны дараах баримтын хэлбэр.  `pdf` = сервер PDF болгоно, засварлах .docx зурсан хүнд
     * очихгүй (2026-10-12).  Байхгүй (хуучин worker) бол .docx-ийг хөтөч өөрөө харуулна.
     */
    signed_format?: 'pdf' | 'docx';
  } | null;
}

export class PublicSigningError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'PublicSigningError';
    this.status = status;
  }
}

function base(token: string): string {
  return `${getMediaBaseUrl()}/public/signing/${encodeURIComponent(token)}`;
}

/**
 * Баримтын байт: зурахаас өмнө .docx, зурсны дараа PDF.  `download` — гарын үсэг зурсны дараа файлыг
 * татах (сервер `attachment` толгой өгнө).
 */
export const publicDocumentUrl = (token: string, opts?: { download?: boolean }): string =>
  `${base(token)}/document${opts?.download ? '?download=1' : ''}`;

/**
 * Зурсан снапшотын эх .docx — ЗӨВХӨН серверийн PDF рендерлэгчид (`/sign/:token/print`); `grant` нь
 * сервер өгсөн 3 минутын түр эрх.  Захиалагчийн хөтөч энэ эрхийг хэзээ ч авахгүй.
 */
export const publicDocumentSourceUrl = (token: string, grant: string): string =>
  `${base(token)}/document?source=1&r=${encodeURIComponent(grant)}`;

async function readJson<T>(res: Response): Promise<T> {
  const payload = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new PublicSigningError(payload.error || 'Хүсэлт амжилтгүй боллоо', res.status);
  }
  return payload;
}

export async function fetchSigningPayload(token: string, signal?: AbortSignal): Promise<PublicSigningPayload> {
  return readJson<PublicSigningPayload>(await fetch(base(token), { cache: 'no-store', signal }));
}

export async function submitPublicSignature(
  token: string,
  body: { signature_data_url: string; signer_name: string; signer_position?: string; consent: true },
): Promise<{ ok: true; status: 'signed'; signed_name: string; signed_at: string; role_label: string; signed_preview?: boolean; signed_format?: 'pdf' | 'docx' }> {
  return readJson(
    await fetch(`${base(token)}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(body),
    }),
  );
}

/**
 * «Яг одоо нээлттэй» — docx link-ийн ажилтны цонхонд бодит цагаар харагдана.  Хариу нь
 * link-ийн төлөв: хооронд нь цуцлагдсан бол хуудас өөрийгөө шинэчилнэ.  Алдааг залгина.
 */
export async function pingPresence(token: string): Promise<PublicSigningStatus | null> {
  try {
    const res = await fetch(`${base(token)}/presence`, { method: 'POST', cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { status?: PublicSigningStatus };
    return body.status ?? null;
  } catch {
    return null;
  }
}
