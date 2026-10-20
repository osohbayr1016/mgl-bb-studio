import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(specifier + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

const canonical = await import('@mgl/mglai-common/redaction');

export const redactObject = canonical.redactObject;
export const redactText = canonical.redactText;
export const containsSentinel = canonical.containsSentinel;
export const REDACTION_VERSION = canonical.REDACTION_VERSION;
