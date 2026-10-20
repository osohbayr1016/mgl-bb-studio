/**
 * Block-type picker modal — opens when the admin clicks the "+" affordance
 * between (or after) blocks in the list. Shows a card grid grouped into
 * "Section" and "Building block" categories, each with a lucide icon,
 * MN-first friendly name, and short description.
 *
 * Filtering: on home pages we hide `project-credits` (only meaningful on
 * project detail pages). Phase 2 doesn't apply the inverse — every block
 * type is available on project pages too.
 */

import {
  Award,
  Building2,
  FileText,
  Handshake,
  Hash,
  HardHat,
  Image as ImageIcon,
  Images,
  Info,
  KanbanSquare,
  LayoutGrid,
  Layers3,
  Mail,
  Minus,
  MousePointerClick,
  Newspaper,
  Type,
  Split,
  type LucideIcon,
} from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import {
  BLOCK_TYPE_META,
  BLOCK_TYPES,
  type BlockType,
} from '@/features/landing/types/landingBlocks';

const ICONS: Record<string, LucideIcon> = {
  Image: ImageIcon,
  ImageIcon,
  Images,
  LayoutGrid,
  Layers3,
  Building2,
  HardHat,
  KanbanSquare,
  Info,
  Hash,
  Award,
  Handshake,
  Newspaper,
  Mail,
  Type,
  Minus,
  MousePointerClick,
  FileText,
  Split,
};

interface BlockPickerModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** What kind of page is the admin editing? `home` excludes the
   *  project-credits block; `project` allows everything. */
  pageKind: 'home' | 'project';
  /** Called when the admin picks a block type. The caller is expected
   *  to close the modal AND insert the new block at the right slot. */
  onPick: (type: BlockType) => void;
}

export function BlockPickerModal({ open, onOpenChange, pageKind, onPick }: BlockPickerModalProps) {
  const allowed = BLOCK_TYPES.filter((t) => {
    const meta = BLOCK_TYPE_META[t];
    if (meta.projectPagesOnly && pageKind !== 'project') return false;
    return true;
  });
  const sections = allowed.filter((t) => BLOCK_TYPE_META[t].group === 'section');
  const buildingBlocks = allowed.filter((t) => BLOCK_TYPE_META[t].group === 'building-block');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Шинэ хэсэг нэмэх</DialogTitle>
          <DialogDescription>
            Аль хэсгийг нэмэхээ сонгоно уу. Дарсны дараа жагсаалтын тухайн байрлалд автоматаар
            үүснэ.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <Section title="Хэсгүүд / Sections">
            <Grid>
              {sections.map((t) => (
                <PickerCard key={t} type={t} onClick={() => onPick(t)} />
              ))}
            </Grid>
          </Section>

          <Section title="Барилгын блокууд / Building blocks">
            <Grid>
              {buildingBlocks.map((t) => (
                <PickerCard key={t} type={t} onClick={() => onPick(t)} />
              ))}
            </Grid>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function PickerCard({ type, onClick }: { type: BlockType; onClick: () => void }) {
  const meta = BLOCK_TYPE_META[type];
  const Icon = ICONS[meta.icon] ?? Type;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-2 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-primary hover:bg-accent"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="font-medium text-sm">{meta.friendly_mn}</div>
      <div className="text-xs text-muted-foreground">{meta.description_mn}</div>
    </button>
  );
}
