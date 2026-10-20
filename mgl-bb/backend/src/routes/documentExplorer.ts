import type { DocumentsApp } from './documentBrowseRoutes';
import { mountDocumentBrowse } from './documentBrowseRoutes';
import { mountDocumentArchives } from './documentArchiveRoutes';
import { mountDocumentFolders } from './documentFolderRoutes';
import { mountDocumentImport } from './documentImportRoutes';
import { mountDocumentMutations } from './documentMutationRoutes';

/** /archives* /browse /trash /folders* /bulk /conflicts — `/:id`-ээс ӨМНӨ. */
export function mountDocumentExplorer(app: DocumentsApp) {
  mountDocumentArchives(app);
  mountDocumentBrowse(app);
  mountDocumentFolders(app);
  mountDocumentImport(app);
  mountDocumentMutations(app);
}
