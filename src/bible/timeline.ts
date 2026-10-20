import type { Bible, StoryPosition, TreeItem } from '@/project/types';
import { findContradictions, contradictionKey, openContradictions } from '@/bible/contradictions';
import { checkPosition, eventsInCycles, keptPositions } from '@/bible/ordering';
import { comparePositions, WHEN } from '@/bible/normalize';

export interface TimelineEntry {
  eventId: string;
  position: StoryPosition;
  versionIndex: number;
  versionCount: number;
  violated: boolean;
  inCycle: boolean;
}

export interface Timeline { contested: string[]; placed: TimelineEntry[]; unplaced: string[] }

export function buildTimeline(b: Bible, items: TreeItem[]): Timeline {
  const entities = items.filter(i => i.type === 'entity');
  const events = entities.filter(i => i.entityKind === 'event');
  const open = new Set(openContradictions(findContradictions(b, new Set(entities.map(i => i.id)))).map(c => c.key));
  const cycles = eventsInCycles(b);
  const title = new Map(events.map(e => [e.id, e.title.toLowerCase()]));
  const timeline: Timeline = { contested: [], placed: [], unplaced: [] };

  for (const ev of events) {
    if (open.has(contradictionKey(ev.id, WHEN))) { timeline.contested.push(ev.id); continue; }
    const positions = keptPositions(b, ev.id).sort(comparePositions);
    if (positions.length === 0) { timeline.unplaced.push(ev.id); continue; }
    positions.forEach((position, versionIndex) => {
      timeline.placed.push({
        eventId: ev.id, position, versionIndex, versionCount: positions.length,
        violated: checkPosition(b, ev.id, position).some(c => c.result === 'violated'),
        inCycle: cycles.has(ev.id),
      });
    });
  }
  timeline.placed.sort((x, y) => comparePositions(x.position, y.position)
    || (title.get(x.eventId) as string).localeCompare(title.get(y.eventId) as string));
  return timeline;
}
