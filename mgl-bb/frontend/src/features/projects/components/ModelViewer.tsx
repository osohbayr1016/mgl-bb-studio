import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw, Upload } from 'lucide-react';
import { apiFetch, uploadLargeFile } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { formatDate } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import type { ProjectModelRow } from '@/shared/types';
import ApsViewer from './ApsViewer';

/* =============================================================================
 * 3D model viewer (Autodesk Platform Services) with version history. Each `.rvt`
 * upload is a retained, dated version (project_models); a dropdown lets
 * staff/clients pick any past revision. APS translates the `.rvt` to SVF2 and
 * the APS Viewer (ApsViewer.tsx, CDN-loaded) renders it with its own toolbar,
 * model tree, properties, section and measure tools. This component owns the
 * surrounding chrome — version picker, upload, status, polling, reconvert —
 * and polls while any version is still translating. Lazy-loaded (own chunk).
 * Legacy `.ifc`/`.xkt` rows are filtered out (no longer rendered).
 * ========================================================================== */

interface ModelViewerProps {
  projectId: number;
  /** Staff may retry a failed version. Clients only ever view ready ones. */
  canReconvert?: boolean;
  /** Staff may upload/replace the `.rvt` model. */
  canUpload?: boolean;
}

export default function ModelViewer({
  projectId,
  canReconvert = false,
  canUpload = false,
}: ModelViewerProps) {
  const { t } = useLanguage();
  const [versions, setVersions] = useState<ProjectModelRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ models: ProjectModelRow[] }>(`/projects/${projectId}/models`);
      // Only APS (.rvt) versions are renderable; legacy .ifc/.xkt rows are hidden.
      const rvt = r.models.filter((m) => m.model_format === 'rvt');
      setVersions(rvt);
      setSelectedId((cur) => {
        if (cur != null && rvt.some((m) => m.id === cur)) return cur;
        return rvt.find((m) => m.conversion_status === 'done')?.id ?? rvt[0]?.id ?? null;
      });
    } catch {
      setVersions([]);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = versions?.find((v) => v.id === selectedId) ?? null;
  const anyConverting = (versions ?? []).some((v) => v.conversion_status === 'converting');

  // Poll the version list while any translation is in flight (the backend
  // refreshes APS status from the manifest on each of these requests).
  useEffect(() => {
    if (!anyConverting) return;
    const iv = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(iv);
  }, [anyConverting, load]);

  const handleUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.rvt')) {
      toast.error(t('modelViewer.onlyRvt'));
      return;
    }
    setUploading(true);
    setUploadPct(0);
    try {
      const url = await uploadLargeFile(file, {
        onProgress: (p) => setUploadPct(Math.round(p.pct)),
      });
      await apiFetch(`/aps/projects/${projectId}/model`, {
        method: 'PUT',
        data: { model_url: url, file_name: file.name, file_size: file.size },
      });
      toast.success(t('modelViewer.uploadStarted'));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modelViewer.failed'));
    } finally {
      setUploading(false);
      setUploadPct(null);
    }
  };

  const dot = (s: ProjectModelRow['conversion_status']) =>
    s === 'done' ? 'bg-success' : s === 'failed' ? 'bg-danger' : 'bg-warning';
  const versionLabel = (m: ProjectModelRow) =>
    `${formatDate(m.created_at)}${m.file_name ? ` · ${m.file_name}` : ''}`;

  const uploadControl = canUpload ? (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".rvt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleUpload(file);
          e.target.value = '';
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
        ) : (
          <Upload className="w-4 h-4 mr-1.5" />
        )}
        {uploading
          ? `${t('modelViewer.uploading')}${uploadPct != null ? ` ${uploadPct}%` : ''}`
          : versions && versions.length > 0
            ? t('modelViewer.replaceRvt')
            : t('modelViewer.uploadRvt')}
      </Button>
    </>
  ) : null;

  if (versions === null) {
    return (
      <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> {t('common.loading')}
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="space-y-3 p-2">
        {uploadControl}
        <p className="text-sm text-muted-foreground">{t('modelViewer.noModel')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={selectedId != null ? String(selectedId) : ''}
          onValueChange={(v) => setSelectedId(Number(v))}
        >
          <SelectTrigger className="h-8 w-[18rem]">
            <SelectValue placeholder={t('modelViewer.version')} />
          </SelectTrigger>
          <SelectContent>
            {versions.map((m) => (
              <SelectItem key={m.id} value={String(m.id)}>
                <span className="inline-flex items-center gap-2">
                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dot(m.conversion_status))} />
                  {versionLabel(m)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {uploadControl}

        {selected?.uploaded_by_name && (
          <span className="text-xs text-muted-foreground">· {selected.uploaded_by_name}</span>
        )}
        <span className="text-xs text-muted-foreground lg:hidden ml-auto">
          {t('modelViewer.desktopHint')}
        </span>
      </div>

      {selected?.conversion_status === 'converting' && (
        <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> {t('modelViewer.converting')}
        </div>
      )}

      {selected?.conversion_status === 'failed' && (
        <div className="p-6 space-y-3">
          <p className="text-sm text-danger">
            {t('modelViewer.failed')}
            {selected.conversion_error ? ` — ${selected.conversion_error}` : ''}
          </p>
          {canReconvert && (
            <Button
              size="sm"
              onClick={async () => {
                await apiFetch(`/aps/projects/${projectId}/reconvert?version=${selected.id}`, {
                  method: 'POST',
                });
                void load();
              }}
            >
              <RotateCcw className="w-4 h-4 mr-1.5" /> {t('modelViewer.reconvert')}
            </Button>
          )}
        </div>
      )}

      {selected?.conversion_status === 'done' &&
        (selected.aps_urn ? (
          <ApsViewer key={selected.aps_urn} urn={selected.aps_urn} projectId={projectId} />
        ) : (
          <p className="text-sm text-muted-foreground p-6">{t('modelViewer.legacyUnavailable')}</p>
        ))}
    </div>
  );
}
