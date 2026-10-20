import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader2, Printer } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { mediaUrl } from '@/shared/api/client';
import { useForceLightTheme } from '@/shared/hooks/useForceLightTheme';
import { bridgePrintToken } from '@/shared/lib/printAuth';
import { formatDate, formatDateTime } from '@/shared/lib/time';
import { Button } from '@/ui/button';
import { getCorrespondenceEntry } from './components/correspondenceSignatureApi';
import { CORR_DOC_STYLES } from './correspondencePrintStyles';

/**
 * RFI / CR бичгийн хэвлэх хуудас — `/correspondence/:id/print`.
 *
 * ProtectedRoute-ийн ГАДНА (`/quotes/:id/print`-тэй ижил): сервер
 * (`backend/lib/correspondencePdf.ts`) Browser Rendering-ээр `?t=<1 минутын
 * токен>`-той ачаалж PDF болгодог ба тэр токен ЗАХИАЛАГЧИЙНХ ч байж болно
 * (захиалагч зурсны дараах дахин рендер) — `/app/*` дотор байсан бол client
 * sandbox нь `/client` руу шидэх байсан.  Ганц API дуудлага:
 * `GET /api/correspondence/:id` (захиалагчид ч нээлттэй, эрх шалгадаг).
 *
 * `body[data-print-ready="true"]` — фонт + бүх зураг (ажилтны /media гарын
 * үсэг, захиалагчийн data-URL гарын үсэг, лого) декодлогдсоны ДАРАА л;
 * алдааны замд ч тавина, эс бөгөөс сервер 25 секунд хүлээгээд хоосон буцна.
 */
bridgePrintToken();

const TITLE_MN: Record<string, string> = { rfi: 'Мэдээлэл хүсэлт', cr: 'Өөрчлөлтийн хүсэлт' };
const TITLE_EN: Record<string, string> = { rfi: 'Request for Information', cr: 'Change Request' };

function Lbl({ mn, en }: { mn: string; en: string }) {
  return (
    <td className="corr-lbl" style={{ width: '32mm' }}>
      <span className="corr-lbl-mn">{mn}</span>
      <span className="corr-lbl-en">{en}</span>
    </td>
  );
}

export default function CorrespondencePrintPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  useForceLightTheme();
  const entryId = Number(id);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['correspondence', 'print', entryId],
    queryFn: () => getCorrespondenceEntry(entryId),
    enabled: Number.isFinite(entryId),
  });

  const entry = data?.entry;
  const settled = !isLoading;
  const auto = searchParams.get('auto') === '1';

  useEffect(() => {
    if (!settled) return;
    let cancelled = false;
    const done = () => {
      if (cancelled) return;
      document.body.setAttribute('data-print-ready', 'true');
      if (auto && entry) window.print();
    };
    const decodeAll = () =>
      Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined)));
    Promise.all([document.fonts?.ready ?? Promise.resolve(), decodeAll()])
      .then(decodeAll)
      .then(() => requestAnimationFrame(() => requestAnimationFrame(done)))
      .catch(done);
    const bail = setTimeout(done, 15000);
    return () => {
      cancelled = true;
      clearTimeout(bail);
    };
  }, [settled, auto, entry]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-gray-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (isError || !entry) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-red-600 text-sm">
        Бичиг ачаалж чадсангүй{error instanceof Error ? `: ${error.message}` : ''}
      </div>
    );
  }

  const docType = entry.doc_type ?? '';
  const titleMn = TITLE_MN[docType] ?? 'Албан бичиг';
  const titleEn = TITLE_EN[docType] ?? 'Official letter';
  const signed = entry.sign_status === 'signed';
  const pending = entry.sign_status === 'pending';
  const clientSig = data?.client_signature_data_url ?? null;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <style dangerouslySetInnerHTML={{ __html: CORR_DOC_STYLES }} />
      <div className="corr-toolbar sticky top-0 z-10 flex items-center justify-end gap-2 border-b bg-white/90 px-4 py-2 backdrop-blur">
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1.5" /> Хэвлэх
        </Button>
      </div>

      <div className="corr-paper">
        <div className="corr-doc" data-testid="corr-doc">
          <table className="corr-page">
            <thead>
              <tr>
                <th className="corr-headcell">
                  <div className="corr-head">
                    <div className="corr-head-main">
                      <div className="corr-head-title">
                        {titleMn}
                        {entry.ref_no && <span className="corr-head-no"> {entry.ref_no}</span>}
                      </div>
                      <div className="corr-head-sub">{titleEn}</div>
                      {entry.project_name && (
                        <div className="corr-head-project">{entry.project_name}</div>
                      )}
                    </div>
                    <div className="corr-head-meta">
                      <div>
                        <span className="corr-head-k">Doc. No.:</span> {entry.ref_no ?? '—'}
                      </div>
                      <div>
                        <span className="corr-head-k">Огноо:</span>{' '}
                        {formatDate(new Date(entry.log_date + 'T00:00:00'))}
                      </div>
                      <div>
                        <span className="corr-head-k">Төлөв:</span>{' '}
                        {signed ? 'Гарын үсэг зурагдсан' : pending ? 'Гарын үсэг хүлээгдэж байна' : '—'}
                      </div>
                    </div>
                    <img className="corr-logo" src="/logo.svg" alt="" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  {/* 1. Мэдээлэл */}
                  <div className="corr-section">
                    <div className="corr-section-title">
                      <span>1. Бичгийн мэдээлэл</span>
                      <span className="corr-section-en">Document information</span>
                    </div>
                    <table className="corr-t">
                      <tbody>
                        <tr>
                          <Lbl mn="Төсөл" en="Project" />
                          <td colSpan={3}>{entry.project_name ?? '—'}</td>
                        </tr>
                        <tr>
                          <Lbl mn="Гарчиг" en="Subject" />
                          <td colSpan={3} className="corr-wrap" style={{ fontWeight: 700 }}>
                            {entry.subject}
                          </td>
                        </tr>
                        <tr>
                          <Lbl mn="Илгээгч" en="From" />
                          <td className="corr-wrap">{entry.from_email ?? '—'}</td>
                          <Lbl mn="Хүлээн авагч" en="To" />
                          <td className="corr-wrap">{entry.to_email ?? '—'}</td>
                        </tr>
                        <tr>
                          <Lbl mn="Чиглэл" en="Direction" />
                          <td>{entry.direction === 'sent' ? 'MGL → Захиалагч' : 'Захиалагч → MGL'}</td>
                          <Lbl mn="CC / BCC" en="Copy" />
                          <td className="corr-wrap">{entry.cc_emails ?? '—'}</td>
                        </tr>
                        <tr>
                          <Lbl mn="Боловсруулсан" en="Prepared by" />
                          <td>{entry.author_name ?? '—'}</td>
                          <Lbl mn="Бүртгэсэн" en="Logged" />
                          <td>{formatDateTime(entry.created_at)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* 2. Агуулга */}
                  <div className="corr-section">
                    <div className="corr-section-title">
                      <span>2. Агуулга</span>
                      <span className="corr-section-en">Content</span>
                    </div>
                    <div className="corr-body">{entry.body?.trim() || '—'}</div>
                  </div>

                  {/* 3. Гарын үсэг */}
                  <div className="corr-section corr-sign">
                    <div className="corr-section-title">
                      <span>3. Баталгаажуулалт</span>
                      <span className="corr-section-en">Signatures</span>
                    </div>
                    <table className="corr-t">
                      <tbody>
                        <tr>
                          <td className="corr-sign-cell" style={{ width: '50%' }}>
                            <div className="corr-sign-who">Гүйцэтгэгч — MGL E&amp;C</div>
                            <div className="corr-sign-role">Consultant</div>
                            <div className="corr-sign-img-box">
                              {entry.signature_url ? (
                                <img
                                  className="corr-sign-img"
                                  src={mediaUrl(entry.signature_url)}
                                  alt="Гүйцэтгэгчийн гарын үсэг"
                                  data-testid="author-signature"
                                />
                              ) : (
                                <span className="corr-sign-missing">(гарын үсэг)</span>
                              )}
                            </div>
                            <div className="corr-sign-line">
                              {entry.author_name ?? '—'} ·{' '}
                              {formatDate(new Date(entry.log_date + 'T00:00:00'))}
                            </div>
                          </td>
                          <td className="corr-sign-cell" style={{ width: '50%' }}>
                            <div className="corr-sign-who">Захиалагч</div>
                            <div className="corr-sign-role">Client</div>
                            <div className="corr-sign-img-box">
                              {signed && clientSig ? (
                                <img
                                  className="corr-sign-img"
                                  src={clientSig}
                                  alt="Захиалагчийн гарын үсэг"
                                  data-testid="client-signature"
                                />
                              ) : pending ? (
                                <span className="corr-sign-pending">Гарын үсэг хүлээгдэж байна</span>
                              ) : (
                                <span className="corr-sign-missing">(гарын үсэг, огноо)</span>
                              )}
                            </div>
                            <div className="corr-sign-line">
                              {signed
                                ? `${entry.client_signer_name ?? '—'} · ${formatDateTime(entry.client_signed_at ?? '')}`
                                : ' '}
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
