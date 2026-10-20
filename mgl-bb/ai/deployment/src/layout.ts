/**
 * MGL AI · АЖИЛТНЫ PC ДЭЭРХ СУУЛГАЦЫН БАЙРЛАЛ (Session B §7, §13).
 *
 *   %LOCALAPPDATA%\MglAi\
 *   ├── app/            runtime-ийн код (bootstrap.ps1-ийн `AppDir`) — ХЭВЭЭР
 *   ├── bin/            llama.cpp — ХЭВЭЭР
 *   ├── node/           зөөврийн Node — ХЭВЭЭР
 *   ├── models/         GGUF-ууд + adapters/ + state.json — ХЭВЭЭР (modelManager)
 *   ├── knowledge/      knowledge.sqlite (ХУУЧИН, шууд) + versions/<v>/ (ШИНЭ)
 *   ├── registry/       normRegistry-ийн хувилбарын тэмдэг
 *   ├── logs/           бүтэцтэй, эргэлттэй лог
 *   ├── cache/
 *   ├── state/          installed.json, health.json — ЭНЭ МОДУЛИЙН бүртгэл
 *   ├── updates/
 *   │   ├── staging/    татагдсан, шалгагдаагүй файл
 *   │   └── manifests/  сүүлд авсан манифестууд
 *   └── diagnostics/    экспортолсон багц
 *
 * ⚠️ ОДОО АЖИЛЛАЖ БАЙГАА ФАЙЛЫГ НҮҮЛГЭХГҮЙ.  `models/<uid>.gguf`,
 *    `state.json`, `credential.json`, `secret.txt`, `knowledge/knowledge.sqlite`
 *    — `ai/runtime/src/config.ts` эдгээрийг ЯГ энэ замаар уншдаг ба тэр файл
 *    Session A-ийн `/norm`-той хамт амьдардаг.  Шинэ бүтэц нь ХАЖУУД нь
 *    нэмэгдэнэ: хувилбартай хавтас + `current.json` заагч.  Хуучин шууд
 *    зам нь «заагч байхгүй үеийн» fallback болж үлдэнэ (`resolveCurrent`).
 *
 * ⚠️ ХУВИЛБАРТАЙ ХАВТАС + ЗААГЧ — ФАЙЛ ДЭЭР ДАРЖ БИЧИХГҮЙ (§13).
 *    `knowledge/versions/2026.09.11.3/knowledge.sqlite` бэлэн болмогц
 *    `knowledge/current.json`-ыг НЭГ rename-ээр сольно.  Тасарсан шинэчлэлт
 *    хэзээ ч хагас файл үлдээхгүй; буцаалт = заагчийг өмнөх рүү.
 */
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

import type { ComponentId } from './manifest.ts';

export interface InstallLayout {
  root: string;
  app: string;
  bin: string;
  node: string;
  models: string;
  knowledge: string;
  registry: string;
  logs: string;
  cache: string;
  state: string;
  staging: string;
  manifests: string;
  diagnostics: string;
  /** state/installed.json */
  installedFile: string;
  /** state/health.json — сүүлийн health тайлан. */
  healthFile: string;
  /** state/install-id.json — суулгацын таних тэмдэг. */
  installIdFile: string;
  /** state/telemetry.json — түвшин (OFF/MINIMAL/QUALITY/DEBUG). */
  telemetryFile: string;
  /** state/supervisor.lock — давхар процессын хамгаалалт. */
  supervisorLock: string;
}

function defaultRoot(): string {
  if (platform() === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'MglAi');
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'MglAi');
}

/** ⚠️ `MGLAI_DATA_DIR` нь runtime-ийн config.ts-тэй ИЖИЛ орчны хувьсагч — хоёр модуль нэг үндэс харна. */
export function resolveLayout(root: string = process.env.MGLAI_DATA_DIR ?? defaultRoot()): InstallLayout {
  const state = join(root, 'state');
  return {
    root,
    app: join(root, 'app'),
    bin: join(root, 'bin'),
    node: join(root, 'node'),
    models: join(root, 'models'),
    knowledge: join(root, 'knowledge'),
    registry: join(root, 'registry'),
    logs: join(root, 'logs'),
    cache: join(root, 'cache'),
    state,
    staging: join(root, 'updates', 'staging'),
    manifests: join(root, 'updates', 'manifests'),
    diagnostics: join(root, 'diagnostics'),
    installedFile: join(state, 'installed.json'),
    healthFile: join(state, 'health.json'),
    installIdFile: join(state, 'install-id.json'),
    telemetryFile: join(state, 'telemetry.json'),
    supervisorLock: join(state, 'supervisor.lock'),
  };
}

export async function ensureLayout(layout: InstallLayout): Promise<void> {
  const dirs = [
    layout.root,
    layout.app,
    layout.bin,
    layout.node,
    layout.models,
    layout.knowledge,
    layout.registry,
    layout.logs,
    layout.cache,
    layout.state,
    layout.staging,
    layout.manifests,
    layout.diagnostics,
  ];
  for (const d of dirs) await mkdir(d, { recursive: true });
}

/**
 * Бүрэлдэхүүн бүрийн ХУВИЛБАРТАЙ хавтас ба ЗААГЧ файл.
 *
 * ⚠️ `model` нь ЭНД ОРОХГҮЙ — суурь загварын active/previous-ийг
 *    `modelManager.ts` (`models/state.json`) аль хэдийн удирддаг бөгөөд
 *    тэр нь тесттэй, ажиллаж байгаа.  Хоёр дахь заагч нэмэх нь хоёр
 *    үнэн үүсгэнэ.  `installed.json` нь загварын хувилбарыг тэндээс
 *    ТУСГАЖ авна (`installedState.ts` → `mirrorModelFromManager`).
 */
export function componentHome(layout: InstallLayout, component: Exclude<ComponentId, 'model'>): {
  versionsDir: string;
  pointerFile: string;
} {
  // `runtime` нь `app/versions/<v>/` (bootstrap.ps1-ийн `AppDir`-ийн дор),
  // `app` (UI гэрээ) нь `app/ui/versions/<v>/` — нэг эцэг, өөр хавтас.
  const base: Record<Exclude<ComponentId, 'model'>, string> = {
    app: join(layout.app, 'ui'),
    runtime: layout.app,
    knowledge: layout.knowledge,
    normRegistry: layout.registry,
    revit: join(layout.root, 'revit'),
  };
  const home = base[component];
  return { versionsDir: join(home, 'versions'), pointerFile: join(home, `current.${component}.json`) };
}
