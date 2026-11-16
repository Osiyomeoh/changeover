/**
 * Pure power model for one outage night. No Three.js, no ECS, no DOM:
 * everything here is deterministic and unit-tested (power-model.test.ts).
 *
 * Units: watts (W), watt-hours (Wh), hours (h), degrees Celsius (°C).
 * Appliance figures are *parameters*; the catalogue that feeds them must cite
 * a public source (see CLAIMS.md). Nothing here hard-codes a real-world fact.
 */

export interface Appliance {
  id: string;
  /** Steady running draw. */
  runningW: number;
  /** Peak draw for the first moment after switch-on (motors, compressors). >= runningW. */
  surgeW: number;
}

export interface Inverter {
  /** Maximum sustained output. */
  continuousW: number;
  /** Maximum momentary output (start-up surge). >= continuousW. */
  surgeW: number;
  /** DC→AC efficiency, 0 < efficiency <= 1. */
  efficiency: number;
}

export interface Battery {
  capacityWh: number;
  /** Fraction of capacity that may be used (depth of discharge), 0..1. */
  usableFraction: number;
}

export type Source = 'battery' | 'generator';

export interface Generator {
  ratedW: number;
}

export type SwitchOnResult =
  | { ok: true }
  | { ok: false; reason: 'overload'; demandW: number; limitW: number }
  | { ok: false; reason: 'surge'; demandW: number; limitW: number }
  | { ok: false; reason: 'unknown-appliance' }
  | { ok: false; reason: 'already-on' };

export interface PowerState {
  /** Ids of appliances currently on. */
  on: string[];
  /** Energy left in the battery that may still be used, Wh. */
  remainingWh: number;
  source: Source;
  /** True once the inverter or generator has tripped this step. Cleared by resetTrip. */
  tripped: boolean;
}

export interface PowerConfig {
  appliances: readonly Appliance[];
  inverter: Inverter;
  battery: Battery;
  generator?: Generator;
}

function assertFinite(name: string, v: number, min = 0): void {
  if (!Number.isFinite(v) || v < min) throw new RangeError(`${name} must be a finite number >= ${min}, got ${v}`);
}

/** Throws on physically impossible configuration so bad data never reaches the game. */
export function validateConfig(cfg: PowerConfig): void {
  const ids = new Set<string>();
  for (const a of cfg.appliances) {
    if (ids.has(a.id)) throw new RangeError(`duplicate appliance id ${a.id}`);
    ids.add(a.id);
    assertFinite(`${a.id}.runningW`, a.runningW);
    assertFinite(`${a.id}.surgeW`, a.surgeW);
    if (a.surgeW < a.runningW) throw new RangeError(`${a.id}.surgeW < runningW`);
  }
  assertFinite('inverter.continuousW', cfg.inverter.continuousW);
  assertFinite('inverter.surgeW', cfg.inverter.surgeW);
  if (cfg.inverter.surgeW < cfg.inverter.continuousW) throw new RangeError('inverter.surgeW < continuousW');
  const e = cfg.inverter.efficiency;
  if (!(e > 0 && e <= 1)) throw new RangeError(`inverter.efficiency must be in (0, 1], got ${e}`);
  assertFinite('battery.capacityWh', cfg.battery.capacityWh);
  const u = cfg.battery.usableFraction;
  if (!(u >= 0 && u <= 1)) throw new RangeError(`battery.usableFraction must be in [0, 1], got ${u}`);
  if (cfg.generator) assertFinite('generator.ratedW', cfg.generator.ratedW);
}

export function usableWh(b: Battery): number {
  return b.capacityWh * b.usableFraction;
}

export function initialPower(cfg: PowerConfig): PowerState {
  validateConfig(cfg);
  return { on: [], remainingWh: usableWh(cfg.battery), source: 'battery', tripped: false };
}

function find(cfg: PowerConfig, id: string): Appliance | undefined {
  for (const a of cfg.appliances) if (a.id === id) return a;
  return undefined;
}

/** Sum of running draw for the given appliance ids (unknown ids ignored). */
export function loadW(cfg: PowerConfig, on: readonly string[]): number {
  let w = 0;
  for (const id of on) w += find(cfg, id)?.runningW ?? 0;
  return w;
}

/** Sustained and surge limits of whichever source is feeding the house. */
export function limits(cfg: PowerConfig, source: Source): { continuousW: number; surgeW: number } {
  if (source === 'generator') {
    const r = cfg.generator?.ratedW ?? 0;
    return { continuousW: r, surgeW: r };
  }
  return { continuousW: cfg.inverter.continuousW, surgeW: cfg.inverter.surgeW };
}

/**
 * Would switching this appliance on be accepted? Overload = sustained draw above
 * the continuous limit. Surge = the existing load plus the new appliance's start-up
 * peak above the surge limit. Overload is reported first.
 */
export function checkSwitchOn(cfg: PowerConfig, state: PowerState, id: string): SwitchOnResult {
  const a = find(cfg, id);
  if (!a) return { ok: false, reason: 'unknown-appliance' };
  if (state.on.includes(id)) return { ok: false, reason: 'already-on' };
  const base = loadW(cfg, state.on);
  const lim = limits(cfg, state.source);
  const sustained = base + a.runningW;
  if (sustained > lim.continuousW) return { ok: false, reason: 'overload', demandW: sustained, limitW: lim.continuousW };
  const peak = base + a.surgeW;
  if (peak > lim.surgeW) return { ok: false, reason: 'surge', demandW: peak, limitW: lim.surgeW };
  return { ok: true };
}

/**
 * Switch an appliance on. A rejected switch-on *trips* the source: every load
 * drops, as a real inverter or generator breaker would. Returns a new state.
 */
export function switchOn(cfg: PowerConfig, state: PowerState, id: string): { state: PowerState; result: SwitchOnResult } {
  const result = checkSwitchOn(cfg, state, id);
  if (result.ok) return { state: { ...state, on: [...state.on, id] }, result };
  if (result.reason === 'overload' || result.reason === 'surge') {
    return { state: { ...state, on: [], tripped: true }, result };
  }
  return { state, result };
}

export function switchOff(state: PowerState, id: string): PowerState {
  if (!state.on.includes(id)) return state;
  return { ...state, on: state.on.filter((x) => x !== id) };
}

export function resetTrip(state: PowerState): PowerState {
  return state.tripped ? { ...state, tripped: false } : state;
}

/** Battery energy drawn per hour for an AC load, accounting for inverter losses. */
export function batteryDrawW(cfg: PowerConfig, acLoadW: number): number {
  return acLoadW / cfg.inverter.efficiency;
}

/** Hours until the usable battery is empty at a constant AC load. Infinity at zero load. */
export function runtimeHours(cfg: PowerConfig, remainingWh: number, acLoadW: number): number {
  if (acLoadW <= 0) return Infinity;
  return Math.max(0, remainingWh) / batteryDrawW(cfg, acLoadW);
}

/**
 * Advance the night by `hours`. On battery, energy drains; if it runs out
 * part-way, every load drops (the inverter's low-voltage cut-off). On generator
 * the battery is untouched.
 */
export function step(cfg: PowerConfig, state: PowerState, hours: number): PowerState {
  assertFinite('hours', hours);
  if (state.source === 'generator' || state.on.length === 0 || hours === 0) return state;
  const draw = batteryDrawW(cfg, loadW(cfg, state.on));
  const used = draw * hours;
  if (used >= state.remainingWh) return { ...state, remainingWh: 0, on: [] };
  return { ...state, remainingWh: state.remainingWh - used };
}

/**
 * Change the feeding source. Moving to the generator is only legal when the
 * changeover interlock is energised (isolated from the street line); otherwise
 * it would backfeed the grid and is refused. Loads above the new source's
 * continuous limit trip it.
 */
export function setSource(
  cfg: PowerConfig,
  state: PowerState,
  source: Source,
  interlockEnergised: boolean,
): { state: PowerState; refused: 'backfeed' | 'no-generator' | null } {
  if (source === state.source) return { state, refused: null };
  if (source === 'generator') {
    if (!cfg.generator) return { state, refused: 'no-generator' };
    if (!interlockEnergised) return { state, refused: 'backfeed' };
  }
  const next = { ...state, source };
  if (loadW(cfg, next.on) > limits(cfg, source).continuousW) {
    return { state: { ...next, on: [], tripped: true }, refused: null };
  }
  return { state: next, refused: null };
}

/** "9 h 40 m". Rounds down to the whole minute so we never overstate runtime. */
export function formatHours(h: number): string {
  if (h === Infinity) return '∞';
  if (!Number.isFinite(h) || h < 0) throw new RangeError(`bad hours ${h}`);
  const totalMin = Math.floor(h * 60 + 1e-9);
  return `${Math.floor(totalMin / 60)} h ${totalMin % 60} m`;
}

export interface FreezerParams {
  /** Ambient room temperature in an outage. */
  ambientC: number;
  /** Temperature the compressor pulls toward when running. */
  setpointC: number;
  /** First-order time constant while off (insulation), hours. */
  warmTauH: number;
  /** First-order time constant while running, hours. */
  coolTauH: number;
}

/**
 * First-order (Newton) temperature step. Exact for constant power over `hours`,
 * so step size does not change the answer.
 */
export function freezerStep(p: FreezerParams, tempC: number, powered: boolean, hours: number): number {
  assertFinite('hours', hours);
  const target = powered ? p.setpointC : p.ambientC;
  const tau = powered ? p.coolTauH : p.warmTauH;
  if (!(tau > 0)) throw new RangeError('tau must be > 0');
  return target + (tempC - target) * Math.exp(-hours / tau);
}

/** Hours unpowered until the freezer warms from `tempC` to `limitC`. Infinity if it never does. */
export function hoursUntilThaw(p: FreezerParams, tempC: number, limitC: number): number {
  if (tempC >= limitC) return 0;
  if (p.ambientC <= limitC) return Infinity;
  return p.warmTauH * Math.log((p.ambientC - tempC) / (p.ambientC - limitC));
}
