import { Container, getContainer } from '@cloudflare/containers';

export interface Env {
  WEASYPRINT: DurableObjectNamespace<WeasyPrintContainer>;
}

// The container instance. `defaultPort` must match the EXPOSEd port in the
// Dockerfile; requests block until gunicorn is listening on it.
export class WeasyPrintContainer extends Container<Env> {
  defaultPort = 8080;
  // Keep one warm instance for ~15 min after the last render, then sleep
  // (scales to zero). Tune to trade cost vs. cold-start frequency.
  sleepAfter = '15m';

  override onError(error: unknown) {
    console.log('[weasyprint] container error', error);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // WeasyPrint is stateless per request, so route everything to ONE shared,
    // pinned instance. This serves the MGL backend's WEASYPRINT_SVC service
    // binding (POST /render, GET /health). No public hop, no API key.
    const container = getContainer(env.WEASYPRINT, 'singleton');
    return container.fetch(request);
  },
} satisfies ExportedHandler<Env>;
