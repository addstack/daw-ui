/**
 * Named zones of a value, by their lower bound in the value's units, e.g.
 * `{ warm: -18, hot: -6, clip: 0 }` for a meter in dBFS. A value is in the
 * zone with the highest bound it is above; the bound itself belongs to the
 * zone below, so 0 dB is not yet `clip`.
 */
export type Zones = Readonly<Record<string, number>>;

/** The zone a value is in, or `undefined` when it is above no bound. */
export function zoneOf(value: number, zones: Zones | undefined): string | undefined {
  if (!zones) return undefined;
  let zone: string | undefined;
  let highest = -Infinity;
  for (const [name, bound] of Object.entries(zones)) {
    if (value > bound && (zone === undefined || bound > highest)) {
      zone = name;
      highest = bound;
    }
  }
  return zone;
}
