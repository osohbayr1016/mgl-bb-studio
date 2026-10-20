# MGL UI — building with this design system

The MGL construction-app design system: React 19 + Radix primitives + **Tailwind v4**.
The operational UI is **dark by default** — build dark unless you are targeting the
client-facing marketing surface.

## Setup & theming

- **Most components need no wrapper.** They read their colors from CSS variables on
  `:root`, which carries the **dark** token set, so a plain mount is correctly themed.
- **Light (client) scope:** put `className="light"` on an ancestor — every semantic token
  flips to the parchment/blueprint light palette. `.dark` is also available explicitly.
- **A few components require `<LanguageProvider>`** (exported from the system) because they
  call the i18n hook: **Sidebar, Dialog, PolishableTextarea**. Everything else renders
  without it.
- **Overlays are Radix:** Dialog, AlertDialog, Sheet, Popover, DropdownMenu, Select,
  Tooltip open via `open` / `defaultOpen`; Tooltip must sit inside a `<TooltipProvider>`.

## Styling idiom — semantic Tailwind tokens (never raw hex)

Style with the system's semantic utilities. Each color family exists as
`bg-*`, `text-*`, `border-*`, and `ring-*`:

| Role | Utilities |
|---|---|
| App surface / text | `bg-background`, `text-foreground` |
| Card / popover / muted | `bg-card` + `text-card-foreground`, `bg-popover`, `bg-muted` + `text-muted-foreground` |
| Primary action (steel blue) | `bg-primary` + `text-primary-foreground` |
| Secondary / accent / danger | `bg-secondary` + `text-secondary-foreground`, `bg-accent`, `bg-destructive` |
| Lines & focus rings | `border-border`, `border-input`, `ring-ring` |
| Sidebar scope | `bg-sidebar`, `bg-sidebar-accent`, `text-sidebar-foreground` |
| Brand (client surface) | `bg-brand-navy`, `text-brand-copper`, `bg-brand-cloud`, `text-brand-blue` |

Fonts: `font-sans` (Inter — body/UI), `font-display` (Cormorant Garamond — editorial
headings), `font-grotesk` (Manrope — marketing display), `font-mono` (Space Grotesk —
numerals, project codes). Layout is plain Tailwind (`flex gap-3 p-6 rounded-lg`).

## Where the truth lives

- Token definitions ship in this system's `styles.css` import closure (`:root` / `.dark` /
  `.light` scopes) — read it before inventing a color.
- Each component's props and usage live in its `<Name>.prompt.md` and `<Name>.d.ts`.

## Idiomatic snippet

```tsx
// Components come from the MglUi design system (window.MglUi.*).
<div className="bg-background text-foreground p-6">
  <Card className="max-w-sm">
    <CardHeader>
      <CardTitle>Согоот Residence</CardTitle>
      <CardDescription>Барилгын явц · 3-р блок</CardDescription>
    </CardHeader>
    <CardContent className="flex items-center justify-between">
      <Badge>Хийгдэж буй</Badge>
      <Button size="sm">Тайлан үзэх</Button>
    </CardContent>
  </Card>
</div>
```
