/**
 * Keep-alive tabs — a drop-in replacement for the Radix-based `Tabs` +
 * `TabsContent` pair that does *not* unmount inactive panes after the
 * first time they are activated.
 *
 * Why this exists
 * ---------------
 * Radix `TabsPrimitive.Content` unmounts its children when its tab is
 * inactive (unless `forceMount` is passed).  For tab UIs that host
 * heavy children — Recharts, large editable tables, 3D viewers, forms
 * with their own `useEffect`-driven fetches — every tab switch tears
 * the subtree down and the next visit pays the full mount cost again,
 * including network round-trips.
 *
 * `KeepAliveTabsPanel` solves this in two stages:
 *
 *  1. Until the panel's `value` has been activated at least once, the
 *     panel renders `null`. This is the "lazy" half — tabs the user
 *     never opens cost nothing.
 *  2. Once activated, the panel switches to `forceMount` and stays in
 *     the tree forever; toggling the active tab is now just a CSS flip
 *     (`data-[state=inactive]:hidden`) on already-mounted DOM.
 *
 * Use it like Radix `Tabs`:
 *
 *   <KeepAliveTabs value={tab} onValueChange={setTab}>
 *     <TabsList>
 *       <TabsTrigger value="a">A</TabsTrigger>
 *       <TabsTrigger value="b">B</TabsTrigger>
 *     </TabsList>
 *     <KeepAliveTabsPanel value="a"><Heavy /></KeepAliveTabsPanel>
 *     <KeepAliveTabsPanel value="b"><Heavier /></KeepAliveTabsPanel>
 *   </KeepAliveTabs>
 *
 * For sites that drive their own custom button rows (the client
 * dashboard does this) you can pass `value`/`onValueChange` from the
 * outside and `KeepAliveTabs` will stay controlled.
 */
'use client';

import * as React from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';

import { cn } from '@/shared/lib/utils';

interface KeepAliveContextValue {
  /** The currently-active tab value. */
  current: string;
  /** Every tab value that has been active at some point this lifetime. */
  mounted: Set<string>;
}

const KeepAliveContext = React.createContext<KeepAliveContextValue | null>(null);

function useKeepAlive(): KeepAliveContextValue {
  const ctx = React.useContext(KeepAliveContext);
  if (!ctx) {
    throw new Error('KeepAliveTabsPanel must be rendered inside a <KeepAliveTabs>');
  }
  return ctx;
}

type KeepAliveTabsProps = React.ComponentProps<typeof TabsPrimitive.Root>;

function KeepAliveTabs({
  value,
  defaultValue,
  onValueChange,
  className,
  orientation = 'horizontal',
  children,
  ...props
}: KeepAliveTabsProps) {
  // Mirror Radix's controlled/uncontrolled behaviour so we can read the
  // current value ourselves (Radix doesn't expose it via context to
  // siblings — we'd have to use the consumer hook which would couple
  // us to Radix internals).
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState<string>(() => value ?? defaultValue ?? '');
  const current = isControlled ? (value as string) : internal;

  // Track which tabs have ever been active.  Seed with the initial
  // current so the first paint already has its panel mounted.
  const [mounted, setMounted] = React.useState<Set<string>>(() =>
    current ? new Set([current]) : new Set(),
  );

  React.useEffect(() => {
    if (!current) return;
    setMounted((prev) => {
      if (prev.has(current)) return prev;
      const next = new Set(prev);
      next.add(current);
      return next;
    });
  }, [current]);

  const handleChange = React.useCallback(
    (next: string) => {
      if (!isControlled) setInternal(next);
      onValueChange?.(next);
    },
    [isControlled, onValueChange],
  );

  const ctx = React.useMemo<KeepAliveContextValue>(
    () => ({ current, mounted }),
    [current, mounted],
  );

  return (
    <KeepAliveContext.Provider value={ctx}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-orientation={orientation}
        orientation={orientation}
        value={current}
        onValueChange={handleChange}
        className={cn('group/tabs flex gap-2 data-[orientation=horizontal]:flex-col', className)}
        {...props}
      >
        {children}
      </TabsPrimitive.Root>
    </KeepAliveContext.Provider>
  );
}

interface KeepAliveTabsPanelProps extends React.ComponentProps<typeof TabsPrimitive.Content> {
  /**
   * Force the panel to mount on first render even if it isn't yet
   * active. Useful for SEO-ish content or when you want the panel's
   * own `useEffect` data fetch to start eagerly.
   */
  alwaysMount?: boolean;
}

/**
 * Replacement for Radix `TabsContent`.  Lazily mounts on first
 * activation, then stays in the tree (hidden via CSS) for the
 * remainder of the parent's lifetime.
 */
function KeepAliveTabsPanel({
  value,
  className,
  alwaysMount,
  children,
  ...props
}: KeepAliveTabsPanelProps) {
  const { current, mounted } = useKeepAlive();
  const everActive = mounted.has(value);
  const isActive = current === value;

  if (!alwaysMount && !everActive && !isActive) {
    return null;
  }

  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      value={value}
      forceMount
      className={cn('flex-1 outline-none data-[state=inactive]:hidden', className)}
      {...props}
    >
      {children}
    </TabsPrimitive.Content>
  );
}

export { KeepAliveTabs, KeepAliveTabsPanel };
