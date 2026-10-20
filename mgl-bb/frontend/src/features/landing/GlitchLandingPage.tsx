import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { brand } from '@/shared/config/brand';
import CoverVideoBackground from '@/shared/components/CoverVideoBackground';

/**
 * ТҮР зуурын нүүр хуудас — CMS-тэй LandingPage-ийг түр орлоно.
 *
 * Компанийн cover видео дэвсгэр + голд нь MGL нэр, нэвтрэх товч.
 * Буцаахдаа routes.tsx-ийн `/` route-ыг LandingPage руу эргүүлж залгана.
 */
export default function GlitchLandingPage() {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#05060c]">
      <CoverVideoBackground />

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="font-mono text-5xl font-bold tracking-[0.3em] text-white sm:text-7xl">
          {brand().nameShort}
        </h1>
        <p className="max-w-md font-mono text-sm text-white/80 sm:text-base">
          {brand().taglineMn}
        </p>
        <Link
          to="/login"
          className="pointer-events-auto inline-flex items-center gap-2 rounded-lg border border-white/30 bg-black/40 px-6 py-3 font-mono text-sm text-white backdrop-blur transition-colors hover:border-white/60 hover:bg-black/60"
        >
          Нэвтрэх
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-0 right-0 text-center font-mono text-[11px] text-white/50">
        © {new Date().getFullYear()} {brand().name}
      </div>
    </div>
  );
}
