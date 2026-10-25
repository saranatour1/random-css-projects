import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  act, claimable, COOLDOWN_MS, DAY_MS, fishing, fresh, GROW_MS, growMultiplier, key, order, parse, serialize, space,
  type Action, type Ctx, type ItemId, type State,
} from './items.ts'
import { ITEM_PAL, ITEM_SPRITES } from './item-sprites.ts'

// x→   0    1    2    3
const GRID = ['.~~T', '.~kK', ',..O', 'rb.b']
const terrain = (x: number, y: number) => GRID[y]?.[x] ?? '~'
// Cells off the grid are a wild pond.
const ctx = (now = 0, rand = 0): Ctx => ({ now, terrain, home: (x, y) => GRID[y]?.[x] !== undefined, rand: () => rand })
const farm = (items: [ItemId, number][], coins = 0): State => ({ ...fresh(), inv: new Map(items), coins })
const inv = (s: State) => Object.fromEntries(s.inv)

function ok(s: State, a: Action, c = ctx()) {
  const r = act(s, a, c)
  assert.ok(r.ok, `${a.type} should succeed: ${r.note}`)
  return r.state
}
function refused(s: State, a: Action, c = ctx()) {
  const r = act(s, a, c)
  assert.equal(r.ok, false, `${a.type} should be refused`)
  assert.equal(r.state, s, 'a refusal leaves the state untouched')
}

test('each recipe turns exactly its ingredients into the product', () => {
  const cases: [Action & { type: 'craft' }, [ItemId, number][]][] = [
    [{ type: 'craft', recipe: 'bread' }, [['wheat', 2]]],
    [{ type: 'craft', recipe: 'fish_stew' }, [['koi', 1], ['carrot', 1], ['turnip', 1]]],
    [{ type: 'craft', recipe: 'fruit_tart' }, [['orange', 1], ['wheat', 1]]],
    [{ type: 'craft', recipe: 'fruit_tart' }, [['cherry', 1], ['wheat', 1]]],
    [{ type: 'craft', recipe: 'fence' }, [['wood', 1]]],
    [{ type: 'craft', recipe: 'scarecrow' }, [['wood', 2], ['wheat', 1]]],
    [{ type: 'craft', recipe: 'lantern' }, [['stone', 1], ['wood', 1]]],
    [{ type: 'craft', recipe: 'sprinkler' }, [['stone', 2], ['wood', 2]]],
  ]
  for (const [a, items] of cases) {
    const s = ok(farm(items), a)
    assert.deepEqual(inv(s), { [a.recipe]: 1 }, a.recipe)
    assert.ok(s.journal.has(a.recipe), `${a.recipe} enters the journal`)
  }
})

test('crafting refuses wrong or missing ingredients', () => {
  refused(farm([['wheat', 1]]), { type: 'craft', recipe: 'bread' })
  refused(farm([['cherry', 1], ['carrot', 1], ['turnip', 1]]), { type: 'craft', recipe: 'fish_stew' })
  refused(farm([['minnow', 1], ['wheat', 1]]), { type: 'craft', recipe: 'fruit_tart' })
  refused(farm([['stone', 1], ['wood', 2]]), { type: 'craft', recipe: 'sprinkler' })
})

test('"any fish" spends the cheapest fish and keeps the golden koi', () => {
  const s = ok(farm([['golden_koi', 1], ['minnow', 1], ['carrot', 1], ['turnip', 1]]), { type: 'craft', recipe: 'fish_stew' })
  assert.deepEqual(inv(s), { golden_koi: 1, fish_stew: 1 })
})

test('fishing: a reel inside the bite window catches, outside it costs nothing', () => {
  const start = farm([['wheat', 1]], 7)
  refused(start, { type: 'cast', x: 0, y: 0 })
  const cast = ok(start, { type: 'cast', x: 1, y: 0 }, ctx(0, 0))
  assert.equal(fishing(cast, 0).kind, 'waiting')
  refused(cast, { type: 'cast', x: 1, y: 0 }, ctx(10))
  const bite = fishing(cast, 2000)
  assert.equal(bite.kind, 'bite')

  const caught = ok(cast, { type: 'reel' }, ctx(2000, 0))
  assert.deepEqual(inv(caught), { wheat: 1, minnow: 1 })
  assert.equal(fishing(caught, 2000).kind, 'idle')

  for (const late of [500, 60_000]) {
    const missed = ok(cast, { type: 'reel' }, ctx(late, 0))
    assert.deepEqual(inv(missed), { wheat: 1 }, `reel at ${late}ms catches nothing`)
    assert.equal(missed.coins, 7, 'no penalty')
    assert.equal(missed.line, null, 'the line comes back in')
  }
  refused(fresh(), { type: 'reel' })
})

test('the golden koi bites only in a wild pond', () => {
  const catchAt = (x: number, y: number, rand: number) => {
    const cast = ok(fresh(), { type: 'cast', x, y }, ctx(0, 0))
    return [...ok(cast, { type: 'reel' }, ctx(2000, rand)).inv.keys()].find((id) => !id.endsWith('_seed'))
  }
  assert.equal(catchAt(1, 1, 0.999), 'koi')
  assert.equal(catchAt(9, 9, 0.999), 'golden_koi')
})

test('trees and rocks give once, then rest for the cooldown', () => {
  const s = ok(fresh(), { type: 'shake', x: 3, y: 1 }, ctx(1000))
  assert.equal(s.inv.get('cherry'), 1)
  refused(s, { type: 'shake', x: 3, y: 1 }, ctx(1000 + COOLDOWN_MS - 1))
  assert.equal(ok(s, { type: 'shake', x: 3, y: 1 }, ctx(1000 + COOLDOWN_MS)).inv.get('cherry'), 2)
  assert.equal(ok(s, { type: 'shake', x: 3, y: 2 }, ctx(1001)).inv.get('orange'), 1, 'another tree is not cooling')
  assert.equal(ok(fresh(), { type: 'shake', x: 3, y: 0 }).inv.get('wood'), 1)
  assert.equal(ok(fresh(), { type: 'mine', x: 0, y: 3 }).inv.get('stone'), 1)
  refused(fresh(), { type: 'shake', x: 0, y: 3 })
  refused(fresh(), { type: 'mine', x: 3, y: 0 })
})

test('selling pays the sell price, buying charges the shop price', () => {
  const sold = ok(farm([['carrot', 2]], 0), { type: 'sell', item: 'carrot', n: 2 })
  assert.equal(sold.coins, 30)
  assert.deepEqual(inv(sold), {})
  refused(farm([['carrot', 1]]), { type: 'sell', item: 'carrot', n: 2 })
  const bought = ok(farm([], 10), { type: 'buy', item: 'wheat_seed' })
  assert.equal(bought.coins, 6)
  assert.equal(bought.inv.get('wheat_seed'), 1)
  refused(farm([], 9), { type: 'buy', item: 'turnip_seed' })
})

test('orders are deterministic and pay price plus bonus, then rotate', () => {
  assert.deepEqual(order(41), order(41))
  const s = fresh()
  assert.equal(s.orders.length, 3)
  const o = order(s.orders[0])
  assert.ok(o.qty >= 1 && o.bonus > 0)
  refused(s, { type: 'fulfil', slot: 0 })
  refused(s, { type: 'fulfil', slot: 3 })
  const rich = { ...s, inv: new Map([[o.item, o.qty]]), coins: 0 }
  const done = ok(rich, { type: 'fulfil', slot: 0 })
  assert.equal(done.inv.get(o.item), undefined)
  assert.equal(done.coins, { carrot: 15, turnip: 25, wheat: 10, minnow: 8, carp: 20, koi: 45, cherry: 12, orange: 14, bread: 30, fish_stew: 70, fruit_tart: 40 }[o.item as string]! * o.qty + o.bonus)
  assert.deepEqual(done.orders, [3, 1, 2])
})

test('the seed pouch is daily, unless the farm is stuck', () => {
  const s = ok(farm([], 50), { type: 'pouch' }, ctx(5 * DAY_MS))
  assert.deepEqual(inv(s), { carrot_seed: 2, turnip_seed: 2, wheat_seed: 2 })
  refused(s, { type: 'pouch' }, ctx(5 * DAY_MS + 1000))
  ok(s, { type: 'pouch' }, ctx(6 * DAY_MS))

  const broke = { ...farm([['carrot', 1]], 3), pouchDay: 5 }
  assert.ok(claimable(broke, 5 * DAY_MS), 'no seeds and 3 coins: stuck, so claimable today')
  ok(broke, { type: 'pouch' }, ctx(5 * DAY_MS))
  assert.equal(claimable({ ...broke, coins: 4 }, 5 * DAY_MS), false, 'can afford wheat seeds')
  assert.equal(claimable({ ...broke, inv: new Map([['wheat_seed', 1]]) }, 5 * DAY_MS), false, 'still has a seed')
})

test('planting spends a seed, and a ripe crop is picked', () => {
  const s = ok(farm([['turnip_seed', 1]]), { type: 'plant', x: 0, y: 0, seed: 'turnip_seed' }, ctx(0))
  assert.deepEqual(inv(s), {})
  refused(s, { type: 'plant', x: 0, y: 0, seed: 'turnip_seed' })
  refused(farm([['turnip_seed', 1]]), { type: 'plant', x: 1, y: 0, seed: 'turnip_seed' })
  refused(s, { type: 'harvest', x: 0, y: 0 }, ctx(2 * GROW_MS - 1))
  assert.deepEqual(inv(ok(s, { type: 'harvest', x: 0, y: 0 }, ctx(2 * GROW_MS))), { turnip: 1 })
})

test('a sprinkler doubles growth within one cell', () => {
  const placed = ok(farm([['sprinkler', 1], ['carrot_seed', 2]]), { type: 'place', x: 1, y: 3, item: 'sprinkler' })
  refused(placed, { type: 'place', x: 1, y: 3, item: 'sprinkler' })
  assert.equal(growMultiplier(2, 2, placed.placed), 2, 'diagonal')
  assert.equal(growMultiplier(3, 3, placed.placed), 1, 'two cells away')
  let s = ok(placed, { type: 'plant', x: 2, y: 2, seed: 'carrot_seed' }, ctx(0))
  s = ok(s, { type: 'plant', x: 3, y: 3, seed: 'carrot_seed' }, ctx(0))
  assert.equal(ok(s, { type: 'harvest', x: 2, y: 2 }, ctx(GROW_MS)).inv.get('carrot'), 1)
  refused(s, { type: 'harvest', x: 3, y: 3 }, ctx(GROW_MS))
})

test('Space picks the action from the cell and what the farmer faces', () => {
  const s = fresh()
  const seed = 'wheat_seed'
  assert.deepEqual(space(s, { x: 2, y: 0 }, { x: 3, y: 0 }, seed, ctx()), { type: 'shake', x: 3, y: 0 })
  assert.deepEqual(space(s, { x: 0, y: 2 }, { x: 0, y: 3 }, seed, ctx()), { type: 'mine', x: 0, y: 3 })
  assert.deepEqual(space(s, { x: 0, y: 0 }, { x: 1, y: 0 }, seed, ctx()), { type: 'cast', x: 1, y: 0 })
  assert.deepEqual(space(s, { x: 0, y: 2 }, { x: 1, y: 2 }, seed, ctx()), { type: 'plant', seed, x: 0, y: 2 })
  const ripe = { ...s, plots: new Map([[key(2, 0), { crop: 'wheat' as const, at: 0 }]]) }
  assert.deepEqual(space(ripe, { x: 2, y: 0 }, { x: 3, y: 0 }, seed, ctx(1e6)), { type: 'harvest', x: 2, y: 0 })
  assert.equal(space(ripe, { x: 2, y: 0 }, { x: 2, y: 2 }, seed, ctx(1)), null, 'a growing crop with nothing ahead')
  const line = ok(s, { type: 'cast', x: 1, y: 0 })
  assert.deepEqual(space(line, { x: 2, y: 0 }, { x: 3, y: 0 }, seed, ctx(100)), { type: 'reel' })
})

test('saves round-trip, and parse drops malformed entries', () => {
  let s = ok(farm([['sprinkler', 1], ['wheat_seed', 1]], 12), { type: 'place', x: 1, y: 3, item: 'sprinkler' })
  s = ok(s, { type: 'plant', x: 2, y: 2, seed: 'wheat_seed' }, ctx(50))
  s = ok(s, { type: 'shake', x: 3, y: 0 }, ctx(60))
  assert.deepEqual(parse(serialize(s), 100), { ...s, line: null })

  for (const junk of [null, 42, '', '{', '"x"', '[]']) assert.deepEqual(parse(junk, 0), fresh())
  const bad = parse(JSON.stringify({
    inv: [['carrot', 2], ['bogus', 1], ['wheat', -1], ['koi', 1.5], 'x', ['__proto__', 1]],
    coins: -5,
    plots: [['1,2', 'carrot', 100], ['a,b', 'carrot', 1], ['3,3', 'wood', 1], ['4,4', 'turnip', 1e15], ['5,5', 'turnip']],
    cooldowns: [['3,0', 90], ['3,1', -1e9], ['x', 1]],
    placed: [['1,1', 'sprinkler'], ['2,2', 'carrot']],
    pouchDay: 'yesterday',
    journal: ['koi', 7, 'nope'],
    orders: [1, 2],
  }), 1000)
  assert.deepEqual(inv(bad), { carrot: 2 })
  assert.equal(bad.coins, fresh().coins)
  assert.deepEqual([...bad.plots], [['1,2', { crop: 'carrot', at: 100 }], ['4,4', { crop: 'turnip', at: 1000 }]])
  assert.deepEqual([...bad.cooldowns], [['3,0', 90]])
  assert.deepEqual([...bad.placed], [['1,1', 'sprinkler']])
  assert.equal(bad.pouchDay, -1)
  assert.deepEqual([...bad.journal].sort(), ['carrot', 'koi'])
  assert.deepEqual(bad.orders, [0, 1, 2])
})

test('every item sprite is 12x12 and drawn only in palette colors', () => {
  for (const [id, rows] of Object.entries(ITEM_SPRITES)) {
    assert.equal(rows.length, 12, `${id} height`)
    rows.forEach((r, y) => {
      assert.equal(r.length, 12, `${id} row ${y} "${r}"`)
      for (const c of r) assert.ok(c === '.' || c in ITEM_PAL, `${id} char "${c}"`)
    })
  }
})
