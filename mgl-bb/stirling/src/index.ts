import { Container, getContainer } from '@cloudflare/containers';

export interface Env {
  STIRLING: DurableObjectNamespace<StirlingContainer>;
}

// The container instance. `defaultPort` must match the EXPOSEd port in the
// Dockerfile; requests block until Stirling is listening on it.
export class StirlingContainer extends Container<Env> {
  defaultPort = 8080;
  // Keep one warm instance for ~15 min after the last request, then sleep
  // (scales to zero). Tune to trade cost vs. cold-start frequency.
  sleepAfter = '15m';

  override onError(error: unknown) {
    console.log('[stirling] container error', error);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Stirling is stateless per request, so route everything to ONE shared,
    // pinned instance. This serves both:
    //   - MGL's internal service-binding API calls (/api/v1/...), and
    //   - the public Stirling web UI (the "PDF засах" manual-edit button),
    //     when this Worker is exposed on a (preferably Access-protected) URL.
    const container = getContainer(env.STIRLING, 'singleton');
    return container.fetch(request);
  },
} satisfies ExportedHandler<Env>;
