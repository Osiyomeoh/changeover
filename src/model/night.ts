/**
 * One playable night: the rules layer over the power model. Pure; the ECS
 * systems only call these functions and render the result.
 *
 * Win: reach dawn with the fridge off for no more than FRIDGE_GRACE_H in total.
 * Stars: 1 survived · +1 served at least half the requests · +1 no trips.
 */
import { CATALOGUE, toAppliance } from './catalogue.js';
import { INVERTER, USABLE_FRACTION, type NightSpec } from './daily.js';
import {
  initialPower,
  resetTrip,
  runtimeHours,
  setSource,
  step,
  switchOff,
  switchOn,
  loadW,
  type PowerConfig,
  type PowerState,
  type Source,
  type SwitchOnResult,
} from './power-model.js';

export const FRIDGE_GRACE_H = 1;
/** How long a request stays open, game hours. */
export const REQUEST_WINDOW_H = 0.5;

export type Outcome =
  | { kind: 'playing' }
  | { kind: 'won'; stars: 1 | 2 | 3 }
  | { kind: 'lost'; reason: 'fridge-spoiled' };

export interface RequestState {
  atH: number;
  applianceId: string;
  status: 'pending' | 'open' | 'served' | 'expired';
}

export interface NightState {
  spec: NightSpec;
  cfg: PowerConfig;
  power: PowerState;
  elapsedH: number;
  fridgeOffH: number;
  trips: number;
  backfeedRefusals: number;
  /** Generator run time left, game hours. */
  fuelH: number;
  requests: RequestState[];
  outcome: Outcome;
}

export function configForNight(spec: NightSpec, generatorW?: number): PowerConfig {
  return {
    appliances: CATALOGUE.map(toAppliance),
    inverter: INVERTER,
    battery: { capacityWh: spec.batteryCapacityWh, usableFraction: USABLE_FRACTION },
    generator: generatorW ? { ratedW: generatorW } : undefined,
  };
}

export function startNight(spec: NightSpec, generatorW?: number, fuelH = 0): NightState {
  const cfg = configForNight(spec, generatorW);
  return {
    spec,
    cfg,
    power: initialPower(cfg),
    elapsedH: 0,
    fridgeOffH: 0,
    trips: 0,
    backfeedRefusals: 0,
    fuelH: generatorW ? fuelH : 0,
    requests: spec.requests.map((r) => ({ ...r, status: 'pending' as const })),
    outcome: { kind: 'playing' },
  };
}

function updateRequests(reqs: RequestState[], t: number, on: readonly string[]): RequestState[] {
  let changed = false;
  const next = reqs.map((r) => {
    if (r.status === 'served' || r.status === 'expired') return r;
    if (t < r.atH) return r;
    if (on.includes(r.applianceId)) { changed = true; return { ...r, status: 'served' as const }; }
    if (t >= r.atH + REQUEST_WINDOW_H) { changed = true; return { ...r, status: 'expired' as const }; }
    if (r.status !== 'open') { changed = true; return { ...r, status: 'open' as const }; }
    return r;
  });
  return changed ? next : reqs;
}

function stars(s: NightState): 1 | 2 | 3 {
  const served = s.requests.filter((r) => r.status === 'served').length;
  let n = 1;
  if (s.requests.length === 0 || served * 2 >= s.requests.length) n++;
  if (s.trips === 0) n++;
  return n as 1 | 2 | 3;
}

/**
 * Advance game time. Internally sub-steps at request and dawn boundaries so the
 * result does not depend on how the renderer slices frames.
 */
export function tick(s: NightState, dtH: number): NightState {
  if (s.outcome.kind !== 'playing' || dtH <= 0) return s;
  let state = s;
  let left = Math.min(dtH, s.spec.lengthH - s.elapsedH);
  while (left > 1e-12 && state.outcome.kind === 'playing') {
    // Next boundary: a request opening or closing, or dawn.
    let next = state.spec.lengthH;
    for (const r of state.requests) {
      if (r.atH > state.elapsedH && r.atH < next) next = r.atH;
      const close = r.atH + REQUEST_WINDOW_H;
      if (close > state.elapsedH && close < next) next = close;
    }
    if (state.power.source === 'generator') next = Math.min(next, state.elapsedH + state.fuelH);
    const h = Math.min(left, next - state.elapsedH);
    const fridgeOn = state.power.on.includes('fridge');
    const before = state.power;
    const power = step(state.cfg, before, h);
    // If the battery died mid-slice the fridge was on only for the part that ran.
    let fridgeOffAdd = fridgeOn ? 0 : h;
    if (fridgeOn && power.on.length === 0 && before.on.length > 0) {
      const ran = runtimeHours(state.cfg, before.remainingWh, loadW(state.cfg, before.on));
      fridgeOffAdd = Math.max(0, h - ran);
    }
    const elapsedH = state.elapsedH + h;
    const fridgeOffH = state.fridgeOffH + fridgeOffAdd;
    const fuelH = state.power.source === 'generator' ? Math.max(0, state.fuelH - h) : state.fuelH;
    state = { ...state, power, elapsedH, fridgeOffH, fuelH, requests: updateRequests(state.requests, elapsedH, power.on) };
    left -= h;
    // Out of fuel: the house falls back to the battery (and may trip it).
    if (state.power.source === 'generator' && state.fuelH <= 1e-12) {
      state = changeSource({ ...state, fuelH: 0 }, 'battery', false).state;
    }
    if (fridgeOffH > FRIDGE_GRACE_H + 1e-9) state = { ...state, outcome: { kind: 'lost', reason: 'fridge-spoiled' } };
    else if (elapsedH >= state.spec.lengthH - 1e-9) state = { ...state, outcome: { kind: 'won', stars: stars(state) } };
  }
  return state;
}

export function pinchOn(s: NightState, id: string): { state: NightState; result: SwitchOnResult } {
  if (s.outcome.kind !== 'playing') return { state: s, result: { ok: false, reason: 'already-on' } };
  const r = switchOn(s.cfg, s.power, id);
  const trips = s.trips + (r.state.tripped && !s.power.tripped ? 1 : 0);
  const requests = updateRequests(s.requests, s.elapsedH, r.state.on);
  return { state: { ...s, power: r.state, trips, requests }, result: r.result };
}

export function pinchOff(s: NightState, id: string): NightState {
  if (s.outcome.kind !== 'playing') return s;
  return { ...s, power: switchOff(s.power, id) };
}

/** Reset a tripped inverter/generator so loads can be switched on again. */
export function resetBreaker(s: NightState): NightState {
  return { ...s, power: resetTrip(s.power) };
}

export function changeSource(s: NightState, source: Source, interlockEnergised: boolean): {
  state: NightState;
  refused: 'backfeed' | 'no-generator' | 'no-fuel' | null;
} {
  if (source === 'generator' && s.cfg.generator && interlockEnergised && s.fuelH <= 0) {
    return { state: s, refused: 'no-fuel' };
  }
  const r = setSource(s.cfg, s.power, source, interlockEnergised);
  const trips = s.trips + (r.state.tripped && !s.power.tripped ? 1 : 0);
  const backfeedRefusals = s.backfeedRefusals + (r.refused === 'backfeed' ? 1 : 0);
  return { state: { ...s, power: r.state, trips, backfeedRefusals }, refused: r.refused };
}

/** Clock time shown to the player, e.g. "23:45". */
export function clockLabel(s: NightState): string {
  const total = Math.floor((s.spec.outageHour + s.elapsedH) * 60 + 1e-9);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
