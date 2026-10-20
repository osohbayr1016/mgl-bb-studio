import type { PointerEventHandler } from 'react';
import { PROJECT_PALETTE } from '../../lib/projectColors';
import { laneColor } from '../../lib/teamView';
import type { BoardRow } from '../../lib/teamBoard';

/**
 * Самбар ↔ жагсаалтын харилцан онцлол.  Хүн дээр хулгана тавихад тэр хүн орсон
 * мөрүүд, төслийн мөр дээр тавихад тэр мөрийн хүмүүс онцлогдоно (бусад бүдгэрнэ).
 * Гар дээр `focus`-оор ч ажиллана — hover-д ганцаараа найдахгүй.
 */
export type BoardFocus = { kind: 'person'; id: number } | { kind: 'row'; key: string } | null;

/** Мөр бүрийн өнгө: төсөл = палитр (id-аас тогтвортой), засвар = warning, төслийн бус = info. */
export function rowAccent(row: Pick<BoardRow, 'kind' | 'id'>): { hex?: string; cls?: string } {
  if (row.kind === 'repair') return { cls: 'bg-warning' };
  if (row.kind === 'nonProject') return { cls: 'bg-info' };
  return { hex: laneColor(row.id, PROJECT_PALETTE) };
}

/** Хүний онцлол авах/алдах гар ба хулганы хэрэгслүүд — мөр бүрт ижил. */
export function focusHandlers(
  next: BoardFocus,
  onFocus: (f: BoardFocus) => void,
): {
  onPointerEnter: PointerEventHandler;
  onPointerLeave: PointerEventHandler;
  onFocusCapture: () => void;
  onBlurCapture: () => void;
} {
  return {
    onPointerEnter: () => onFocus(next),
    onPointerLeave: () => onFocus(null),
    onFocusCapture: () => onFocus(next),
    onBlurCapture: () => onFocus(null),
  };
}
