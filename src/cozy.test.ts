import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dogName, once, welcomeBack } from './cozy.ts'
import { nextBoundary, phaseAt, startClock, type Phase } from './daytime.ts'

const at = (h: number, m = 0, d = 26) => new Date(2026, 9, d, h, m)

test('phaseAt flips exactly on each boundary', () => {
  const cases: [Date, Phase][] = [
    [at(0), 'night'],
    [at(5, 59), 'night'],
    [at(6), 'morning'],
    [at(9, 59), 'morning'],
    [at(10), 'day'],
    [at(16, 59), 'day'],
    [at(17), 'golden'],
    [at(19), 'evening'],
    [at(20, 59), 'evening'],
    [at(21), 'night'],
    [at(23, 59), 'night'],
  ]
  for (const [date, phase] of cases) assert.equal(phaseAt(date), phase, date.toTimeString())
})

test('nextBoundary is strictly later and wraps to tomorrow morning', () => {
  assert.deepEqual(nextBoundary(at(6)), at(10))
  assert.deepEqual(nextBoundary(at(12, 30)), at(17))
  assert.deepEqual(nextBoundary(at(22)), at(6, 0, 27))
  assert.deepEqual(nextBoundary(at(3)), at(6))
})

test('startClock applies now and keeps one timer aimed at the next boundary', () => {
  let clock = at(16, 30)
  const pending = new Map<number, { fn: () => void; ms: number }>()
  let nextId = 0
  const set = (fn: () => void, ms: number) => (pending.set(++nextId, { fn, ms }), nextId)
  const clear = (id: number) => pending.delete(id)
  const seen: Phase[] = []

  const stop = startClock((p) => seen.push(p), () => clock, set, clear)
  assert.deepEqual(seen, ['day'])
  assert.equal(pending.size, 1)
  assert.equal([...pending.values()][0].ms, 30 * 60_000, 'fires at 17:00, not by polling')

  const [[id, timer]] = pending
  pending.delete(id)
  clock = at(17)
  timer.fn()
  assert.deepEqual(seen, ['day', 'golden'])
  assert.equal(pending.size, 1)
  assert.equal([...pending.values()][0].ms, 2 * 3_600_000, 'then at 19:00')

  stop()
  assert.equal(pending.size, 0, 'stop clears the pending timer')
})

test('welcomeBack counts only crops that ripened since leaving', () => {
  const grow = 4000
  const left = 100_000
  const now = 500_000
  const ripeAfterLeaving = left - grow
  const plots = [
    ...Array.from({ length: 6 }, () => ({ crop: 0 as const, at: ripeAfterLeaving })),
    { crop: 2 as const, at: ripeAfterLeaving },
    { crop: 2 as const, at: ripeAfterLeaving },
    { crop: 1 as const, at: left - 3 * grow },
    { crop: 1 as const, at: now - grow },
  ]
  assert.equal(welcomeBack(plots, left, now, grow), 'Welcome back! 6 carrots and 2 wheat ripened while you were away.')
  assert.equal(
    welcomeBack([...plots, { crop: 1, at: ripeAfterLeaving }], left, now, grow),
    'Welcome back! 6 carrots, 1 turnip and 2 wheat ripened while you were away.',
  )
  assert.equal(welcomeBack([{ crop: 0, at: ripeAfterLeaving }], left, now, grow), 'Welcome back! 1 carrot ripened while you were away.')
  assert.equal(welcomeBack(plots.slice(8), left, now, grow), null)
  assert.equal(welcomeBack([], left, now, grow), null)
})

test('dogName is deterministic and from the list', () => {
  assert.equal(dogName(42), dogName(42))
  assert.ok(new Set(Array.from({ length: 20 }, (_, i) => dogName(i))).size > 3)
})

function fakeEl() {
  const classes = new Set<string>()
  const handlers = new Map<string, Set<(e: Event) => void>>()
  const el = {
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c) },
    addEventListener: (t: string, fn: (e: Event) => void) => (handlers.get(t) ?? handlers.set(t, new Set()).get(t)!).add(fn),
    removeEventListener: (t: string, fn: (e: Event) => void) => handlers.get(t)?.delete(fn),
    fire: (t: string, target?: object): void => [...(handlers.get(t) ?? [])].forEach((fn) => fn({ target: target ?? el } as unknown as Event)),
    listeners: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
  }
  return { el, classes }
}

test('once adds the class, ignores bubbled ends, and removes it on its own end', async () => {
  const { el, classes } = fakeEl()
  let done = false
  const p = once(el as unknown as Element, 'pop').then(() => (done = true))
  assert.ok(classes.has('pop'))
  assert.equal(await once(el as unknown as Element, 'pop'), undefined, 'a second call while running resolves at once')

  el.fire('animationend', {})
  await Promise.resolve()
  assert.ok(classes.has('pop') && !done, 'a child animation ending does not count')

  el.fire('animationend')
  await p
  assert.ok(!classes.has('pop') && done)
  assert.equal(el.listeners(), 0, 'listeners are cleaned up')
})

test('once also settles on animationcancel', async () => {
  const { el, classes } = fakeEl()
  const p = once(el as unknown as Element, 'rustle')
  el.fire('animationcancel')
  await p
  assert.ok(!classes.has('rustle'))
})
