import { useParams, useSearchParams } from 'react-router-dom';
import { ExplorerPane } from './ExplorerPane';
import { RecycleBinView } from './RecycleBinView';

/**
 * `/app/documents/:archiveId` — серверээс импортолсон нэг хавтасны хөтөч.
 *
 * 2026-09-03-аас өмнө энэ зам нь `:projectId` байсан.  «CR / RFI / Захидал»
 * таб нь ТӨСЛИЙН зүйл байсан тул энд байхаа больж, төслийн хуудсандаа үлдэв.
 */
export default function ArchiveExplorerPage() {
  const { archiveId: raw } = useParams();
  const [sp] = useSearchParams();
  const archiveId = Number(raw);
  if (!Number.isFinite(archiveId)) return null;

  if (sp.get('trash') === '1') return <RecycleBinView archiveId={archiveId} />;

  const folderRaw = sp.get('folder');
  const folderId = folderRaw ? Number(folderRaw) : null;
  return (
    <ExplorerPane
      archiveId={archiveId}
      folderId={folderId != null && Number.isFinite(folderId) ? folderId : null}
    />
  );
}
