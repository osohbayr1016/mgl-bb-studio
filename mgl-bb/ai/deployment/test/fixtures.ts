/** Тестийн нийтлэг манифест — manifest/updatePlan/activation/acceptance хуваалцана. */
const SHA = 'a'.repeat(64);

export function goodManifest(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    schema: 'mgl-ai-release/1',
    releaseId: 'mgl-ai-2026.09.11.001',
    channel: 'stable',
    createdAt: '2026-09-11T10:00:00Z',
    components: {
      app: { version: '1.0.0', sha256: SHA, url: 'https://x/app.zip', sizeBytes: 100, requires: [{ component: 'runtime', min: '1.0.0' }] },
      runtime: { version: '1.0.0', sha256: SHA, url: 'https://x/rt.zip', sizeBytes: 100 },
      model: { id: 'mgl-qwen3-8b', version: '0.4', sha256: SHA, url: 'https://x/m.gguf', sizeBytes: 5_000_000_000, meta: { quantization: 'Q4_K_M' } },
      knowledge: { version: 'norms-2026.09.11.3', sha256: SHA, url: 'https://x/k.sqlite', sizeBytes: 5_000_000, meta: { schemaVersion: 3 } },
      normRegistry: { version: 'nr-18', sha256: SHA, url: null, sizeBytes: null },
    },
    compatibility: { minRuntimeVersion: '1.0.0' },
    ...over,
  };
}
