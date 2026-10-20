import { useNavigate } from 'react-router-dom';
import {
  ListPlus,
  TrendingUp,
  CalendarPlus,
  Lightbulb,
  Menu,
  type LucideIcon,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/ui/sheet';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { useIsManagerTier } from '@/shared/lib/score';

interface QuickAction {
  key: string;
  icon: LucideIcon;
  labelKey: string;
  /** Заасан бол энэ зам руу шилжинэ. */
  to?: string;
  /** Заасан бол sheet хаагдаад энэ дуудагдана. */
  run?: 'more';
  managerOnly?: boolean;
}

/**
 * ⚠️ «Ирц бүртгэх» энд ЗОРИУД байхгүй.
 * `shared/lib/device.ts`-ийн `isPhoneDevice()` нь утаснаас ирц бүртгэхийг
 * хориглодог (луйврын эсрэг бодлого — AttendancePage/AttendanceWidget хоёулаа
 * хэрэгжүүлдэг).  Зөвхөн утсан дээр гардаг sheet-д түүнийг гаргавал
 * мухардмал зам сурталчлах болно.
 */
const ACTIONS: QuickAction[] = [
  {
    key: 'createTask',
    icon: ListPlus,
    labelKey: 'quickActions.createTask',
    to: '/app/projects?action=new-task',
    managerOnly: true,
  },
  { key: 'submitProgress', icon: TrendingUp, labelKey: 'quickActions.submitProgress', to: '/app/my-tasks' },
  { key: 'requestLeave', icon: CalendarPlus, labelKey: 'quickActions.requestLeave', to: '/app/attendance?action=leave' },
  { key: 'suggestion', icon: Lightbulb, labelKey: 'quickActions.suggestion', to: '/app/suggestions?action=new' },
  { key: 'allMenu', icon: Menu, labelKey: 'quickActions.allMenu', run: 'more' },
];

interface QuickActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** «Бүх цэс» — sidebar drawer-ийг нээнэ. */
  onOpenMore: () => void;
}

/** Доод navbar-ын төв ⊕ товчны доороос гарах түргэн үйлдлийн самбар. */
export function QuickActionSheet({ open, onOpenChange, onOpenMore }: QuickActionSheetProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const isManager = useIsManagerTier();

  const visible = ACTIONS.filter((a) => !a.managerOnly || isManager);

  const handle = (action: QuickAction) => {
    onOpenChange(false);
    if (action.run === 'more') {
      onOpenMore();
      return;
    }
    if (action.to) navigate(action.to);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="rounded-t-2xl pb-[calc(env(safe-area-inset-bottom)+1rem)] max-h-[80dvh] overflow-y-auto lg:hidden"
      >
        {/* Чирэх бариул — доороос гарах самбарын танил дохио. */}
        <div className="mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30" />
        <SheetHeader className="pb-0">
          <SheetTitle className="text-base">{t('quickActions.title')}</SheetTitle>
        </SheetHeader>

        <div className="grid grid-cols-3 gap-2 px-4 pb-2">
          {visible.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.key}
                type="button"
                onClick={() => handle(action)}
                className={cn(
                  'flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl p-2',
                  'text-center text-xs font-medium text-foreground',
                  'transition-colors active:bg-accent/60 hover:bg-accent/40',
                )}
              >
                <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <span className="leading-tight">{t(action.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
