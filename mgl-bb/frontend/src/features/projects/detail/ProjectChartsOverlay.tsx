/** Full-viewport overlay reusing the Графикууд dashboard layout.
 *  lightweight-charts loads lazily only here, on enlarge. Close via the
 *  dashboard's top-right button or Esc (wired by the page).
 *  Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 *  into per-component modules — no behavioural change. */
import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';

const ProjectChartsTab = lazy(() => import('@/features/projects/components/ProjectChartsTab'));

export function ProjectChartsOverlay({
  projectId,
  onClose,
}: {
  projectId: number;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] overflow-auto bg-background p-4">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <ProjectChartsTab projectId={projectId} embeddedFullscreen onExitFullscreen={onClose} />
      </Suspense>
    </div>
  );
}

export default ProjectChartsOverlay;
