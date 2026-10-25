// Small pure helpers for cozy touches. No imports, so tests run under plain node.

// Adds a one-shot animation class and removes it when the animation ends or is cancelled, so idle is animation free.
// Resolves at once, without the class, when reduced motion is on or the class is already running.
export function once(el: Element, className: string): Promise<void> {
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || el.classList.contains(className))
    return Promise.resolve()
  return new Promise((done) => {
    const end = (e: Event) => {
      if (e.target !== el) return
      el.removeEventListener('animationend', end)
      el.removeEventListener('animationcancel', end)
      el.classList.remove(className)
      done()
    }
    el.addEventListener('animationend', end)
    el.addEventListener('animationcancel', end)
    el.classList.add(className)
  })
}

// Matches farm.ts: stage = 1 + min(2, floor(age / GROW_MS)), and stage 3 is ripe.
const RIPE_STEPS = 2
const CROPS: [string, string][] = [
  ['carrot', 'carrots'],
  ['turnip', 'turnips'],
  ['wheat', 'wheat'],
]

// Names the crops that were not ripe at `leftAt` but are by `now`. Null when nothing ripened.
export function welcomeBack(
  plots: readonly { crop: 0 | 1 | 2; at: number }[],
  leftAt: number,
  now: number,
  growMs: number,
): string | null {
  const counts = [0, 0, 0]
  for (const { crop, at } of plots) {
    const ripe = at + RIPE_STEPS * growMs
    if (ripe > leftAt && ripe <= now) counts[crop]++
  }
  const parts = counts.flatMap((n, c) => (n ? [`${n} ${CROPS[c][n === 1 ? 0 : 1]}`] : []))
  if (!parts.length) return null
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]
  return `Welcome back! ${list} ripened while you were away.`
}

const DOGS = ['Biscuit', 'Mochi', 'Pumpkin', 'Waffles', 'Peanut', 'Clover', 'Noodle', 'Maple', 'Dumpling', 'Toffee']

// Same seed, same name; the multiply spreads nearby seeds across the list.
export const dogName = (seed: number) => DOGS[(Math.imul(seed | 0, 0x9e3779b1) >>> 0) % DOGS.length]
