/**
 * Порталын дээд мөр — архитектурын студийн сайтын хэв маягаар бараг үл
 * мэдэгдэх chrome: зүүн талд үгэн тэмдэг, баруунд төсөл солих, хэл, бүртгэл.
 * Хэсгийн навигаци нь ТУСДАА мөр (`ClientSectionNav`) — төсөл сонгогдсоны
 * дараа л гарна.
 */
import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, LogOut } from 'lucide-react';

import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { brand } from '@/shared/config/brand';
import { useLanguage, type Language } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { cn } from '@/shared/lib/utils';

import type { ClientPortalProject } from '../portalApi';
import { initialsOf, splitProjectTitle } from '../lib/clientFormat';
import { CLIENT_CONTAINER } from '../lib/layout';

export function ClientHeader({
  projects,
  activeId,
  onSelectProject,
  userName,
  userLogin,
  onLogout,
}: {
  projects: ClientPortalProject[] | null;
  activeId: number | null;
  onSelectProject: (id: number) => void;
  userName: string | null | undefined;
  userLogin: string | null | undefined;
  onLogout: () => void;
}) {
  const { t } = useLanguage();
  const b = brand();

  return (
    <header className="sticky top-0 z-40 border-b border-foreground/10 bg-background/90 backdrop-blur-md">
      <div className={cn(CLIENT_CONTAINER, 'flex h-16 items-center gap-3 sm:gap-4')}>
        <Link
          to="/client"
          className="group flex shrink-0 items-baseline gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={b.name}
        >
          <span className="font-display text-lg font-semibold tracking-[-0.02em] text-foreground">
            {b.name}
          </span>
        </Link>
        <span aria-hidden className="hidden h-5 w-px bg-foreground/15 lg:block" />
        <span className="hidden font-mono text-label uppercase tracking-[0.18em] text-muted-foreground lg:block">
          {t('clientRoom.portalLabel')}
        </span>

        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-3">
          {projects && projects.length > 1 ? (
            <ProjectSwitcher projects={projects} activeId={activeId} onSelect={onSelectProject} />
          ) : null}
          <LanguageToggle />
          <UserMenu name={userName} login={userLogin} onLogout={onLogout} />
        </div>
      </div>
    </header>
  );
}

function ProjectSwitcher({
  projects,
  activeId,
  onSelect,
}: {
  projects: ClientPortalProject[];
  activeId: number | null;
  onSelect: (id: number) => void;
}) {
  const { t } = useLanguage();
  const active = projects.find((p) => p.id === activeId) ?? null;
  const activeTitle = active ? splitProjectTitle(active.name, active.display_title).title : '';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 min-w-0 max-w-[13rem] shrink gap-2 rounded-none border border-foreground/15 px-2.5 font-normal hover:bg-foreground/[0.04] sm:max-w-[18rem] sm:px-3"
          data-testid="client-project-switcher"
        >
          <span className="hidden font-mono text-label uppercase tracking-[0.14em] text-muted-foreground sm:inline">
            {t('clientRoom.projectLabel')}
          </span>
          <span className="min-w-0 truncate text-body text-foreground">{activeTitle}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))] rounded-none p-0">
        <DropdownMenuLabel className="border-b border-foreground/10 px-4 py-3 font-mono text-label font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t('clientRoom.switchProject')} · {projects.length}
        </DropdownMenuLabel>
        {projects.map((p) => {
          const parts = splitProjectTitle(p.name, p.display_title);
          const selected = p.id === activeId;
          return (
            <DropdownMenuItem
              key={p.id}
              onSelect={() => onSelect(p.id)}
              className="flex items-start gap-3 rounded-none border-b border-foreground/5 px-4 py-3 last:border-b-0"
              title={p.name}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                {parts.code ? (
                  <span className="font-mono text-label uppercase tracking-[0.12em] text-muted-foreground">
                    {parts.code}
                  </span>
                ) : null}
                <span className="truncate text-sm text-foreground">{parts.title}</span>
              </span>
              <Check
                className={cn('mt-1 h-4 w-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
                strokeWidth={1.75}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const LANGS: readonly Language[] = ['mn', 'en'];

/** MN / EN — захиалагч гадаад компани байж болно. */
export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useLanguage();
  return (
    <div role="group" aria-label={t('clientRoom.language')} className={cn('flex items-center', className)}>
      {LANGS.map((l, i) => (
        <Fragment key={l}>
          {i > 0 ? (
            <span aria-hidden className="font-mono text-label text-muted-subtle">
              /
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="xs"
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
            className={cn(
              'h-8 rounded-none px-1.5 font-mono text-label uppercase tracking-[0.12em] hover:bg-transparent',
              lang === l ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {l}
          </Button>
        </Fragment>
      ))}
    </div>
  );
}

function UserMenu({
  name,
  login,
  onLogout,
}: {
  name: string | null | undefined;
  login: string | null | undefined;
  onLogout: () => void;
}) {
  const { t } = useLanguage();
  const display = formatDisplayName(name ?? '') || login || '';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-none p-0 hover:bg-transparent"
          aria-label={t('clientRoom.account')}
          data-testid="client-user-menu"
        >
          <span className="flex h-8 w-8 items-center justify-center bg-foreground font-display text-micro font-semibold tracking-[0.02em] text-background">
            {initialsOf(display)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-none p-0">
        <div className="border-b border-foreground/10 px-4 py-3">
          <p className="font-mono text-label uppercase tracking-[0.14em] text-muted-foreground">
            {t('clientRoom.signedInAs')}
          </p>
          <p className="mt-1.5 truncate text-sm font-medium text-foreground">{display}</p>
          {login ? <p className="truncate font-mono text-micro text-muted-foreground">{login}</p> : null}
        </div>
        <DropdownMenuItem onSelect={onLogout} className="gap-2 rounded-none px-4 py-3">
          <LogOut className="h-4 w-4" strokeWidth={1.75} />
          {t('clientRoom.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
