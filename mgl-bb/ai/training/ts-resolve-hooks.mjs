/**
 * Node 22.14 fallback for build_behavior_sft.mjs.
 *
 * Node 22.15 added module.registerHooks(). Node 22.14 has module.register()
 * and stripTypeScriptTypes(), so this async loader supplies both resolution
 * and TypeScript loading for the backend source graph.
 */
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

export async function resolve(specifier, context, nextResolve) {
  if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Fall through so Node reports the original unresolved specifier.
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.ts')) {
    const source = await readFile(new URL(url), 'utf8');
    return {
      format: 'module',
      source: stripTypeScriptTypes(source, { mode: 'transform', sourceUrl: url }),
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
