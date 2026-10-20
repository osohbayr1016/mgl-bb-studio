import { useLayoutEffect, useRef } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { EASE_OUT } from '@/shared/lib/motion';
import type { ReportWindow } from '../types';
import { ManagementMemberView } from './ManagementMemberView';
import { MgmtCalendar } from './mgmt/MgmtCalendar';

/**
 * «Тайлан → Менежментийн багийн тайлан» (зөвхөн CEO + admin — хуудас admin-only,
 * backend `requireAdmin`).  Өдрийн ажлын тайлангийн (0345) багийн уншлага:
 *   • Баг — `MgmtCalendar`: календарь («7 хоног» мөр = хүн × багана = өдөр, «Сар»),
 *     нүд дээр дарахад тэр хүний тэр өдрийн бүтэн тайлан.  `?cv=&cd=&who=`; өөрийн
 *     хугацааны навигацтай тул хуудасны толгойн цонх энд НУУГДАНА (ReportsPage).
 *   • Гишүүн — `?mu=<id>`: тэр хүний бүтэн нэгтгэл + жилийн heatmap (`ManagementMemberView`).
 * Бичих нь баруун доод булангийн тэмдэглэлээр (`features/daily-log/DailyLogNote.tsx`).
 * Гишүүний хуудас нь хуудасны толгойн цонх/anchor-ыг дагана.
 */
export function ManagementLogsTab({
  window: win,
  anchor,
  memberId,
  onMember,
}: {
  window: ReportWindow;
  anchor: string;
  memberId: number | null;
  onMember: (id: number | null) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  /** Гишүүн нээхийн өмнөх гүйлгэлтийн байрлал — «Бүх гишүүд» рүү буцахад сэргээнэ. */
  const savedScroll = useRef<{ el: HTMLElement; top: number } | null>(null);
  const memberRef = useRef(memberId);
  useLayoutEffect(() => {
    memberRef.current = memberId;
  }, [memberId]);

  const openMember = (id: number | null) => {
    if (id != null) {
      const el = scrollParent(rootRef.current);
      savedScroll.current = { el, top: el.scrollTop };
    }
    onMember(id);
  };

  // Хуучин харагдац гарч дууссаны дараа: гишүүн рүү бол табын эхэнд, буцахад өмнөх байрлал руу.
  const onSwap = () => {
    const root = rootRef.current;
    if (!root) return;
    if (memberRef.current != null) {
      if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: 'start' });
    } else if (savedScroll.current) {
      const { el, top } = savedScroll.current;
      savedScroll.current = null;
      requestAnimationFrame(() => el.scrollTo({ top }));
    }
  };

  return (
    <div ref={rootRef} className="scroll-mt-24">
      <AnimatePresence mode="wait" initial={false} onExitComplete={onSwap}>
        <m.div
          key={memberId ?? 'team'}
          initial={{ opacity: 0, x: memberId != null ? 16 : -16 }}
          animate={{ opacity: 1, x: 0, transition: { duration: 0.24, ease: EASE_OUT } }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
        >
          {memberId != null ? (
            <ManagementMemberView
              userId={memberId}
              window={win}
              anchor={anchor}
              onBack={() => openMember(null)}
            />
          ) : (
            <MgmtCalendar onMember={openMember} />
          )}
        </m.div>
      </AnimatePresence>
    </div>
  );
}

function scrollParent(el: HTMLElement | null): HTMLElement {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}
