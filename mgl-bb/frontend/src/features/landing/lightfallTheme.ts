/**
 * Shared palette for the Lightfall background so the landing page and the login
 * page draw from one source of truth — and so the `colors` array is a STABLE
 * module reference (a fresh array literal on every render would re-create the
 * WebGL context, since `colors` sits in Lightfall's effect deps).
 */

/** Streak colours (light-blue → violet → pink). */
export const LIGHTFALL_COLORS = ['#A6C8FF', '#5227FF', '#FF9FFC'];

/** Ambient background glow behind the streaks. */
export const LIGHTFALL_BG = '#0A29FF';

/* UI accents derived from the palette, for chrome (login card / buttons /
 * rings) that should "follow" the Lightfall background. */
export const LIGHTFALL_ACCENT = '#5227FF'; // hero — submit button, focus rings
export const LIGHTFALL_ACCENT_SOFT = '#A6C8FF'; // light-blue — links, brand dot
export const LIGHTFALL_PAGE_BG = '#05060c'; // near-black page base behind the canvas
