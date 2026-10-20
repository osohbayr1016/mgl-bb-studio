/**
 * /meetings/:id/print — printable meeting minutes (протокол) for the PDF route
 * (GET /api/meetings/:id/pdf drives this via Browser Rendering).  Mirrors
 * QuotePrintPage: bridges `?t=<jwt>` into localStorage before the first
 * apiFetch, forces the light palette, and sets body[data-print-ready] once the
 * data is in so puppeteer snapshots a fully-painted page.
 *
 * Layout mirrors the firm's scanned протокол: navy (#0F243E) title chip +
 * ["ЭМ ЖИ ЭЛ И ЭН СИ" ХХК] bracket, "Төслийн нэр:" line above the info table,
 * numbered per-party discussion tables (1.N — № / Хүсэлт гаргагч / Тайлбар),
 * an italic "Дараагийн уулзалтыг …" line, the org-grouped signature block and
 * the meeting date repeated bottom-left on every printed page.
 */
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, MEDIA_BASE_URL } from '@/shared/api/client';
import { HandSignature, whenHandSignsReady } from '@/shared/components/HandSignature';
import { useForceLightTheme } from '@/shared/hooks/useForceLightTheme';
import type { ParticipantGroup, ActionItem, DiscussionSection } from './types';
import { bridgePrintToken } from '@/shared/lib/printAuth';

// Bridge the print token BEFORE React mounts. `markHeadless` also stamps
// body[data-headless-print] when a token is present so the in-flow date is
// hidden under print CSS (Browser Rendering already draws it via footerTemplate,
// which would otherwise double up on the last page). Manual window.print() has
// no token, so the date stays visible there.
bridgePrintToken({ markHeadless: true });

interface PrintData {
  meeting: {
    title: string;
    meeting_date: string | null;
    meeting_time: string | null;
    location: string | null;
    purpose: string | null;
    conclusion: string | null;
    project_name: string | null;
    kind?: 'project' | 'company';
    projects?: Array<{ id: number; name: string }>;
    attendee_count?: number;
    final_text?: string | null;
    participants: ParticipantGroup[];
    discussion: DiscussionSection[];
    next_meeting_date: string | null;
    next_meeting_time: string | null;
  };
  analysis: {
    summary: string | null;
    decisions: unknown[];
    action_items: unknown[];
  } | null;
}

function asStrings(arr: unknown[]): string[] {
  return arr.filter((d): d is string => typeof d === 'string' && d.trim() !== '');
}
function asActions(arr: unknown[]): ActionItem[] {
  const out: ActionItem[] = [];
  for (const a of arr) {
    if (a && typeof a === 'object') {
      const o = a as Record<string, unknown>;
      const text = typeof o.text === 'string' ? o.text : '';
      if (text.trim())
        out.push({
          text,
          owner: typeof o.owner === 'string' ? o.owner : undefined,
          due: typeof o.due === 'string' ? o.due : undefined,
        });
    } else if (typeof a === 'string' && a.trim()) {
      out.push({ text: a });
    }
  }
  return out;
}

/** "2026-01-30" → "2026.01.30" (хуудас бүрийн зүүн доод буланд). */
function dotDate(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return iso.replace(/-/g, '.');
}

/** Дараагийн уулзалтын огноо/цагаас протоколын налуу өгүүлбэрийг угсарна:
 *  "Дараагийн уулзалтыг 2026 оны 02 сарын 13-ны өглөө 10:00 цагт хийхээр болов."
 *  -ны/-ний дагавар нь өдрийн сүүлийн цифрийн эгшиг зохицлоор (1, 4, 9 → -ний). */
function nextMeetingSentence(date: string | null, time: string | null): string | null {
  const m = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) return null;
  const [, y, mo, d] = m;
  const dayNum = Number(d);
  const last = dayNum % 10;
  const suffix = last === 1 || last === 4 || last === 9 ? 'ний' : 'ны';
  let when = ' өдөр';
  // 1-2 оронтой цагийг хоёуланг нь хүлээж авна ("9:00" → "09:00") — DB-д
  // шууд бичсэн/хуучин утгыг ч эдгээнэ.
  const tm = time ? /^(\d{1,2}):(\d{2})/.exec(time.trim()) : null;
  if (tm && Number(tm[1]) < 24) {
    const hour = Number(tm[1]);
    const part = hour < 12 ? 'өглөө' : hour < 18 ? 'өдрийн' : 'оройн';
    when = ` ${part} ${String(hour).padStart(2, '0')}:${tm[2]} цагт`;
  }
  return `Дараагийн уулзалтыг ${Number(y)} оны ${mo} сарын ${dayNum}-${suffix}${when} хийхээр болов.`;
}

const COMPANY_BRACKET = '["ЭМ ЖИ ЭЛ И ЭН СИ" ХХК]';

export default function MeetingPrintPage() {
  const { id: raw } = useParams<{ id: string }>();
  const id = Number(raw);
  useForceLightTheme();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['meeting', id, 'print'],
    queryFn: () => apiFetch<PrintData>(`/meetings/${id}`),
    retry: false,
  });

  useEffect(() => {
    // Mark ready once the meeting is in OR the load failed — the error branch
    // must set the marker too so headless Browser Rendering fails fast instead
    // of hanging until the puppeteer timeout.
    if (!data?.meeting && !isError) return;
    let cancelled = false;
    const markReady = () => {
      if (!cancelled) document.body.setAttribute('data-print-ready', 'true');
    };
    const afterFonts = () => void whenHandSignsReady().then(markReady);
    if (document.fonts?.ready) void document.fonts.ready.then(afterFonts);
    else afterFonts();
    return () => {
      cancelled = true;
    };
  }, [data?.meeting, isError]);

  if (isLoading) return <div style={{ padding: 48, textAlign: 'center' }}>Уншиж байна…</div>;
  if (isError || !data?.meeting)
    return <div style={{ padding: 48, textAlign: 'center', color: '#b00' }}>Хурал олдсонгүй</div>;

  const m = data.meeting;
  const discussion = (Array.isArray(m.discussion) ? m.discussion : []).filter(
    (s) => s.heading || s.org || s.items.length,
  );
  const decisions = data.analysis ? asStrings(data.analysis.decisions) : [];
  const actions = data.analysis ? asActions(data.analysis.action_items) : [];
  const participants = Array.isArray(m.participants) ? m.participants : [];
  // Олон төсөл (0333): бүгдийг « · »-ээр; хуучин хариу project_name-руу буцна.
  const projectNames = (m.projects?.length ? m.projects.map((p) => p.name) : m.project_name ? [m.project_name] : []);
  const attendeeCount =
    typeof m.attendee_count === 'number'
      ? m.attendee_count
      : participants.reduce((n, g) => n + g.members.filter((x) => x.name?.trim()).length, 0);
  const footDate = dotDate(m.meeting_date);
  const nextMeeting = nextMeetingSentence(m.next_meeting_date, m.next_meeting_time);

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="meeting-print">
        <div className="mp-titlebar">
          <span className="mp-title">ХУРЛЫН ТЭМДЭГЛЭЛ</span>
          <span className="mp-org">{COMPANY_BRACKET}</span>
        </div>

        {/* Төсөлтэй холбогдсон бол төслийн нэр, үгүй бол хурлын өөрийн сэдэв —
            хурлын гарчгийг "Төслийн нэр" гэж андуурч шошголохгүй. */}
        {projectNames.length > 0 ? (
          <p className="mp-projectline">
            <strong>{projectNames.length > 1 ? 'Төслүүд:' : 'Төслийн нэр:'}</strong> {projectNames.join(' · ')}
            {m.title ? (
              <>
                <br />
                <strong>Хурлын сэдэв:</strong> {m.title}
              </>
            ) : null}
          </p>
        ) : m.title ? (
          <p className="mp-projectline">
            <strong>Хурлын сэдэв:</strong> {m.title}
          </p>
        ) : null}

        <table className="mp-info">
          <tbody>
            <tr>
              <th>Өдөр</th>
              <td>{m.meeting_date || '—'}</td>
            </tr>
            <tr>
              <th>Цаг</th>
              <td>{m.meeting_time || '—'}</td>
            </tr>
            <tr>
              <th>Уулзах газар</th>
              <td>{m.location || '—'}</td>
            </tr>
            <tr>
              <th>Оролцогч тал</th>
              <td>
                {attendeeCount > 0 && <div className="mp-pcount">Нийт {attendeeCount} хүн оролцов</div>}
                {participants.length === 0 ? (
                  '—'
                ) : (
                  participants.map((g, i) => (
                    <div key={i} className="mp-pgroup">
                      {g.org && <div className="mp-porg">{g.org}</div>}
                      <ul>
                        {g.members.map((mem, mi) => (
                          <li key={mi}>
                            {mem.name}
                            {mem.position ? ` – ${mem.position}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </td>
            </tr>
            <tr>
              <th>Уулзалтын зорилго</th>
              <td className="mp-pre">{m.purpose || '—'}</td>
            </tr>
          </tbody>
        </table>

        {/* Хэлэлцсэн асуудал — талуудын дугаарлагдсан хүснэгтүүд (1.1, 1.2 …). */}
        {discussion.map((s, si) => (
          <section key={si} className="mp-section">
            <h3 className="mp-section-heading">
              1.{si + 1}&ensp;{s.heading}
            </h3>
            <table className="mp-dtable">
              <thead>
                <tr>
                  <th className="mp-dnum">№</th>
                  <th className="mp-dorg-h">
                    Хүсэлт
                    <br />
                    гаргагч
                  </th>
                  <th>Тайлбар</th>
                </tr>
              </thead>
              <tbody>
                {s.items.length === 0 ? (
                  <tr>
                    <td className="mp-dnum">1</td>
                    <td className="mp-dorg">{s.org}</td>
                    <td className="mp-dtext" />
                  </tr>
                ) : (
                  s.items.map((item, ii) => (
                    <tr key={ii}>
                      <td className="mp-dnum">{ii + 1}</td>
                      {ii === 0 && (
                        <td className="mp-dorg" rowSpan={s.items.length}>
                          {s.org}
                        </td>
                      )}
                      <td className="mp-dtext mp-pre">{item}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        ))}

        {/* Хуучин хурлууд (discussion бөглөөгүй) — AI шинжилгээний хэсгүүд хэвээр. */}
        {discussion.length === 0 &&
        data.analysis &&
        (data.analysis.summary || decisions.length || actions.length) ? (
          <div className="mp-body">
            {data.analysis.summary && (
              <section>
                <h3>Товч дүгнэлт</h3>
                <p className="mp-pre">{data.analysis.summary}</p>
              </section>
            )}
            {decisions.length > 0 && (
              <section>
                <h3>Гол шийдвэрүүд</h3>
                <ol>
                  {decisions.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ol>
              </section>
            )}
            {actions.length > 0 && (
              <section>
                <h3>Хийх ажлууд</h3>
                <table className="mp-actions">
                  <thead>
                    <tr>
                      <th>Ажил</th>
                      <th>Хариуцагч</th>
                      <th>Хугацаа</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actions.map((a, i) => (
                      <tr key={i}>
                        <td>{a.text}</td>
                        <td>{a.owner || ''}</td>
                        <td>{a.due || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        ) : null}

        {/* Хүний зассан эцсийн хурлын текст (0333) — протоколын бүтэцтэй
            хэсгүүдийн дараа, бүхэлдээ.  Транскрипт (түүхий) хэвлэгдэхгүй. */}
        {m.final_text?.trim() && (
          <section className="mp-body mp-final">
            <h3>Хурлын тэмдэглэл</h3>
            <p className="mp-pre">{m.final_text}</p>
          </section>
        )}

        {m.conclusion && (
          <section className="mp-body">
            <h3>Төгсгөл</h3>
            <p className="mp-pre">{m.conclusion}</p>
          </section>
        )}

        {nextMeeting && <p className="mp-next">{nextMeeting}</p>}

        {/* Гарын үсгийн блок — байгууллага тус бүр bold мөрөөр, гишүүн бүр
            албан тушаал · гарын үсэг · нэр гэсэн гурван баганаар (протоколын
            сүүлийн хуудасны загвар). */}
        {participants.length > 0 && (
          <div className="mp-signs">
            <table className="mp-signtable">
              <tbody>
                {participants.flatMap((g, gi) => [
                  g.org ? (
                    <tr key={`org-${gi}`}>
                      <td className="mp-signorg" colSpan={3}>
                        {g.org}
                      </td>
                    </tr>
                  ) : null,
                  ...g.members.map((mem, mi) => (
                    <tr key={`${gi}-${mi}`}>
                      <td className="mp-signpos">{mem.position || ''}</td>
                      <td className="mp-signline">
                        {mem.signature_url ? (
                          <HandSignature
                            className="mp-sigimg"
                            src={`${MEDIA_BASE_URL}${mem.signature_url}`}
                          />
                        ) : (
                          '………………………'
                        )}
                      </td>
                      <td className="mp-signname">{mem.name}</td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}

        {/* Хурлын огноо — дэлгэц дээр баримтын төгсгөлд нэг удаа, хэвлэхэд
            (position: fixed) хуудас бүрийн зүүн доод буланд давтагдана. */}
        {footDate && <div className="mp-footdate">{footDate}</div>}
      </div>
    </>
  );
}

const PRINT_CSS = `
  /* Arimo — Arial-тай хэмжээс тэнцүү, кирилл өргөтгөл (ү/ө) бүрэн фонт.
     Cloudflare Browser Rendering-ийн headless Chromium-д Arial байхгүй тул
     монгол үсэг glyph бүрээр fallback хийхээс сэргийлнэ. @import эхэндээ байх ёстой. */
  @import url('https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,700;1,400;1,700&display=swap');

  .meeting-print {
    max-width: 800px; margin: 0 auto; padding: 24px;
    color: #111; font-size: 13px; line-height: 1.5;
    font-family: 'Arimo', 'Arial', Helvetica, sans-serif;
  }

  /* --- Толгой: navy чип + компанийн bracket --- */
  .mp-titlebar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .mp-title {
    background: #0F243E; color: #fff; font-weight: 700; letter-spacing: 1px;
    padding: 8px 18px;
  }
  .mp-org { color: #0F243E; font-weight: 700; }

  .mp-projectline { margin: 0 0 10px; }
  .mp-pcount { font-weight: 600; margin-bottom: 4px; }
  .mp-final { break-inside: auto; }

  /* --- Мэдээллийн хүснэгт --- */
  .mp-info { width: 100%; border-collapse: collapse; }
  .mp-info th, .mp-info td { border: 1px solid #0F243E; padding: 7px 10px; vertical-align: top; text-align: left; }
  .mp-info th { width: 150px; background: #0F243E; color: #fff; font-weight: 600; }
  .mp-pre { white-space: pre-wrap; }
  .mp-pgroup { margin-bottom: 6px; }
  .mp-pgroup:last-child { margin-bottom: 0; }
  .mp-porg { font-weight: 600; }
  .mp-pgroup ul { margin: 2px 0 0; padding-left: 18px; }

  /* --- Хэлэлцсэн асуудал (1.N хүснэгтүүд) --- */
  .mp-section { margin-top: 16px; }
  .mp-section-heading {
    font-size: 13px; font-weight: 700; margin: 0 0 6px;
    break-after: avoid; page-break-after: avoid;
  }
  .mp-dtable { width: 100%; border-collapse: collapse; }
  .mp-dtable th, .mp-dtable td { border: 1px solid #0F243E; padding: 6px 8px; vertical-align: top; }
  .mp-dtable thead th { background: #0F243E; color: #fff; font-weight: 700; text-align: center; }
  .mp-dtable tr { break-inside: avoid; page-break-inside: avoid; }
  /* rowSpan-тай "Хүсэлт гаргагч" нүд хуудас дамжин хуваагдвал үргэлжлэлийн
     хуудсанд хоосон гарна — нэг хуудсанд багтах хүснэгтийг бүхэлд нь дараагийн
     хуудас руу шилжүүлнэ (бүтэн хуудаснаас уртыг Chromium яахав хуваана). */
  .mp-dtable tbody { break-inside: avoid; page-break-inside: avoid; }
  .mp-dnum { width: 28px; text-align: center; }
  .mp-dorg-h { width: 16%; }
  .mp-dorg { width: 16%; text-align: center; vertical-align: middle; }
  .mp-dtext { text-align: justify; }

  /* --- AI шинжилгээний fallback хэсгүүд --- */
  .mp-body { margin-top: 18px; }
  .mp-body section { margin-bottom: 14px; page-break-inside: avoid; }
  .mp-body h3 { font-size: 13px; font-weight: 700; color: #0F243E; border-bottom: 1px solid #0F243E; padding-bottom: 3px; margin: 0 0 6px; }
  .mp-body ol { margin: 0; padding-left: 20px; }
  .mp-body li { margin-bottom: 3px; }
  .mp-actions { width: 100%; border-collapse: collapse; }
  .mp-actions th, .mp-actions td { border: 1px solid #0F243E; padding: 6px 8px; text-align: left; vertical-align: top; }
  .mp-actions th { background: #0F243E; color: #fff; font-weight: 600; }

  /* --- Дараагийн уулзалт --- */
  .mp-next { font-style: italic; font-weight: 700; text-align: center; margin: 18px 0 6px; }

  /* --- Гарын үсгийн блок --- */
  .mp-signs { margin-top: 20px; page-break-inside: avoid; }
  .mp-signtable { width: 100%; border-collapse: collapse; }
  .mp-signtable td { padding: 6px 8px; vertical-align: bottom; }
  .mp-signorg { font-weight: 700; padding-top: 12px; }
  .mp-signpos { width: 55%; padding-left: 22px; position: relative; }
  .mp-signpos::before { content: '•'; position: absolute; left: 8px; }
  .mp-signline { width: 22%; text-align: center; color: #333; }
  .mp-signname { width: 23%; }
  .mp-sigimg { max-height: 18mm; max-width: 48mm; object-fit: contain; margin-bottom: -2px; mix-blend-mode: multiply; }

  /* --- Хурлын огноо (баримтын төгсгөлд) --- */
  .mp-footdate { margin-top: 24px; font-size: 12px; color: #111; }

  @media print {
    @page { margin: 14mm 12mm; }
    html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { background: #fff !important; color: #111 !important; }
    body, body * { visibility: visible !important; }
    .meeting-print, .meeting-print * { visibility: visible !important; }
    /* Headless PDF: хуудас бүрийн огноог puppeteer footerTemplate (margin
       band дотор, контенттой давхцахгүй) зурдаг тул in-flow огноог нууна.
       Гар window.print() үед marker байхгүй — баримтын төгсгөлд хэвээр гарна. */
    body[data-headless-print='true'] .mp-footdate { display: none; }
  }
`;
