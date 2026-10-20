import { isAllowedDocFile } from './fileTypes';
import type { ScannedFile, ScannedTree } from './types';

/**
 * Чирсэн зүйлээс БҮТЭН хавтасны модыг унших.
 *
 * `DataTransferItem.webkitGetAsEntry()` нь хөтөч дээр хавтасны мод уншиж
 * чадах ЦОРЫН ГАНЦ зам (Chrome/Edge/Firefox/Safari бүгд дэмждэг).  Windows
 * Explorer-оос, сүлжээний дискнээс чирсэн ч ялгаагүй — үйлдлийн систем нь
 * хөтөчид ижил интерфэйсээр өгдөг.
 *
 * ⚠️ Ctrl+V-ээр хавтас оруулах нь БОЛОМЖГҮЙ: clipboard дээр зөвхөн файлын
 * блоб байдаг, хавтас гэсэн ойлголт байхгүй.  Тиймээс хавтсыг зөвхөн чирж
 * эсвэл «Хавтас сонгох» товчоор (`webkitdirectory`) оруулна.
 *
 * ⚠️ `dataTransfer.items`-ыг эвент дуусахаас ӨМНӨ синхроноор уншина —
 * дараа нь хоосорно.  Тиймээс `webkitGetAsEntry()`-г эхлээд бүгдийг нь
 * дуудаж аваад, дараа нь асинхроноор гүйнэ.
 */

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file(onOk: (f: File) => void, onErr: (e: unknown) => void): void;
  createReader(): FsReader;
}

interface FsReader {
  readEntries(onOk: (entries: FsEntry[]) => void, onErr: (e: unknown) => void): void;
}

/** Нэг импортод унших дээд хязгаар — хөтөч санах ойгүй болохоос сэргийлнэ. */
export const MAX_IMPORT_FILES = 3000;
const MAX_DEPTH = 24;

function readEntry(entry: FsEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(
      (f) => resolve(f),
      () => resolve(null),
    );
  });
}

/** `readEntries` нэг дуудлагад дээд тал нь 100 мөр буцаадаг — хоосон болтол нь. */
function readAll(reader: FsReader): Promise<FsEntry[]> {
  return new Promise((resolve) => {
    const out: FsEntry[] = [];
    const step = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(out);
            return;
          }
          out.push(...batch);
          step();
        },
        () => resolve(out),
      );
    };
    step();
  });
}

function joinDir(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

async function walk(
  entry: FsEntry,
  dir: string,
  depth: number,
  acc: { dirs: Set<string>; files: ScannedFile[]; blocked: string[] },
): Promise<void> {
  if (acc.files.length >= MAX_IMPORT_FILES || depth > MAX_DEPTH) return;
  if (entry.isFile) {
    if (!isAllowedDocFile(entry.name)) {
      acc.blocked.push(entry.name);
      return;
    }
    const file = await readEntry(entry);
    // Хоосон хавтас нь `file()`-д алдаа өгдөг — чимээгүй алгасана.
    if (file) acc.files.push({ dir, name: entry.name, file });
    return;
  }
  if (!entry.isDirectory) return;
  const here = joinDir(dir, entry.name);
  acc.dirs.add(here);
  const children = await readAll(entry.createReader());
  for (const child of children) {
    await walk(child, here, depth + 1, acc);
  }
}

/** Чирсэн (drop) зүйлээс мод унших. */
export async function scanDataTransfer(dt: DataTransfer): Promise<ScannedTree> {
  // Синхрон хэсэг — эвент дуусахаас өмнө бүх entry-г гартаа авна.
  const entries: FsEntry[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    // lib.dom-ийн `FileSystemEntry` нь `file()`/`createReader()`-г зарладаггүй
    // (тэдгээр нь File/Directory дэд төрөл дээр байдаг) — өөрсдийн бүтцээр авна.
    const entry = item.webkitGetAsEntry?.() as FsEntry | null;
    if (entry) entries.push(entry);
  }

  // webkitGetAsEntry байхгүй хөтөч — файлаар нь буцаана (бүтэц алдагдана).
  if (entries.length === 0) return fromFileList(dt.files);

  const acc = { dirs: new Set<string>(), files: [] as ScannedFile[], blocked: [] as string[] };
  const roots: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) roots.push(entry.name);
    await walk(entry, '', 0, acc);
  }
  return {
    rootName: roots.length === 1 ? (roots[0] ?? null) : null,
    dirs: [...acc.dirs].sort((a, b) => a.split('/').length - b.split('/').length),
    files: acc.files,
    blocked: acc.blocked,
  };
}

/**
 * `<input webkitdirectory>`-ээс мод унших.  Тэнд File бүр
 * `webkitRelativePath = 'root/sub/file.pdf'`-тэй ирдэг.
 */
export function fromFileList(list: FileList | null): ScannedTree {
  const dirs = new Set<string>();
  const files: ScannedFile[] = [];
  const blocked: string[] = [];
  const roots = new Set<string>();
  for (const file of Array.from(list ?? [])) {
    if (files.length >= MAX_IMPORT_FILES) break;
    if (!isAllowedDocFile(file.name)) {
      blocked.push(file.name);
      continue;
    }
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
    const segments = rel ? rel.split('/').slice(0, -1) : [];
    if (segments.length > 0 && segments[0]) roots.add(segments[0]);
    let walked = '';
    for (const segment of segments.slice(0, MAX_DEPTH)) {
      walked = joinDir(walked, segment);
      dirs.add(walked);
    }
    files.push({ dir: segments.join('/'), name: file.name, file });
  }
  return {
    rootName: roots.size === 1 ? ([...roots][0] ?? null) : null,
    dirs: [...dirs].sort((a, b) => a.split('/').length - b.split('/').length),
    files,
    blocked,
  };
}

/**
 * Чирсэн ҮНДСЭН хавтсыг модноос хасна.
 *
 * Шинэ архив үүсгэхэд архив нь ӨӨРӨӨ тэр хавтас болдог
 * (`DocumentsPage`: `createArchiveApi(tree.rootName)`).  Модыг хасалгүй
 * оруулбал архив дотроо яг ижил нэртэй хавтсыг дахин үүсгэж, бүтэц харагдах
 * хүртэл хоёр удаа дарах болно.
 *
 * ⚠️ Байгаа архив/хавтас РУУ оруулах үед (`ExplorerPane`) энийг ХЭРЭГЛЭХГҮЙ —
 * тэнд чирсэн хавтас нь Windows-ын адил дэд хавтас болж орох ёстой.
 */
export function stripRoot(tree: ScannedTree): ScannedTree {
  const root = tree.rootName;
  if (!root) return tree;
  const prefix = `${root}/`;
  const cut = (dir: string): string =>
    dir === root ? '' : dir.startsWith(prefix) ? dir.slice(prefix.length) : dir;
  return {
    ...tree,
    dirs: tree.dirs.map(cut).filter(Boolean),
    files: tree.files.map((f) => ({ ...f, dir: cut(f.dir) })),
  };
}

/** Модонд ямар нэг хавтас байгаа эсэх — «ганц файл чирсэн» тохиолдлыг ялгана. */
export function hasFolders(tree: ScannedTree): boolean {
  return tree.dirs.length > 0;
}

export function totalBytes(tree: ScannedTree): number {
  return tree.files.reduce((sum, f) => sum + f.file.size, 0);
}
