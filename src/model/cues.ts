/**
 * Sound cues: what the player should hear when the night changes. Pure: given
 * the night before and after a change, list the cues; ../sfx.ts plays them.
 * Deriving cues from state (rather than from each call site) means every way a
 * thing can happen (hand, look-and-pinch, the clock) sounds the same.
 */
import { usableWh } from './power-model.js';
import type { NightState } from './night.js';

export type Cue =
  | 'plug'
  | 'unplug'
  | 'trip'
  | 'refused'
  | 'gen-start'
  | 'gen-stop'
  | 'request'
  | 'served'
  | 'missed'
  | 'battery-low'
  | 'battery-dead'
  | 'dawn'
  | 'spoiled';

/** The battery warning sounds once when the charge drops through this fraction of usable. */
export const LOW_BATTERY_FRACTION = 0.15;

/**
 * Cues for the change from `a` to `b` (the same night, later). Writes into and
 * returns `out`, so a caller can reuse one array. Different nights → no cues.
 */
export function cuesFor(a: NightState, b: NightState, out: Cue[] = []): Cue[] {
  out.length = 0;
  if (a === b || a.spec !== b.spec || a.requests.length !== b.requests.length) return out;
  const pa = a.power;
  const pb = b.power;

  if (b.trips > a.trips) out.push('trip');
  if (b.backfeedRefusals > a.backfeedRefusals) out.push('refused');

  const died = pa.remainingWh > 0 && pb.remainingWh <= 0;
  if (b.trips === a.trips) {
    let added = false;
    let removed = false;
    for (const id of pb.on) if (!pa.on.includes(id)) added = true;
    for (const id of pa.on) if (!pb.on.includes(id)) removed = true;
    if (added) out.push('plug');
    if (removed && !died) out.push('unplug');
  }

  if (pa.source === 'battery' && pb.source === 'generator') out.push('gen-start');
  if (pa.source === 'generator' && pb.source === 'battery') out.push('gen-stop');

  for (let i = 0; i < b.requests.length; i++) {
    const was = a.requests[i].status;
    const now = b.requests[i].status;
    if (was === now) continue;
    if (now === 'open') out.push('request');
    else if (now === 'served') out.push('served');
    else if (now === 'expired') out.push('missed');
  }

  const usable = usableWh(b.cfg.battery);
  const low = usable * LOW_BATTERY_FRACTION;
  if (died) out.push('battery-dead');
  else if (pa.remainingWh > low && pb.remainingWh <= low) out.push('battery-low');

  if (a.outcome.kind === 'playing' && b.outcome.kind === 'won') out.push('dawn');
  if (a.outcome.kind === 'playing' && b.outcome.kind === 'lost') out.push('spoiled');
  return out;
}
