import type { DocumentItem } from '@/shared/types';

/** Серверээс импортолсон нэг хавтас = нэг архив (backend migration 0249). */
export interface ArchiveRow {
  id: number;
  name: string;
  source_path: string | null;
  created_at: string;
  created_by_name: string;
  folder_count: number;
  file_count: number;
  total_size: number;
}

export interface DocFolder {
  id: number;
  archive_id: number;
  parent_id: number | null;
  name: string;
  code: string | null;
  is_system: number;
  sort_order: number;
  created_at: string;
  deleted_at: string | null;
}

export interface BrowseTrail {
  id: number;
  name: string;
}

export interface BrowseResponse {
  archive: { id: number; name: string; source_path: string | null };
  folder: { id: number; name: string; code: string | null; is_system: number } | null;
  folders: DocFolder[];
  files: DocumentItem[];
  trail: BrowseTrail[];
}

export interface TrashResponse {
  folders: DocFolder[];
  files: DocumentItem[];
}

export type ExplorerSelection =
  | { kind: 'folder'; id: number; name: string; isSystem: boolean }
  | { kind: 'file'; id: number; name: string }
  | null;

// ---------------------------------------------------------------------------
// Бүтэн хавтас импортлох
// ---------------------------------------------------------------------------

/** Чирсэн модноос уншсан нэг файл — `path` нь чирсэн хавтаснаас доош. */
export interface ScannedFile {
  /** Хавтасны харьцангуй зам, файлын нэргүй.  Үндэс дээр бол ''. */
  dir: string;
  name: string;
  file: File;
}

export interface ScannedTree {
  /** Чирсэн үндсэн хавтасны нэр — байхгүй бол ганц файл чирсэн гэсэн үг. */
  rootName: string | null;
  dirs: string[];
  files: ScannedFile[];
  /** Хориотой төрлийн улмаас хассан файлууд. */
  blocked: string[];
}

export interface ImportFileInput {
  folder_id: number | null;
  title: string;
  file_url: string;
  file_name: string;
  file_type?: string | null;
  file_size?: number | null;
  on_conflict?: 'replace' | 'skip';
}

export interface ImportResult {
  created: { title: string; document_id: number }[];
  replaced: { title: string; document_id: number }[];
  skipped: { title: string; reason: string }[];
}

/** Импортын явцын үзүүлэлт. */
export interface ImportProgress {
  phase: 'scanning' | 'folders' | 'checking' | 'uploading' | 'done';
  done: number;
  total: number;
  currentName: string;
  created: number;
  replaced: number;
  skipped: number;
  failed: { name: string; reason: string }[];
}
