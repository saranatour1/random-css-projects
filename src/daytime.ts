// Phases of the real local day. Tints and the lantern switch live in cozy.css under [data-phase].
export type Phase = 'morning' | 'day' | 'golden' | 'evening' | 'night'

// Start hour of each phase, in clock order. Before the first start it is still night.
const STARTS: readonly [number, Phase][] = [
  [6, 'morning'],
  [10, 'day'],
  [17, 'golden'],
  [19, 'evening'],
  [21, 'night'],
]

export function phaseAt(date: Date): Phase {
  const h = date.getHours()
  let phase: Phase = 'night'
  for (const [start, p] of STARTS) if (h >= start) phase = p
  return phase
}

// The first phase start strictly after `date`, built from local fields so DST shifts land on the wall clock.
export function nextBoundary(date: Date): Date {
  const [y, m, d] = [date.getFullYear(), date.getMonth(), date.getDate()]
  for (const [start] of STARTS) {
    const at = new Date(y, m, d, start)
    if (at > date) return at
  }
  return new Date(y, m, d + 1, STARTS[0][0])
}

type SetT = (fn: () => void, ms: number) => unknown
type ClearT = (id: any) => void

// Applies the phase now, then once per boundary with a single pending timer. Call the result to stop.
export function startClock(
  apply: (phase: Phase) => void,
  now: () => Date = () => new Date(),
  set: SetT = setTimeout,
  clear: ClearT = clearTimeout,
): () => void {
  let id: unknown
  const tick = () => {
    const t = now()
    apply(phaseAt(t))
    id = set(tick, nextBoundary(t).getTime() - t.getTime())
  }
  tick()
  return () => clear(id)
}
