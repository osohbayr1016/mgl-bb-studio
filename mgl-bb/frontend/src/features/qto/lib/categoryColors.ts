// Revit категори → тогтмол өнгө + icon (Самбарын Element Dashboard).
//
// Өнгө ENTITY-г дагана (эрэмбэ/дараалал биш): Walls аль ч төсөлд, аль ч
// шүүлтийн дараа ижил өнгөтэй. Утгууд нь index.css-ийн --qto-cat-* хувьсагчид
// (хоёр theme-д тусдаа, dataviz validate_palette.js-ээр баталгаажсан).
// Танигдаагүй/хоосон категори → neutral саарал + Box icon. Өнгө identity-г
// хэзээ ч ганцаараа зөөхгүй — label/tooltip үргэлж хамт байх ёстой.

import {
  Anchor,
  AppWindow,
  Armchair,
  Box,
  BrickWall,
  Columns3,
  DoorOpen,
  Droplets,
  Fan,
  Fence,
  Frame,
  Home,
  Layers,
  Lightbulb,
  PanelTop,
  Zap,
  type LucideIcon,
} from 'lucide-react';

interface CategoryMeta {
  cssVar: string;
  Icon: LucideIcon;
}

const META = {
  walls: { cssVar: '--qto-cat-walls', Icon: BrickWall },
  floors: { cssVar: '--qto-cat-floors', Icon: Layers },
  ceilings: { cssVar: '--qto-cat-ceilings', Icon: PanelTop },
  roofs: { cssVar: '--qto-cat-roofs', Icon: Home },
  doors: { cssVar: '--qto-cat-doors', Icon: DoorOpen },
  windows: { cssVar: '--qto-cat-windows', Icon: AppWindow },
  framing: { cssVar: '--qto-cat-framing', Icon: Frame },
  columns: { cssVar: '--qto-cat-columns', Icon: Columns3 },
  foundations: { cssVar: '--qto-cat-foundations', Icon: Anchor },
  stairs: { cssVar: '--qto-cat-stairs', Icon: Fence },
  plumbing: { cssVar: '--qto-cat-plumbing', Icon: Droplets },
  mech: { cssVar: '--qto-cat-mech', Icon: Fan },
  elec: { cssVar: '--qto-cat-elec', Icon: Zap },
  lighting: { cssVar: '--qto-cat-lighting', Icon: Lightbulb },
  furniture: { cssVar: '--qto-cat-furniture', Icon: Armchair },
  neutral: { cssVar: '--qto-cat-neutral', Icon: Box },
} satisfies Record<string, CategoryMeta>;

type CanonicalCategory = keyof typeof META;

// Revit-ийн (англи) категори нэр → канон бүлэг. Add-in Revit-ийн Category.Name
// string-ийг шууд илгээдэг; MEP-ийн төрөл бүрийн дэд категориуд нэг өнгөний
// бүлэгт санаатай нэгддэг (label нь ялгааг зөөнө).
const NAME_TO_CANON: Record<string, CanonicalCategory> = {
  walls: 'walls',
  'curtain panels': 'walls',
  'curtain wall mullions': 'walls',
  'wall sweeps': 'walls',
  floors: 'floors',
  ceilings: 'ceilings',
  roofs: 'roofs',
  fascias: 'roofs',
  gutters: 'roofs',
  doors: 'doors',
  windows: 'windows',
  'structural framing': 'framing',
  'structural trusses': 'framing',
  'structural columns': 'columns',
  columns: 'columns',
  'structural foundations': 'foundations',
  stairs: 'stairs',
  railings: 'stairs',
  ramps: 'stairs',
  pipes: 'plumbing',
  'pipe fittings': 'plumbing',
  'pipe accessories': 'plumbing',
  'plumbing fixtures': 'plumbing',
  'plumbing equipment': 'plumbing',
  sprinklers: 'plumbing',
  ducts: 'mech',
  'duct fittings': 'mech',
  'duct accessories': 'mech',
  'air terminals': 'mech',
  'mechanical equipment': 'mech',
  'electrical equipment': 'elec',
  'electrical fixtures': 'elec',
  conduits: 'elec',
  'conduit fittings': 'elec',
  'cable trays': 'elec',
  'cable tray fittings': 'elec',
  'lighting fixtures': 'lighting',
  'lighting devices': 'lighting',
  furniture: 'furniture',
  'furniture systems': 'furniture',
  casework: 'furniture',
};

export interface CategoryStyle {
  /** CSS color утга — style attribute-д шууд тавина. */
  color: string;
  Icon: LucideIcon;
  canon: CanonicalCategory;
}

export function categoryStyle(name: string | null | undefined): CategoryStyle {
  const canon = NAME_TO_CANON[(name ?? '').trim().toLowerCase()] ?? 'neutral';
  const meta = META[canon];
  return { color: `hsl(var(${meta.cssVar}))`, Icon: meta.Icon, canon };
}
