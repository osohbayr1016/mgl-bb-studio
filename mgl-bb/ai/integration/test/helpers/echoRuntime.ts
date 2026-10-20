/**
 * ЖИНХЭНЭ runtime-ийг echo хөдөлгүүрээр, түр MGLAI_DATA_DIR дээр асаана.
 * GPU, загвар, интернэт ХЭРЭГГҮЙ.  Тест бүр ӨӨРИЙН серверийг асааж, `close()`-оор
 * SQLite-г хааж хавтсаа устгана (Windows EPERM-ээс сэргийлж).
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** §26 — sentinel: энэ мөр ямар ч хариунд ГАРАХ ЁСГҮЙ. */
export const SECRET = 'SENTINEL-INSTALL-SECRET-0123456789abcdef0123456789';

export interface EchoRuntime {
  base: string;
  headers: Record<string, string>;
  dataDir: string;
  knowledgeCopied: boolean;
  state: Awaited<ReturnType<typeof import('../../../runtime/src/server.ts')['buildState']>>;
  close(): Promise<void>;
}

export function localKnowledgeDb(): string | null {
  const root = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  const p = join(root, 'MglAi', 'knowledge', 'knowledge.sqlite');
  return existsSync(p) ? p : null;
}

export async function startEchoRuntime(opts: { copyKnowledge?: boolean } = {}): Promise<EchoRuntime> {
  const dataDir = mkdtempSync(join(tmpdir(), 'mglai-contract-'));
  writeFileSync(join(dataDir, 'secret.txt'), SECRET, 'utf8');

  let knowledgeCopied = false;
  const kdb = opts.copyKnowledge === false ? null : localKnowledgeDb();
  if (kdb) {
    mkdirSync(join(dataDir, 'knowledge'), { recursive: true });
    copyFileSync(kdb, join(dataDir, 'knowledge', 'knowledge.sqlite'));
    knowledgeCopied = true;
  }

  const { buildState, createRuntimeServer } = await import('../../../runtime/src/server.ts');
  const state = await buildState({
    ...process.env,
    MGLAI_DATA_DIR: dataDir,
    MGLAI_ENGINE: 'echo',
    MGLAI_PORT: '0',
    MGLAI_CONTROL_PLANE: 'http://127.0.0.1:9', // ⚠️ discard порт — сүлжээ рүү ХЭЗЭЭ Ч гарахгүй
    MGLAI_MODEL_PATH: '',
    MGLAI_LORA_PATH: '',
    MGLAI_IDLE_UNLOAD_MS: '0',
  });
  const server: Server = createRuntimeServer(state);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    base,
    headers: { 'x-mglai-secret': SECRET, 'content-type': 'application/json' },
    dataDir,
    knowledgeCopied,
    state,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      state.knowledge?.close();
      await state.engine.unload().catch(() => undefined);
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
