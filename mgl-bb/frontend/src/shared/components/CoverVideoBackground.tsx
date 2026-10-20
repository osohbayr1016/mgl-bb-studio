/** Full-bleed company cover video — `/` landing and `/login`. */
const SRC = '/cover-people.mp4';

export default function CoverVideoBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <video
        className="h-full w-full object-cover"
        src={SRC}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      />
      <div className="absolute inset-0 bg-black/30" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(5,6,12,0.06)_0%,rgba(5,6,12,0.4)_70%,rgba(5,6,12,0.7)_100%)]" />
    </div>
  );
}
