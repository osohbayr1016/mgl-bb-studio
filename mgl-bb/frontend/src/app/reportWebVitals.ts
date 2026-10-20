// Web Vitals — fire-and-forget reporting so we have a baseline to
// measure the perf pass against.  Each metric is sent once with
// `keepalive` so it survives navigation; a tiny console.info log
// makes the values inspectable in dev without wiring up an extra
// dashboard.  When a real RUM endpoint is ready, swap the body of
// `report` to POST to it instead.
export function reportWebVitals() {
  if (typeof window === 'undefined') return;
  void import('web-vitals')
    .then(({ onCLS, onINP, onLCP, onFCP, onTTFB }) => {
      const report = (m: { name: string; value: number; id: string }) => {
        if (import.meta.env.DEV) {
          console.info(`[web-vitals] ${m.name}=${m.value.toFixed(1)} id=${m.id}`);
        }
      };
      onCLS(report);
      onINP(report);
      onLCP(report);
      onFCP(report);
      onTTFB(report);
    })
    .catch(() => {
      /* analytics is non-critical */
    });
}
