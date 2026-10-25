// Pocket Farm game rules: item tables and a pure reducer over a plain state value. No DOM, no clock, no Math.random:
// time, terrain and randomness come in through Ctx so every rule is testable.

export type Tag = 'crop' | 'seed' | 'fish' | 'fruit' | 'material' | 'food' | 'placeable'
type Entry = { name: string; price: number; tags: readonly Tag[]; grows?: string }

export const ITEMS = {
  carrot: { name: 'Carrot', price: 15, tags: ['crop'] },
  turnip: { name: 'Turnip', price: 25, tags: ['crop'] },
  wheat: { name: 'Wheat', price: 10, tags: ['crop'] },
  carrot_seed: { name: 'Carrot seeds', price: 2, tags: ['seed'], grows: 'carrot' },
  turnip_seed: { name: 'Turnip seeds', price: 4, tags: ['seed'], grows: 'turnip' },
  wheat_seed: { name: 'Wheat seeds', price: 1, tags: ['seed'], grows: 'wheat' },
  minnow: { name: 'Minnow', price: 8, tags: ['fish'] },
  carp: { name: 'Carp', price: 20, tags: ['fish'] },
  koi: { name: 'Koi', price: 45, tags: ['fish'] },
  golden_koi: { name: 'Golden koi', price: 250, tags: ['fish'] },
  cherry: { name: 'Cherry', price: 12, tags: ['fruit'] },
  orange: { name: 'Orange', price: 14, tags: ['fruit'] },
  wood: { name: 'Wood', price: 4, tags: ['material'] },
  stone: { name: 'Stone', price: 4, tags: ['material'] },
  bread: { name: 'Bread', price: 30, tags: ['food'] },
  fish_stew: { name: 'Fish stew', price: 70, tags: ['food'] },
  fruit_tart: { name: 'Fruit tart', price: 40, tags: ['food'] },
  fence: { name: 'Fence', price: 6, tags: ['placeable'] },
  scarecrow: { name: 'Scarecrow', price: 18, tags: ['placeable'] },
  lantern: { name: 'Lantern', price: 12, tags: ['placeable'] },
  sprinkler: { name: 'Sprinkler', price: 25, tags: ['placeable'] },
} as const satisfies Record<string, Entry>

export type ItemId = keyof typeof ITEMS
type WithTag<T extends Tag> = { [K in ItemId]: T extends (typeof ITEMS)[K]['tags'][number] ? K : never }[ItemId]
export type SeedId = WithTag<'seed'>
export type CropId = WithTag<'crop'>
export type FishId = WithTag<'fish'>
export type PlaceableId = WithTag<'placeable'>

export const IDS = Object.keys(ITEMS) as ItemId[]
export const isItem = (v: unknown): v is ItemId => typeof v === 'string' && Object.hasOwn(ITEMS, v)
export const has = (id: ItemId, tag: Tag) => (ITEMS[id].tags as readonly Tag[]).includes(tag)
const tagged = <T extends ItemId>(tag: Tag) => IDS.filter((id) => has(id, tag)) as T[]
export const SEEDS = tagged<SeedId>('seed')
export const PLACEABLES = tagged<PlaceableId>('placeable')
export const grows = (seed: SeedId) => ITEMS[seed].grows as CropId

export type Pond = 'home' | 'wild'
// Weights per pond. The golden koi only bites in the wild.
export const FISH: Record<Pond, readonly (readonly [FishId, number])[]> = {
  home: [['minnow', 60], ['carp', 30], ['koi', 10]],
  wild: [['minnow', 40], ['carp', 35], ['koi', 20], ['golden_koi', 5]],
}

// `r` in [0, 1) picks an entry with probability proportional to its weight.
export function weighted<T>(table: readonly (readonly [T, number])[], r: number): T {
  let left = r * table.reduce((sum, [, w]) => sum + w, 0)
  for (const [v, w] of table) if ((left -= w) < 0) return v
  return table[table.length - 1][0]
}

// An ingredient is a specific item or any item with a tag.
export type Ingredient = { n: number } & ({ item: ItemId } | { tag: Tag })
export const RECIPES = {
  bread: [{ item: 'wheat', n: 2 }],
  fish_stew: [{ tag: 'fish', n: 1 }, { item: 'carrot', n: 1 }, { item: 'turnip', n: 1 }],
  fruit_tart: [{ tag: 'fruit', n: 1 }, { item: 'wheat', n: 1 }],
  fence: [{ item: 'wood', n: 1 }],
  scarecrow: [{ item: 'wood', n: 2 }, { item: 'wheat', n: 1 }],
  lantern: [{ item: 'stone', n: 1 }, { item: 'wood', n: 1 }],
  sprinkler: [{ item: 'stone', n: 2 }, { item: 'wood', n: 2 }],
} as const satisfies Partial<Record<ItemId, readonly Ingredient[]>>
export type RecipeId = keyof typeof RECIPES

// Seed prices. Each costs more than it sells for.
export const SHOP: Record<SeedId, number> = { carrot_seed: 6, turnip_seed: 10, wheat_seed: 4 }
export const CHEAPEST_SEED = Math.min(...Object.values(SHOP))
export const POUCH: Partial<Record<SeedId, number>> = { carrot_seed: 2, turnip_seed: 2, wheat_seed: 2 }

// Trees and rocks: what each gives and the verb Space uses. They share one cooldown map.
export const SOURCES = {
  T: { act: 'shake', item: 'wood' },
  K: { act: 'shake', item: 'cherry' },
  O: { act: 'shake', item: 'orange' },
  r: { act: 'mine', item: 'stone' },
} as const satisfies Record<string, { act: 'shake' | 'mine'; item: ItemId }>

export const GROW_MS = 4000
export const COOLDOWN_MS = 30_000
export const BITE_MS = 1200
export const WAIT_MS = [1500, 4500] as const
export const DAY_MS = 86_400_000

export type Order = { item: ItemId; qty: number; bonus: number }
const ORDERABLE = IDS.filter((id) => id !== 'golden_koi' && ['crop', 'fish', 'fruit', 'food'].some((t) => has(id, t as Tag)))

function mix(n: number) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

// Order number n is always the same request, so the three on the board are just their numbers.
export function order(n: number): Order {
  const h = mix(n)
  const item = ORDERABLE[h % ORDERABLE.length]
  const qty = 1 + ((h >>> 8) % 3)
  return { item, qty, bonus: 5 * qty + ((h >>> 12) % 4) * 5 }
}

export type Key = `${number},${number}`
export const key = (x: number, y: number): Key => `${x},${y}`
export type Plot = { crop: CropId; at: number }
export type Line = { pond: Pond; biteAt: number }
export type State = {
  inv: Map<ItemId, number>
  coins: number
  plots: Map<Key, Plot>
  // When each tree or rock was last shaken or mined. Only cells still cooling down are kept.
  cooldowns: Map<Key, number>
  placed: Map<Key, PlaceableId>
  // Only the cast is stored. Whether a fish is biting is derived from the clock by `fishing`.
  line: Line | null
  // Day number (now / DAY_MS) of the last free pouch.
  pouchDay: number
  journal: Set<ItemId>
  // The three order numbers on the board; see `order`.
  orders: number[]
}

export type Ctx = {
  now: number
  terrain: (x: number, y: number) => string
  // True for a cell of the home patch, so its pond counts as the home pond.
  home: (x: number, y: number) => boolean
  // Uniform in [0, 1). Math.random in the game.
  rand: () => number
}

export function fresh(): State {
  const inv = new Map<ItemId, number>([['carrot_seed', 3], ['turnip_seed', 3], ['wheat_seed', 3]])
  return {
    inv,
    coins: 10,
    plots: new Map(),
    cooldowns: new Map(),
    placed: new Map(),
    line: null,
    pouchDay: -1,
    journal: new Set(inv.keys()),
    orders: [0, 1, 2],
  }
}

export const count = (s: State, id: ItemId) => s.inv.get(id) ?? 0
export const day = (now: number) => Math.floor(now / DAY_MS)
const SOIL = '."*,b'
const WATER = '~k'

// Sprinklers water the eight cells around them, so crops there grow twice as fast. They do not stack.
export function growMultiplier(x: number, y: number, placed: ReadonlyMap<Key, PlaceableId>) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (placed.get(key(x + dx, y + dy)) === 'sprinkler') return 2
  return 1
}

// 1 seed, 2 sprout, 3 ripe, as in farm.ts. `mult` scales the time grown, so a sprinkler placed later speeds a crop up at once.
export const stage = (p: Plot, now: number, mult = 1) => 1 + Math.min(2, Math.max(0, Math.floor(((now - p.at) * mult) / GROW_MS)))

export type Fishing = { kind: 'idle' } | { kind: 'waiting'; biteAt: number; pond: Pond } | { kind: 'bite'; until: number; pond: Pond }
export function fishing(s: State, now: number): Fishing {
  const l = s.line
  if (!l || now > l.biteAt + BITE_MS) return { kind: 'idle' }
  if (now < l.biteAt) return { kind: 'waiting', biteAt: l.biteAt, pond: l.pond }
  return { kind: 'bite', until: l.biteAt + BITE_MS, pond: l.pond }
}

// Seedless and too poor to buy any: the pouch is free again whatever the day, so the farm can never stall.
export const stuck = (s: State) => SEEDS.every((id) => !count(s, id)) && s.coins < CHEAPEST_SEED
export const claimable = (s: State, now: number) => day(now) > s.pouchDay || stuck(s)

// Which items a craft would use, or null when the inventory falls short. A tag takes the cheapest matching items first.
export function ingredients(inv: ReadonlyMap<ItemId, number>, recipe: RecipeId): Map<ItemId, number> | null {
  const use = new Map<ItemId, number>()
  for (const ing of RECIPES[recipe] as readonly Ingredient[]) {
    const pool = 'item' in ing ? [ing.item] : IDS.filter((id) => has(id, ing.tag)).sort((a, b) => ITEMS[a].price - ITEMS[b].price)
    let need = ing.n
    for (const id of pool) {
      const k = Math.min(need, (inv.get(id) ?? 0) - (use.get(id) ?? 0))
      if (k > 0) use.set(id, (use.get(id) ?? 0) + k)
      need -= Math.max(0, k)
    }
    if (need > 0) return null
  }
  return use
}

type At = { x: number; y: number }
export type Action =
  | ({ type: 'plant'; seed: SeedId } & At)
  | ({ type: 'harvest' | 'cast' | 'shake' | 'mine' } & At)
  | { type: 'reel' }
  | { type: 'craft'; recipe: RecipeId }
  | ({ type: 'place'; item: PlaceableId } & At)
  | { type: 'sell'; item: ItemId; n?: number }
  | { type: 'buy'; item: SeedId; n?: number }
  | { type: 'fulfil'; slot: number }
  | { type: 'pouch' }
export type Verb = Action['type']

// A refused action returns the same state object, so callers can skip saving and rendering.
export type Outcome = { state: State; ok: boolean; note: string }

const name = (id: ItemId) => ITEMS[id].name.toLowerCase()
const no = (state: State, note: string): Outcome => ({ state, ok: false, note })
function gain(s: State, id: ItemId, n: number) {
  s.inv.set(id, count(s, id) + n)
  s.journal.add(id)
}
function take(s: State, id: ItemId, n: number) {
  const left = count(s, id) - n
  if (left > 0) s.inv.set(id, left)
  else s.inv.delete(id)
}
const free = (s: State, x: number, y: number, ctx: Ctx) =>
  SOIL.includes(ctx.terrain(x, y)) && !s.plots.has(key(x, y)) && !s.placed.has(key(x, y))

// Each handler gets a private copy of the state to change. It returns a note on success or `no(...)` to refuse.
type Handler<A> = (s: State, a: A, ctx: Ctx, state: State) => string | Outcome
const HANDLERS: { [V in Verb]: Handler<Extract<Action, { type: V }>> } = {
  plant(s, { x, y, seed }, ctx, state) {
    if (!free(s, x, y, ctx)) return no(state, 'Nothing can be planted here')
    if (!count(s, seed)) return no(state, `No ${name(seed)} left`)
    take(s, seed, 1)
    s.plots.set(key(x, y), { crop: grows(seed), at: ctx.now })
    return `Planted ${name(grows(seed))}`
  },
  harvest(s, { x, y }, ctx, state) {
    const p = s.plots.get(key(x, y))
    if (!p || stage(p, ctx.now, growMultiplier(x, y, s.placed)) < 3) return no(state, 'Not ripe yet')
    s.plots.delete(key(x, y))
    gain(s, p.crop, 1)
    return `Picked a ${name(p.crop)}`
  },
  cast(s, { x, y }, ctx, state) {
    if (!WATER.includes(ctx.terrain(x, y))) return no(state, 'Cast into a pond')
    if (fishing(s, ctx.now).kind !== 'idle') return no(state, 'The line is already out')
    s.line = { pond: ctx.home(x, y) ? 'home' : 'wild', biteAt: ctx.now + WAIT_MS[0] + ctx.rand() * (WAIT_MS[1] - WAIT_MS[0]) }
    return 'Line cast'
  },
  reel(s, _, ctx, state) {
    if (!s.line) return no(state, 'No line out')
    const f = fishing(s, ctx.now)
    s.line = null
    if (f.kind === 'waiting') return 'Reeled in too soon'
    if (f.kind === 'idle') return 'It got away'
    const fish = weighted(FISH[f.pond], ctx.rand())
    gain(s, fish, 1)
    return `Caught a ${name(fish)}`
  },
  shake: gather,
  mine: gather,
  craft(s, { recipe }, _, state) {
    const use = ingredients(s.inv, recipe)
    if (!use) return no(state, `Missing what ${name(recipe)} needs`)
    for (const [id, n] of use) take(s, id, n)
    gain(s, recipe, 1)
    return `Made ${name(recipe)}`
  },
  place(s, { x, y, item }, ctx, state) {
    if (!count(s, item)) return no(state, `No ${name(item)} to place`)
    if (!free(s, x, y, ctx)) return no(state, 'No room here')
    take(s, item, 1)
    s.placed.set(key(x, y), item)
    return `Placed ${name(item)}`
  },
  sell(s, { item, n = 1 }, _, state) {
    if (!(n > 0) || count(s, item) < n) return no(state, `Not enough ${name(item)}`)
    take(s, item, n)
    s.coins += ITEMS[item].price * n
    return `Sold ${n} ${name(item)} for ${ITEMS[item].price * n} coins`
  },
  buy(s, { item, n = 1 }, _, state) {
    if (!(n > 0) || s.coins < SHOP[item] * n) return no(state, 'Not enough coins')
    s.coins -= SHOP[item] * n
    gain(s, item, n)
    return `Bought ${n} ${name(item)}`
  },
  fulfil(s, { slot }, _, state) {
    if (!(slot in s.orders)) return no(state, 'No such order')
    const o = order(s.orders[slot])
    if (count(s, o.item) < o.qty) return no(state, `Need ${o.qty} ${name(o.item)}`)
    take(s, o.item, o.qty)
    const paid = ITEMS[o.item].price * o.qty + o.bonus
    s.coins += paid
    s.orders[slot] = Math.max(...s.orders) + 1
    return `Order done: ${paid} coins`
  },
  pouch(s, _, ctx, state) {
    if (!claimable(s, ctx.now)) return no(state, 'The pouch refills tomorrow')
    for (const [id, n] of Object.entries(POUCH) as [SeedId, number][]) gain(s, id, n)
    s.pouchDay = day(ctx.now)
    return 'Opened the seed pouch'
  },
}

function gather(s: State, { type, x, y }: { type: 'shake' | 'mine' } & At, ctx: Ctx, state: State) {
  const src = SOURCES[ctx.terrain(x, y) as keyof typeof SOURCES]
  if (src?.act !== type) return no(state, type === 'shake' ? 'Not a tree' : 'Not a rock')
  for (const [k, t] of s.cooldowns) if (ctx.now - t >= COOLDOWN_MS) s.cooldowns.delete(k)
  if (s.cooldowns.has(key(x, y))) return no(state, 'Nothing more for now')
  s.cooldowns.set(key(x, y), ctx.now)
  gain(s, src.item, 1)
  return `Got ${name(src.item)}`
}

export function act(state: State, a: Action, ctx: Ctx): Outcome {
  const s = structuredClone(state)
  const r = (HANDLERS[a.type] as Handler<Action>)(s, a, ctx, state)
  return typeof r === 'string' ? { state: s, ok: true, note: r } : r
}

type SpaceVerb = 'reel' | 'harvest' | 'plant' | 'cast' | 'shake' | 'mine'
type Rule = readonly [SpaceVerb, number]
const each = (chars: string, r: Rule) => Object.fromEntries([...chars].map((c) => [c, r]))
// What Space does. `here` is keyed by the farmer's own cell, `ahead` by the terrain she faces. The lower rank wins, so a
// biting fish beats a ripe crop, which beats the tree she faces, which beats sowing the grass she stands on.
// Keys missing from a table ('growing', 'placed', paths, stones) do nothing.
const SPACE: { here: Record<string, Rule>; ahead: Record<string, Rule> } = {
  here: { line: ['reel', 0], ripe: ['harvest', 1], ...each(SOIL, ['plant', 3]) },
  ahead: { ...Object.fromEntries(Object.entries(SOURCES).map(([c, src]) => [c, [src.act, 2]])), ...each(WATER, ['cast', 2]) },
}

function cellKey(s: State, { x, y }: At, now: number) {
  const p = s.plots.get(key(x, y))
  if (fishing(s, now).kind !== 'idle') return 'line'
  if (p) return stage(p, now, growMultiplier(x, y, s.placed)) === 3 ? 'ripe' : 'growing'
  return s.placed.has(key(x, y)) ? 'placed' : ''
}

// The action Space performs for a farmer on `here` facing `ahead`, or null when there is nothing to do.
export function space(s: State, here: At, ahead: At, seed: SeedId, ctx: Ctx): Action | null {
  const own = SPACE.here[cellKey(s, here, ctx.now) || ctx.terrain(here.x, here.y)]
  const front = SPACE.ahead[ctx.terrain(ahead.x, ahead.y)]
  const [verb, at] = !front || (own && own[1] < front[1]) ? [own?.[0], here] : [front[0], ahead]
  if (!verb) return null
  if (verb === 'reel') return { type: 'reel' }
  if (verb === 'plant') return { type: 'plant', seed, x: at.x, y: at.y }
  return { type: verb, x: at.x, y: at.y }
}

export function serialize(s: State): string {
  return JSON.stringify({
    inv: [...s.inv],
    coins: s.coins,
    plots: [...s.plots].map(([k, p]) => [k, p.crop, p.at]),
    cooldowns: [...s.cooldowns],
    placed: [...s.placed],
    pouchDay: s.pouchDay,
    journal: [...s.journal],
    orders: s.orders,
  })
}

const isKey = (v: unknown): v is Key => typeof v === 'string' && /^-?\d+,-?\d+$/.test(v)
const nat = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0
const rows = (v: unknown) => (Array.isArray(v) ? v.filter((e): e is unknown[] => Array.isArray(e)) : [])
const isA = <T extends ItemId>(tag: Tag) => (v: unknown): v is T => isItem(v) && has(v, tag)

// The trust boundary for saves: anything malformed is dropped entry by entry, and garbage yields a fresh farm.
// The fishing line is never saved. Timestamps from the future are pulled back to `now`.
export function parse(raw: unknown, now = Date.now()): State {
  const s = fresh()
  let d: unknown
  try {
    d = typeof raw === 'string' ? JSON.parse(raw) : null
  } catch {}
  if (!d || typeof d !== 'object') return s
  const o = d as Record<string, unknown>
  if (Array.isArray(o.inv)) s.inv = new Map(rows(o.inv).filter((e): e is [ItemId, number] => isItem(e[0]) && nat(e[1]) && e[1] > 0))
  if (nat(o.coins)) s.coins = o.coins
  for (const [k, crop, at] of rows(o.plots))
    if (isKey(k) && isA<CropId>('crop')(crop) && Number.isFinite(at)) s.plots.set(k, { crop, at: Math.min(at as number, now) })
  for (const [k, t] of rows(o.cooldowns))
    if (isKey(k) && Number.isFinite(t) && now - (t as number) < COOLDOWN_MS) s.cooldowns.set(k, Math.min(t as number, now))
  for (const [k, id] of rows(o.placed)) if (isKey(k) && isA<PlaceableId>('placeable')(id)) s.placed.set(k, id)
  if (Number.isSafeInteger(o.pouchDay) && (o.pouchDay as number) >= -1) s.pouchDay = Math.min(o.pouchDay as number, day(now))
  if (Array.isArray(o.journal)) s.journal = new Set(o.journal.filter(isItem))
  for (const id of s.inv.keys()) s.journal.add(id)
  if (Array.isArray(o.orders) && o.orders.length === 3 && o.orders.every(nat)) s.orders = o.orders
  return s
}
