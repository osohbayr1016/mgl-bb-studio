/**
 * Left pane of the admin landing editor — pages list.
 *
 * "Home" is pinned at the top (singleton, can't be deleted). Project
 * pages are listed below with the muted "Hidden" badge if their
 * `published=0` flag is set. The "+ New project page" button at the
 * bottom creates a blank `landing_pages` row via the API and selects
 * it — admins then add blocks via the middle pane.
 */

import { useState } from 'react';
import { Eye, EyeOff, Home, Plus } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { adminLandingKeys, createPage } from '@/features/landing/components/admin/api';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Label } from '@/ui/label';
import { toast } from '@/shared/components/Toast';
import type { LandingPage } from '@/features/landing/types/landingBlocks';

interface PageSidebarProps {
  pages: LandingPage[];
  activeId: number | null;
  onSelect: (pageId: number) => void;
  lang: 'mn' | 'en';
}

export function PageSidebar({ pages, activeId, onSelect, lang }: PageSidebarProps) {
  const home = pages.find((p) => p.slug === 'home');
  const projects = pages.filter((p) => p.kind === 'project');
  const queryClient = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);

  const handleCreated = (page: LandingPage) => {
    queryClient.setQueryData<LandingPage[]>(adminLandingKeys.pages(), (prev) =>
      prev ? [...prev, page] : [page],
    );
    onSelect(page.id);
    setNewOpen(false);
    toast.success('Шинэ хуудас үүсгэгдлээ');
  };

  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-muted/20">
      <div className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Хуудаснууд
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {home && (
          <SidebarRow
            page={home}
            icon={<Home className="h-4 w-4" />}
            active={activeId === home.id}
            onSelect={() => onSelect(home.id)}
            lang={lang}
          />
        )}

        {projects.length > 0 && (
          <>
            <div className="px-3 pb-1 pt-4 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/80">
              Төслүүд · {projects.length}
            </div>
            {projects.map((p) => (
              <SidebarRow
                key={p.id}
                page={p}
                active={activeId === p.id}
                onSelect={() => onSelect(p.id)}
                lang={lang}
              />
            ))}
          </>
        )}
      </div>

      <div className="border-t border-border p-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={() => setNewOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" /> Шинэ төсөл хуудас
        </Button>
      </div>

      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} onCreated={handleCreated} />
    </aside>
  );
}

function SidebarRow({
  page,
  icon,
  active,
  onSelect,
  lang,
}: {
  page: LandingPage;
  icon?: React.ReactNode;
  active: boolean;
  onSelect: () => void;
  lang: 'mn' | 'en';
}) {
  const title = lang === 'mn' ? page.title_mn || page.title_en : page.title_en || page.title_mn;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
        active
          ? 'bg-primary/10 text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {icon}
      <span className="flex-1 truncate">{title || page.slug}</span>
      {page.published === 0 && (
        <span
          title="Нийтлэгдээгүй"
          className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground"
        >
          <EyeOff className="h-3 w-3" /> hidden
        </span>
      )}
      {page.published === 1 && active && <Eye className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}

function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (p: LandingPage) => void;
}) {
  const [titleMn, setTitleMn] = useState('');
  const [titleEn, setTitleEn] = useState('');

  const mutation = useMutation({
    mutationFn: () => createPage({ title_mn: titleMn.trim(), title_en: titleEn.trim() }),
    onSuccess: (page) => {
      onCreated(page);
      setTitleMn('');
      setTitleEn('');
    },
    onError: (err) =>
      toast.error('Үүсгэж чадсангүй', err instanceof Error ? err.message : undefined),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Шинэ төсөл хуудас</DialogTitle>
          <DialogDescription>
            Хуудасны нэрээ заана уу. URL автоматаар{' '}
            <span className="font-mono">/work/&lt;id&gt;</span> хэлбэрээр үүснэ.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Нэр (MN)
            </Label>
            <Input
              value={titleMn}
              onChange={(e) => setTitleMn(e.target.value)}
              placeholder="Шинэ төсөл"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Нэр (EN)
            </Label>
            <Input
              value={titleEn}
              onChange={(e) => setTitleEn(e.target.value)}
              placeholder="New project"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Болих
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !titleMn.trim()}
          >
            {mutation.isPending ? 'Үүсгэж байна…' : 'Үүсгэх'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
