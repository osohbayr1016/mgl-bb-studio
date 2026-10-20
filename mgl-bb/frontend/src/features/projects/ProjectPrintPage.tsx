import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '@/shared/api/client';
import { formatDisplayName } from '@/shared/lib/formatting';
import type {
  ProjectDetailResponse,
  ProjectWithProgress,
  ProjectStatus,
  ProjectTeamProgress,
  BlockProgress,
  User,
  ProjectClient,
  ProjectStatusReport,
  ProjectProgressNote,
  FundingMilestone,
} from '@/shared/types';
import { PROJECT_STATUS_HEX } from '@/shared/lib/status-colors';
import { bridgePrintToken } from '@/shared/lib/printAuth';

/* =============================================================
 * ProjectPrintPage
 * -------------------------------------------------------------
 * Plain-HTML print layout consumed by the backend's headless
 * Chromium (Cloudflare Browser Rendering) to produce the project
 * PDF. Auth is bridged via a short-lived `?t=<jwt>` query param
 * which we hand to apiFetch through localStorage.
 *
 * The component sets `document.body.dataset.printReady = 'true'`
 * when rendering is complete; the backend waits on that selector
 * before invoking `page.pdf()`, otherwise it would frequently
 * snapshot a blank shell.
 * ============================================================= */

const STATUS_LABEL_MN: Record<ProjectStatus, string> = {
  active: 'Идэвхтэй',
  completed: 'Дууссан',
  archived: 'Архивласан',
};

const ROLE_LABEL_MN: Record<string, string> = {
  admin: 'Админ',
  engineer: 'Инженер',
  architect: 'Архитектор',
  senior: 'Ахлах',
  client: 'Захиалагч',
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('mn-MN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('mn-MN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function pct(n: number | null | undefined): string {
  return `${Math.max(0, Math.min(100, Math.round(n ?? 0)))}%`;
}

interface PrintData {
  project: ProjectWithProgress;
  blocks: BlockProgress[];
  members: User[];
  clients: ProjectClient[];
  teamProgress: ProjectTeamProgress[];
  report: ProjectStatusReport | null;
  notes: ProjectProgressNote[];
}

// Bridge the print token synchronously, BEFORE React mounts, so the very first
// apiFetch already has the token (no first-render flash / 401).
bridgePrintToken();

export default function ProjectPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<PrintData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading');

  // Load every payload in parallel. Status-report and projects-list
  // calls are tolerated on failure — older projects may not have a
  // report row, and clients can't see the full /projects list.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const projectId = Number(id);
        const [detail, listOrNull, reportOrNull] = await Promise.all([
          apiFetch<ProjectDetailResponse>(`/projects/${id}`),
          apiFetch<{ projects: ProjectWithProgress[] }>(`/projects`).catch(() => null),
          apiFetch<{ report: ProjectStatusReport | null; notes: ProjectProgressNote[] }>(
            `/projects/${id}/status-report?category=mgl`,
          ).catch(() => null),
        ]);
        if (cancelled) return;

        const fromList = listOrNull?.projects.find((p) => p.id === projectId);
        setData({
          project: { ...detail.project, team_progress: fromList?.team_progress ?? [] },
          blocks: detail.blocks ?? [],
          members: detail.members ?? [],
          clients: detail.clients ?? [],
          teamProgress: fromList?.team_progress ?? [],
          report: reportOrNull?.report ?? null,
          notes: reportOrNull?.notes ?? [],
        });
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Төсөл ачаалж чадсангүй');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Flip to "ready" once data or error commits AND fonts have loaded.
  // The fonts wait is critical: Cloudflare's headless Chromium ships
  // with no Cyrillic glyphs by default, so without `document.fonts.ready`
  // the snapshot is taken before our @font-face Noto Sans has fetched
  // and Skia/PDF emits zero text drawing instructions (1 KB blank PDF).
  useEffect(() => {
    if (!data && !error) return;
    let cancelled = false;
    (async () => {
      try {
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setPhase('ready');
            document.body.dataset.printReady = 'true';
          });
        });
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [data, error]);

  // Hard safety: if everything stalled (network, auth, etc.) the
  // backend would otherwise time out at 30s and return a 500. After
  // 12s flip the flag anyway so puppeteer snapshots whatever we have.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (document.body.dataset.printReady !== 'true') {
        document.body.dataset.printReady = 'true';
      }
    }, 18000);
    return () => window.clearTimeout(t);
  }, []);

  // From here down: ALWAYS render visible text. Loading and error
  // states render placeholder text rather than `null`, so a snapshot
  // taken before data resolves is never a fully blank page.
  if (error) {
    return (
      <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>
        <h1>Тайлан үүсгэхэд алдаа гарлаа</h1>
        <p>{error}</p>
        <p style={{ color: '#94a3b8', fontSize: '10pt' }}>Project ID: {id}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ color: '#94a3b8', fontWeight: 400 }}>Төсөл #{id}</h1>
        <p style={{ color: '#94a3b8' }}>Тайлан бэлтгэж байна... ({phase})</p>
      </div>
    );
  }

  const { project, blocks, members, clients, teamProgress, report, notes } = data;
  const ts = new Date();
  const statusLabel = STATUS_LABEL_MN[project.status] ?? project.status;
  const statusColor = PROJECT_STATUS_HEX[project.status] ?? '#6b7280';
  const sortedTeams = [...teamProgress].sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
  const sortedBlocks = [...blocks].sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
  const fundingTotal = (report?.funding_milestones ?? []).reduce((s, m) => s + (m.percent ?? 0), 0);
  const fundingDone = (report?.funding_milestones ?? [])
    .filter((m) => m.done)
    .reduce((s, m) => s + (m.percent ?? 0), 0);

  return (
    <>
      <style>{`
        /* Cloudflare's headless Chromium has no Cyrillic fonts of its
           own, so we ship Noto Sans (Cyrillic + Latin) from Google
           Fonts. Without this, the PDF generator emits zero glyphs
           and you get a 1 KB blank page even though the DOM is full. */
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700&display=swap');
        @page { size: A4; margin: 14mm 12mm; }
        /* Defeat the global @media print rule in index.css that hides
           every element NOT inside ".print-area". This whole route IS
           the printable surface, so we force everything visible. */
        @media print {
          body, body * { visibility: visible !important; }
          .pp-root, .pp-root * { visibility: visible !important; }
        }
        html, body {
          margin: 0;
          padding: 0;
          background: #fff;
          color: #111827;
          font-family: 'Noto Sans', 'Segoe UI', system-ui, sans-serif;
          font-size: 10.5pt;
          line-height: 1.45;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .pp-root { padding: 0; }
        .pp-header {
          border-bottom: 1px solid #e5e7eb;
          padding-bottom: 12px;
          margin-bottom: 18px;
        }
        .pp-header-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }
        .pp-name { font-size: 20pt; font-weight: 700; color: #0f172a; margin: 0 0 4px; }
        .pp-generated { font-size: 9pt; color: #94a3b8; }
        .pp-badge {
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 9pt;
          font-weight: 700;
          color: #fff;
          white-space: nowrap;
        }
        .pp-meta {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px 16px;
          margin-top: 10px;
        }
        .pp-meta-item { font-size: 9pt; color: #475569; }
        .pp-meta-label { color: #94a3b8; }
        .pp-section { margin-bottom: 18px; page-break-inside: avoid; }
        .pp-section-title {
          font-size: 10pt;
          font-weight: 700;
          color: #1e293b;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          margin: 0 0 6px;
          padding-bottom: 4px;
          border-bottom: 0.5px solid #cbd5e1;
        }
        .pp-body { font-size: 10pt; color: #1f2937; white-space: pre-wrap; }
        .pp-empty { font-size: 9.5pt; color: #94a3b8; font-style: italic; }
        .pp-bar-row {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 16px;
          margin-bottom: 4px;
        }
        .pp-bar-label {
          width: 130px;
          flex-shrink: 0;
          font-size: 9pt;
          color: #1f2937;
          text-align: right;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pp-bar-track {
          flex: 1;
          height: 8px;
          background: #e5e7eb;
          border-radius: 2px;
          overflow: hidden;
        }
        .pp-bar-fill {
          height: 100%;
          background: #0ea5e9;
          border-radius: 2px;
        }
        .pp-bar-fill.done { background: #10b981; }
        .pp-bar-value {
          width: 38px;
          flex-shrink: 0;
          text-align: right;
          font-size: 9pt;
          color: #1f2937;
        }
        table.pp-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        .pp-table th, .pp-table td {
          font-size: 9pt;
          text-align: left;
          padding: 4px 6px;
          border-bottom: 0.5px solid #e5e7eb;
          color: #1f2937;
          vertical-align: top;
        }
        .pp-table thead th {
          background: #f8fafc;
          color: #0f172a;
          font-weight: 700;
          border-bottom: 0.5px solid #cbd5e1;
        }
        .pp-table td.num, .pp-table th.num { text-align: right; }
        .pp-table td.center, .pp-table th.center { text-align: center; }
        .pp-chip {
          display: inline-block;
          padding: 1px 6px;
          border-radius: 999px;
          font-size: 8.5pt;
          background: #f1f5f9;
          color: #334155;
          margin-right: 4px;
        }
        .pp-chip.done { background: #dcfce7; color: #166534; }
        .pp-chip.pending { background: #fef9c3; color: #854d0e; }
        .pp-grid-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px 16px;
        }
        .pp-note {
          border: 0.5px solid #e2e8f0;
          border-radius: 6px;
          padding: 8px 10px;
          margin-bottom: 8px;
          page-break-inside: avoid;
        }
        .pp-note-meta {
          font-size: 8.5pt;
          color: #94a3b8;
          margin-bottom: 4px;
        }
        .pp-note-title {
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 4px;
          font-size: 10pt;
        }
        .pp-note-body {
          font-size: 9.5pt;
          color: #1f2937;
          white-space: pre-wrap;
        }
      `}</style>

      <div className="pp-root">
        {/* ─────────── Header ─────────── */}
        <header className="pp-header">
          <div className="pp-header-row">
            <div style={{ flexGrow: 1 }}>
              <h1 className="pp-name">{project.name}</h1>
              <div className="pp-generated">Үүсгэсэн: {formatDateTime(ts)}</div>
            </div>
            <span className="pp-badge" style={{ backgroundColor: statusColor }}>
              {statusLabel}
            </span>
          </div>

          <div className="pp-meta">
            <span className="pp-meta-item">
              <span className="pp-meta-label">Байршил: </span>
              {project.location ?? '—'}
            </span>
            <span className="pp-meta-item">
              <span className="pp-meta-label">Эхэлсэн: </span>
              {formatDate(project.start_date)}
            </span>
            <span className="pp-meta-item">
              <span className="pp-meta-label">Дуусах: </span>
              {formatDate(project.finish_date)}
            </span>
            <span className="pp-meta-item">
              <span className="pp-meta-label">Нийт явц: </span>
              <strong>{pct(project.progress)}</strong>
            </span>
            <span className="pp-meta-item">
              <span className="pp-meta-label">Төвөгшлийн жин: </span>
              {project.complexity_pct != null ? `${project.complexity_pct}%` : '—'}
            </span>
            <span className="pp-meta-item">
              <span className="pp-meta-label">Гишүүд: </span>
              {project.member_count ?? members.length}
            </span>
            {report?.contract_start && (
              <span className="pp-meta-item">
                <span className="pp-meta-label">Гэрээ эхэлсэн: </span>
                {formatDate(report.contract_start)}
              </span>
            )}
            {report?.contract_end && (
              <span className="pp-meta-item">
                <span className="pp-meta-label">Гэрээ дуусах: </span>
                {formatDate(report.contract_end)}
              </span>
            )}
          </div>
        </header>

        {/* ─────────── Project description ─────────── */}
        <section className="pp-section">
          <h2 className="pp-section-title">Төслийн тайлбар</h2>
          {project.description && project.description.trim().length > 0 ? (
            <div className="pp-body">{project.description}</div>
          ) : (
            <div className="pp-empty">Тайлбар оруулаагүй байна.</div>
          )}
        </section>

        {/* ─────────── Clients ─────────── */}
        {clients.length > 0 && (
          <section className="pp-section">
            <h2 className="pp-section-title">Захиалагч / Эзэмшигч</h2>
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Нэр</th>
                  <th>Төрөл</th>
                  <th className="num">Эзлэх хувь</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.type === 'company' ? 'Компани' : 'Хувь хүн'}</td>
                    <td className="num">{Math.round(c.share_percent ?? 0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ─────────── Team progress ─────────── */}
        {sortedTeams.length > 0 && (
          <section className="pp-section">
            <h2 className="pp-section-title">Багуудын явц</h2>
            {sortedTeams.map((t) => {
              const p = Math.max(0, Math.min(100, Math.round(t.progress ?? 0)));
              const label = t.team_code ?? t.team_name_mn ?? `#${t.team_id}`;
              return (
                <div key={t.team_id} className="pp-bar-row">
                  <div className="pp-bar-label" title={label}>
                    {label}
                  </div>
                  <div className="pp-bar-track">
                    <div className="pp-bar-fill" style={{ width: `${p}%` }} />
                  </div>
                  <div className="pp-bar-value">{p}%</div>
                </div>
              );
            })}
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Баг</th>
                  <th className="num">Даалгавар</th>
                  <th className="num">Явц</th>
                </tr>
              </thead>
              <tbody>
                {sortedTeams.map((t) => (
                  <tr key={`r-${t.team_id}`}>
                    <td>{t.team_name_mn ?? t.team_code ?? `#${t.team_id}`}</td>
                    <td className="num">{t.task_count ?? 0}</td>
                    <td className="num">{pct(t.progress)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ─────────── Block-level structure progress ─────────── */}
        {sortedBlocks.length > 0 && (
          <section className="pp-section">
            <h2 className="pp-section-title">Бүтцийн явц (Блокоор)</h2>
            {sortedBlocks.map((b) => {
              const p = Math.max(0, Math.min(100, Math.round(b.progress ?? 0)));
              return (
                <div key={b.id} className="pp-bar-row">
                  <div className="pp-bar-label" title={b.name}>
                    {b.name}
                  </div>
                  <div className="pp-bar-track">
                    <div className="pp-bar-fill" style={{ width: `${p}%` }} />
                  </div>
                  <div className="pp-bar-value">{p}%</div>
                </div>
              );
            })}
          </section>
        )}

        {/* ─────────── Funding milestones ─────────── */}
        {report && report.funding_milestones && report.funding_milestones.length > 0 && (
          <section className="pp-section">
            <h2 className="pp-section-title">
              Санхүүжилт{' '}
              <span style={{ fontWeight: 400, color: '#64748b' }}>
                — {Math.round(fundingDone)}% / {Math.round(fundingTotal)}% хийгдсэн
              </span>
            </h2>
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Нөхцөл</th>
                  <th className="num">Хувь</th>
                  <th className="center">Төлөв</th>
                  <th>Огноо</th>
                </tr>
              </thead>
              <tbody>
                {report.funding_milestones.map((m: FundingMilestone, i: number) => (
                  <tr key={i}>
                    <td>{m.label}</td>
                    <td className="num">{m.percent != null ? `${Math.round(m.percent)}%` : '—'}</td>
                    <td className="center">
                      <span className={`pp-chip ${m.done ? 'done' : 'pending'}`}>
                        {m.done ? 'Хийгдсэн' : 'Хүлээгдэж байна'}
                      </span>
                    </td>
                    <td>{m.received_at ? formatDate(m.received_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ─────────── External agencies ─────────── */}
        {report &&
          (report.nema_note ||
            report.health_note ||
            report.bdc_experts_note ||
            report.bdc_review_note) && (
            <section className="pp-section">
              <h2 className="pp-section-title">Гадны байгууллагууд</h2>
              <div className="pp-grid-2">
                {[
                  { label: 'НЭМ', note: report.nema_note, done: report.nema_done },
                  { label: 'Эрүүл мэнд', note: report.health_note, done: report.health_done },
                  {
                    label: 'БДС шинжээч',
                    note: report.bdc_experts_note,
                    done: report.bdc_experts_done,
                  },
                  {
                    label: 'БДС хяналт',
                    note: report.bdc_review_note,
                    done: report.bdc_review_done,
                  },
                ]
                  .filter((a) => a.note)
                  .map((a) => (
                    <div key={a.label}>
                      <div style={{ fontSize: '9.5pt', fontWeight: 700, marginBottom: 2 }}>
                        {a.label}{' '}
                        <span className={`pp-chip ${a.done ? 'done' : 'pending'}`}>
                          {a.done ? 'Хийгдсэн' : 'Хүлээгдэж байна'}
                        </span>
                      </div>
                      <div className="pp-body" style={{ fontSize: '9.5pt' }}>
                        {a.note}
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          )}

        {/* ─────────── Members ─────────── */}
        {members.length > 0 && (
          <section className="pp-section">
            <h2 className="pp-section-title">Гишүүд ({members.length})</h2>
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Нэр</th>
                  <th>Үүрэг</th>
                  <th>Баг</th>
                </tr>
              </thead>
              <tbody>
                {members.map((u) => (
                  <tr key={u.id}>
                    <td>{formatDisplayName(u.full_name)}</td>
                    <td>{ROLE_LABEL_MN[u.role] ?? u.role}</td>
                    <td>
                      {(u as User & { team_code?: string; team_name_mn?: string }).team_name_mn ??
                        (u as User & { team_code?: string; team_name_mn?: string }).team_code ??
                        '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ─────────── Recent progress notes ─────────── */}
        {notes.length > 0 && (
          <section className="pp-section">
            <h2 className="pp-section-title">Явцын мэдээ ({notes.length})</h2>
            {notes.slice(0, 10).map((n) => (
              <div key={n.id} className="pp-note">
                <div className="pp-note-meta">
                  {formatDate(n.created_at)}
                  {n.author_name ? ` · ${n.author_name}` : ''}
                </div>
                {n.title && <h3 className="pp-note-title">{n.title}</h3>}
                {n.body && <div className="pp-note-body">{n.body}</div>}
              </div>
            ))}
            {notes.length > 10 && (
              <div className="pp-empty">...болон бусад {notes.length - 10} бичлэг</div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
