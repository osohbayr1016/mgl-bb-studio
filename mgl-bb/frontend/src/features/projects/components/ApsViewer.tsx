import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/shared/i18n';
import { useApsViewerScript } from '../lib/useApsViewerScript';
import { makeApsTokenGetter } from '../lib/apsToken';

/* APS Viewer render surface for a single, translated `.rvt` version (by URN).
 * The surrounding chrome (version dropdown, status, upload, reconvert) lives in
 * ModelViewer.tsx; this component only owns the APS viewer lifecycle. The viewer
 * ships its own toolbar, model tree, properties, section and measure tools, so
 * there's no bespoke UI to rebuild. */

interface ApsViewerProps {
  urn: string;
  projectId: number;
}

// Initialize the global Viewing runtime once (idempotent across instances /
// StrictMode). The access-token getter is app-wide, so binding it to the first
// project is fine — project_id only drives the backend's client member-gate.
let initPromise: Promise<void> | null = null;
function ensureApsInitialized(projectId: number): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = new Promise<void>((resolve) => {
    Autodesk.Viewing.Initializer(
      {
        env: 'AutodeskProduction',
        api: 'streamingV2',
        getAccessToken: makeApsTokenGetter(projectId),
      },
      () => resolve(),
    );
  });
  return initPromise;
}

export default function ApsViewer({ urn, projectId }: ApsViewerProps) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { ready, error } = useApsViewerScript();
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadMsg, setLoadMsg] = useState('');

  useEffect(() => {
    if (!ready || !urn || !containerRef.current) return;
    let viewer: Autodesk.Viewing.GuiViewer3D | null = null;
    let cancelled = false;

    void ensureApsInitialized(projectId).then(() => {
      if (cancelled || !containerRef.current) return;
      viewer = new Autodesk.Viewing.GuiViewer3D(containerRef.current);
      viewer.start();
      viewer.setTheme('dark-theme');
      Autodesk.Viewing.Document.load(
        `urn:${urn}`,
        (doc) => {
          if (cancelled || !viewer) return;
          void viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry());
        },
        (_code, message) => {
          if (cancelled) return;
          setLoadFailed(true);
          setLoadMsg(message || '');
        },
      );
    });

    return () => {
      cancelled = true;
      if (viewer) {
        viewer.finish();
        viewer = null;
      }
    };
  }, [ready, urn, projectId]);

  return (
    <div className="relative w-full">
      <div
        ref={containerRef}
        className="relative w-full h-[70vh] rounded-lg border border-border overflow-hidden bg-[#0e1726]"
      />
      {(error || loadFailed) && (
        <div className="absolute inset-x-0 top-0 m-2 rounded-md border border-border bg-card/95 p-3 text-sm text-danger">
          {error ? t('modelViewer.viewerScriptBlocked') : loadMsg || t('modelViewer.loadFailed')}
        </div>
      )}
    </div>
  );
}
