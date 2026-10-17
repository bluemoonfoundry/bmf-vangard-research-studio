import type { Bible, StoryPosition } from '@/project/types';

export const WHEN = 'when';

/** Matching rule for attribute names and values: trim, collapse whitespace runs, lower-case. */
export function normalizeText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export const attributeKey = (attr: string): string => normalizeText(attr);

export const isWhenAttribute = (attr: string): boolean => attributeKey(attr) === WHEN;

/** True when every part present in both positions is equal. */
export function positionsCompatible(a: StoryPosition, b: StoryPosition): boolean {
  if (a.season !== b.season) return false;
  if (a.episode !== undefined && b.episode !== undefined && a.episode !== b.episode) return false;
  if (a.order !== undefined && b.order !== undefined && a.order !== b.order) return false;
  return true;
}

const part = (n: number | undefined): number => n ?? Number.NEGATIVE_INFINITY;

/** Season, then episode, then order; a missing part sorts first. */
export function comparePositions(a: StoryPosition, b: StoryPosition): number {
  for (const [x, y] of [[a.season, b.season], [part(a.episode), part(b.episode)], [part(a.order), part(b.order)]]) {
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function specificity(p: StoryPosition): 0 | 1 | 2 {
  if (p.order !== undefined) return 2;
  return p.episode !== undefined ? 1 : 0;
}

export function formatPosition(p: StoryPosition): string {
  if (p.episode === undefined) return `Season ${p.season}`;
  const base = `S${p.season} · E${p.episode}`;
  return p.order === undefined ? base : `${base} · #${p.order}`;
}

export const emptyBible = (): Bible => ({ facts: [], dependencies: [], decisions: [] });
