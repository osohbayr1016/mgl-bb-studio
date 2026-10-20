import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitPullRequest,
  Loader2,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch } from '@/shared/api/client';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { HudPanel } from './HudPanel';

/**
 * GitHub-д суурилсан засварлагч (`routes/devWorkbench.ts`): safe branch → файл
 * засах → тогтмол CI → draft PR.  Хуучин хуудасны логик ӨӨРЧЛӨЛТГҮЙ шилжсэн.
 */

type Status = {
  enabled: boolean;
  configured: boolean;
  repository: string;
  base_branch: string;
  workflow: string;
};

type FilePayload = {
  path: string;
  name: string;
  sha: string;
  size: number;
  ref: string;
  content: string;
  html_url: string | null;
  protected: boolean;
};

type TestRun = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  created_at: string;
};

export interface OpenRequest {
  path: string;
  nonce: number;
}

const enc = encodeURIComponent;

export function CodeWorkbench({ openRequest, contextLabel }: { openRequest: OpenRequest | null; contextLabel: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [branch, setBranch] = useState('');
  const [filePath, setFilePath] = useState('backend/src/index.ts');
  const [file, setFile] = useState<FilePayload | null>(null);
  const [content, setContent] = useState('');
  const [suite, setSuite] = useState<'frontend' | 'backend' | 'ai' | 'all'>('all');
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const call = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(key);
    setNotice('');
    try {
      return await fn();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Алдаа гарлаа');
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    const out = await call('status', () => apiFetch<Status>('/mgl-ai/workbench/status'));
    if (out) setStatus(out);
  }, [call]);

  const openFile = useCallback(
    async (path: string, ref?: string) => {
      setFilePath(path);
      const target = ref ?? (branch || status?.base_branch || 'main');
      const out = await call('file', () =>
        apiFetch<FilePayload>(`/mgl-ai/workbench/file?path=${enc(path)}&ref=${enc(target)}`),
      );
      if (out) {
        setFile(out);
        setContent(out.content);
      }
    },
    [branch, status?.base_branch, call],
  );

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (openRequest) void openFile(openRequest.path);
    // Зөвхөн шинэ хүсэлт (nonce) дээр — openFile-ийн өөрчлөлт дээр биш.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.nonce]);

  async function startSession() {
    const out = await call('session', () =>
      apiFetch<{ branch: string }>('/mgl-ai/workbench/session', { method: 'POST', data: { title: contextLabel } }),
    );
    if (out) {
      setBranch(out.branch);
      setNotice(`Branch үүслээ: ${out.branch}`);
      if (file) await openFile(file.path, out.branch);
    }
  }

  async function saveFile() {
    if (!branch || !file) return;
    const out = await call('save', () =>
      apiFetch<{ sha: string | null; commit_sha: string | null }>('/mgl-ai/workbench/file', {
        method: 'PUT',
        data: { branch, path: file.path, content, sha: file.sha, message: `workbench: update ${file.path}` },
      }),
    );
    if (out) {
      setFile({ ...file, sha: out.sha ?? file.sha, content });
      setNotice(`Хадгаллаа: ${out.commit_sha?.slice(0, 8) ?? 'commit'}`);
    }
  }

  async function runTests() {
    if (!branch) return;
    const out = await call('tests', () =>
      apiFetch<{ ok: boolean }>('/mgl-ai/workbench/tests', { method: 'POST', data: { branch, suite } }),
    );
    if (out) setNotice(`${suite} validation эхэллээ. 5–10 секундийн дараа «Runs» дарна уу.`);
  }

  async function refreshRuns() {
    if (!branch) return;
    const out = await call('runs', () => apiFetch<{ runs: TestRun[] }>(`/mgl-ai/workbench/runs?branch=${enc(branch)}`));
    if (out) setRuns(out.runs);
  }

  async function createPr() {
    if (!branch) return;
    const out = await call('pr', () =>
      apiFetch<{ url: string; number: number }>('/mgl-ai/workbench/pr', {
        method: 'POST',
        data: {
          branch,
          title: `Workbench: ${contextLabel}`,
          body: `System Workbench-оос үүсгэсэн draft PR.\n\nContext: **${contextLabel}**\n\nValidation run-уудаа merge-ээс өмнө шалгана.`,
        },
      }),
    );
    if (out) {
      setNotice(`Draft PR #${out.number} үүслээ.`);
      window.open(out.url, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 overflow-y-auto xl:grid-cols-[minmax(0,1fr)_340px] xl:overflow-hidden">
      <HudPanel title="Source" className="flex min-h-[520px] flex-col xl:min-h-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-cyan-400/10 p-3">
          <FileCode2 className="size-4 text-cyan-400" />
          <Input
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            className="min-w-[220px] flex-1 border-cyan-400/15 bg-black/40 font-mono text-xs text-slate-200"
          />
          <Button variant="outline" size="sm" onClick={() => void openFile(filePath)} disabled={busy === 'file'}>
            {busy === 'file' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Open
          </Button>
          <Button
            size="sm"
            onClick={saveFile}
            disabled={!branch || !file || file.protected || busy === 'save' || content === file?.content}
          >
            {busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Commit
          </Button>
          {file?.html_url && (
            <Button variant="ghost" size="sm" onClick={() => window.open(file.html_url!, '_blank', 'noopener,noreferrer')}>
              <ExternalLink className="size-4" />
            </Button>
          )}
        </div>
        {notice && <div className="border-b border-cyan-400/10 bg-cyan-400/5 px-3 py-2 text-xs text-cyan-100">{notice}</div>}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="min-h-[360px] flex-1 resize-none bg-[#03060b] p-4 font-mono text-[12px] leading-5 text-slate-200 outline-none"
          placeholder={status?.configured ? 'Файл нээгээд safe branch дээр засварлана.' : 'GitHub integration тохируулаагүй — зөвхөн уншина.'}
        />
        <div className="flex items-center justify-between border-t border-cyan-400/10 px-3 py-2 font-mono text-[10px] text-slate-500">
          <span>{file ? `${file.path} · ${file.size.toLocaleString()} B · ${file.ref}` : 'no file loaded'}</span>
          <span>{file?.protected ? 'protected · read-only' : branch ? 'writes → safe branch' : 'read-only until branch'}</span>
        </div>
      </HudPanel>

      <div className="flex min-h-0 flex-col gap-3">
        <HudPanel title="GitHub" className="p-3 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-slate-400">{status?.repository ?? '—'}</span>
            {status?.configured ? (
              <span className="text-emerald-300">ready</span>
            ) : (
              <span className="text-amber-300">not configured</span>
            )}
          </div>
          <div className="truncate font-mono text-[11px] text-cyan-200/80">{branch || status?.base_branch || 'main'}</div>
          {status && !status.configured && (
            <div className="mt-2 flex gap-2 rounded bg-amber-400/5 p-2 text-[11px] text-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              DEV_WORKBENCH_ENABLED=1 ба GITHUB_WORKBENCH_TOKEN шаардлагатай.
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={loadStatus} disabled={busy === 'status'}>
              {busy === 'status' ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Status
            </Button>
            <Button size="sm" onClick={startSession} disabled={!status?.configured || busy === 'session'}>
              {busy === 'session' ? <Loader2 className="size-4 animate-spin" /> : <GitBranch className="size-4" />} Branch
            </Button>
          </div>
        </HudPanel>

        <HudPanel title="Validation" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          <p className="text-[11px] leading-4 text-slate-400">Тогтмол GitHub Actions workflow — deploy secret ашиглахгүй.</p>
          <select
            value={suite}
            onChange={(e) => setSuite(e.target.value as typeof suite)}
            className="h-9 rounded-md border border-cyan-400/15 bg-black/40 px-2 text-xs text-slate-200"
          >
            <option value="all">All: frontend + backend + AI</option>
            <option value="frontend">Frontend verify</option>
            <option value="backend">Backend verify</option>
            <option value="ai">MGL AI checks</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" onClick={runTests} disabled={!branch || busy === 'tests'}>
              {busy === 'tests' ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run
            </Button>
            <Button variant="outline" size="sm" onClick={refreshRuns} disabled={!branch || busy === 'runs'}>
              {busy === 'runs' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Runs
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto">
            {runs.map((run) => (
              <button
                key={run.id}
                onClick={() => window.open(run.url, '_blank', 'noopener,noreferrer')}
                className="w-full rounded border border-cyan-400/10 p-2 text-left hover:bg-cyan-400/5"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">{run.name}</span>
                  <span
                    className={
                      run.conclusion === 'success' ? 'text-emerald-300' : run.conclusion ? 'text-rose-300' : 'text-amber-300'
                    }
                  >
                    {run.conclusion ?? run.status}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-slate-500">{new Date(run.created_at).toLocaleString()}</div>
              </button>
            ))}
            {!runs.length && (
              <div className="rounded border border-dashed border-cyan-400/10 p-4 text-center text-xs text-slate-500">
                No validation runs.
              </div>
            )}
          </div>
          <Button variant="outline" onClick={createPr} disabled={!branch || busy === 'pr'}>
            {busy === 'pr' ? <Loader2 className="size-4 animate-spin" /> : <GitPullRequest className="size-4" />} Draft PR
          </Button>
        </HudPanel>
      </div>
    </div>
  );
}
