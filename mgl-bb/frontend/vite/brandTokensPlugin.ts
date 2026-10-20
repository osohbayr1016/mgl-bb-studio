import type { Plugin } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Статик файлууд дахь брэндийн орлуулагчийг build үед бөглөнө.
 *
 * ЯАГААД PLUGIN ХЭРЭГТЭЙ ВЭ: Vite нь `index.html` дотор `%VITE_X%`-ийг өөрөө
 * орлуулдаг, ГЭВЧ `public/` доторх файлуудыг ЯГ ХЭВЭЭР нь хуулдаг.  Тиймээс
 * `manifest.webmanifest`, `offline.html`, `sw.js` дэх компанийн нэр нь build
 * тохиргоог огт тоодоггүй байв — өөр компанид PWA нь «MGL» гэж суудаг,
 * холболт тасрахад «Холболт тасарсан — MGL» гэж гардаг байлаа.
 *
 * ⚠️ ДЕФОЛТ = ОДООГИЙН УТГА.  Env тохируулаагүй бол орлуулалтын үр дүн нь
 *    MGL-ийн өнөөдрийн текстүүдтэй БАЙТ БАЙТААРАА ижил.  Тиймээс энэ plugin-ийг
 *    нэвтрүүлэх нь ажиллаж байгаа production-д ямар ч өөрчлөлт үүсгэхгүй.
 *
 * ⚠️ БРЭНД БИШ зүйлсийг ЗОРИУДААР ХӨНДӨӨГҮЙ:
 *    - `sw.js`-ийн cache нэр (`mgl-shell-…`) — харагдахгүй, tenant бүр өөрийн
 *      origin-той тул мөргөлдөхгүй.
 *    - `mgl:push` / `mgl:navigate` postMessage сувгууд ба `mgl-` tag угтвар —
 *      эдгээр нь service worker ↔ апп хоёрын ХОЁР ТАЛТ гэрээ.  Нэг талыг нь
 *      сольвол мэдэгдэл чимээгүй ажиллахаа болино.
 */

/** Орлуулагч → тухайн env хувьсагч байхгүй үеийн ӨГӨГДМӨЛ (MGL-ийн одоогийн утга). */
const TOKEN_DEFAULTS: Record<string, string> = {
  VITE_ORG_NAME_SHORT: 'MGL',
  VITE_ORG_NAME: 'MGL E&C',
  VITE_ORG_APP_NAME: 'MGL Progress',
  VITE_ORG_DESCRIPTION: 'MGL Engineering & Consulting — төслийн явц, ирц, даалгаврын систем',
};

/** `public/` доторх аль файлд орлуулалт хийхийг зөвшөөрөх вэ. */
const PUBLIC_TARGETS = ['manifest.webmanifest', 'offline.html', 'sw.js'];

const TOKEN_RE = /%(VITE_ORG_[A-Z_]+)%/g;

/** JSON мөрөнд аюулгүй болгох — компанийн нэр `"` эсвэл `\` агуулж болно. */
function jsonEscape(v: string): string {
  return JSON.stringify(v).slice(1, -1);
}

/** HTML текстэд аюулгүй болгох. */
function htmlEscape(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function substitute(source: string, env: Record<string, string>, kind: 'html' | 'json' | 'js'): string {
  return source.replace(TOKEN_RE, (whole, name: string) => {
    const raw = env[name]?.trim() || TOKEN_DEFAULTS[name];
    if (raw === undefined) return whole; // танихгүй орлуулагчийг хэвээр үлдээнэ
    if (kind === 'json' || kind === 'js') return jsonEscape(raw);
    return htmlEscape(raw);
  });
}

function kindOf(file: string): 'html' | 'json' | 'js' {
  if (file.endsWith('.webmanifest') || file.endsWith('.json')) return 'json';
  if (file.endsWith('.js')) return 'js';
  return 'html';
}

export function brandTokensPlugin(): Plugin {
  let env: Record<string, string> = {};
  let publicDir = '';
  let outDir = '';

  return {
    name: 'mgl-brand-tokens',

    configResolved(config) {
      env = config.env as unknown as Record<string, string>;
      publicDir = config.publicDir;
      outDir = join(config.root, config.build.outDir);
    },

    // `index.html` — Vite өөрөө ч орлуулдаг ч ӨГӨГДМӨЛГҮЙ.  Энд хийснээр
    // env тохируулаагүй үед ч зөв утга (MGL) орно, орлуулагч түүхий үлдэхгүй.
    transformIndexHtml(html) {
      return substitute(html, env, 'html');
    },

    // Dev: `public/` шууд үйлчлэгддэг тул хүсэлт дээр нь орлуулна.
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        const name = url.replace(/^\//, '');
        if (!PUBLIC_TARGETS.includes(name)) return next();
        try {
          const source = await readFile(join(publicDir, name), 'utf8');
          const body = substitute(source, env, kindOf(name));
          res.setHeader(
            'Content-Type',
            name.endsWith('.webmanifest')
              ? 'application/manifest+json'
              : name.endsWith('.js')
                ? 'text/javascript'
                : 'text/html',
          );
          res.end(body);
        } catch {
          next();
        }
      });
    },

    // Build: Vite нь `public/`-ийг `dist/`-д хуулсны ДАРАА орлуулна.
    async closeBundle() {
      for (const name of PUBLIC_TARGETS) {
        const path = join(outDir, name);
        try {
          const source = await readFile(path, 'utf8');
          const next = substitute(source, env, kindOf(name));
          if (next !== source) await writeFile(path, next, 'utf8');
        } catch {
          // Файл байхгүй бол алгасна — build-ыг зогсоох шалтгаан биш.
        }
      }
    },
  };
}
