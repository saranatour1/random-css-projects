import { CX, CY, FARMER, HOUSE, LEGEND, MAP, MW, SOIL, SOLID, UPRIGHT, VH, VW, rim, terrain } from './map'
import {
  GROW_MS, ITEMS, PLACEABLES, SEEDS, SHOP, act, claimable, count, fishing, growMultiplier, ingredients, key, order, parse,
  serialize, space, stage, type Action, type Ctx, type ItemId, type RecipeId, type SeedId, type State,
} from './items'
import { dogName, once, welcomeBack } from './cozy'
import { startClock } from './daytime'
import { isMuted, play, setMuted, type Cue } from './sound'

const KEY = 'pocket-farm-3'
const OLD = 'pocket-farm-2'
const STEP_MS = 140
// How far, in cells each way, a tap or the Home button searches for a path.
const REACH = 20
const MC = (MW - 1) / 2
// Version 2 saves stored crops as these indexes.
const CROP_IDS = ['carrot', 'turnip', 'wheat'] as const
const STAGES = ['', 'seed', 'sprout', 'ripe']
const CUES: Record<Action['type'], Cue> = {
  plant: 'pluck', harvest: 'pluck', cast: 'splash', reel: 'reel', shake: 'pluck', mine: 'pluck',
  craft: 'chime', place: 'pluck', sell: 'coin', buy: 'coin', fulfil: 'coin', pouch: 'chime',
}
// The panel tab Space opens when the farmer faces a home stall.
const DESKS: Record<string, string> = { X: 'bag', P: 'shop', B: 'orders' }

// Clockwise from up, so a screen direction maps to a board step by subtracting the quarter turns.
const KEYS: Record<string, number> = { ArrowUp: 0, w: 0, ArrowRight: 1, d: 1, ArrowDown: 2, s: 2, ArrowLeft: 3, a: 3 }
const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const

type At = { x: number; y: number }
const farmer = { x: FARMER[0], y: FARMER[1] }
// The board step she last took or tried, so Space knows the cell she faces.
let facing = { x: 0, y: 1 }
let seed = 0
let tool = 0
let placing = false
let turn = 0
let ambience = true
// First visit, so the dog keeps its name.
let born = Date.now()
// The pond cell the line is cast into, while it is out.
let bob: At | null = null

const main = document.querySelector<HTMLElement>('main')!
const board = main.querySelector<HTMLElement>('.board')!
const world = board.querySelector<HTMLElement>('.world')!
const ground = [...world.querySelectorAll<HTMLElement>('.ground i')]
const slots = [...world.querySelectorAll<HTMLElement>(':scope > .u')]
const house = world.querySelector<HTMLElement>('.house')!
const farmerEl = document.querySelector<HTMLElement>('#farmer')!
const dogEl = document.querySelector<HTMLElement>('#dog')!
const seedEls = [...document.querySelectorAll<HTMLElement>('[data-seed]')]
const toolEl = document.querySelector<HTMLElement>('#tool')!
const bagEl = document.querySelector<HTMLElement>('#bag')!
const coinsEl = document.querySelector('.coins b')!
const say = document.querySelector('#say')!
const said = document.querySelector('#said')!
const mini = [...document.querySelectorAll<HTMLElement>('.mini i')]
const pin = document.querySelector<HTMLElement>('.pin')!
const away = document.querySelector('#home span')!
const help = document.querySelector<HTMLDialogElement>('#help')!
const panel = document.querySelector<HTMLDialogElement>('#panel')!
const muteEl = document.querySelector<HTMLElement>('#mute')!
const petalEl = document.querySelector<HTMLElement>('#petal')!
const root = document.documentElement
const still = matchMedia('(prefers-reduced-motion: reduce)')
// Pool element to window index, for hit testing taps and drags.
const cell = new Map<Element, number>([...ground.entries(), ...slots.entries()].map(([k, el]) => [el, k]))

const ctx = (): Ctx => ({ now: Date.now(), terrain, home: (x, y) => MAP[y]?.[x] !== undefined, rand: Math.random })
const open = (x: number, y: number) => !SOLID.includes(terrain(x, y)) && !state.placed.has(key(x, y))
const speak = (text: string) => ((panel.open ? said : say).textContent = text)
const lower = (id: ItemId) => ITEMS[id].name.toLowerCase()
const thing = (x: number, y: number) => {
  const q = state.placed.get(key(x, y))
  return q ? ITEMS[q].name : LEGEND[terrain(x, y)]
}
const slotAt = (x: number, y: number) => slots[(y - farmer.y + CY) * VW + x - farmer.x + CX]
const int = (v: unknown): v is number => Number.isInteger(v)

function where(x: number, y: number) {
  const dx = x - FARMER[0]
  const dy = y - FARMER[1]
  const parts = [dx && `${Math.abs(dx)} ${dx > 0 ? 'east' : 'west'}`, dy && `${Math.abs(dy)} ${dy > 0 ? 'south' : 'north'}`]
  const away = parts.filter(Boolean).join(' ')
  return away ? `${away} of home` : 'home'
}

function describe(x: number, y: number) {
  const p = state.plots.get(key(x, y))
  const what = p ? `${ITEMS[p.crop].name}: ${STAGES[stage(p, Date.now(), growMultiplier(x, y, state.placed))]}` : thing(x, y)
  return `${what}, ${where(x, y)}`
}

// Saves are parsed by items.ts, the trust boundary. A version 2 save is rewritten into version 3's shape first:
// its numeric crops become crop ids and its basket joins the starter seeds.
let d: any = null
let raw: string | null = null
try {
  raw = localStorage.getItem(KEY)
  d = JSON.parse(raw ?? localStorage.getItem(OLD) ?? 'null')
  if (!raw && d) {
    const rows = (v: unknown) => (Array.isArray(v) ? v.filter(Array.isArray) : [])
    const plots = rows(d.p).map(([x, y, c, at]) => [key(x, y), CROP_IDS[c], at])
    const inv = [...SEEDS.map((id) => [id, 3]), ...rows([d.b]).flatMap((b) => CROP_IDS.map((id, i) => [id, b[i]]))]
    raw = JSON.stringify({ plots, inv })
  }
} catch {}
let state: State = parse(raw)
// The map can change under a save, so anything no longer on soil is dropped.
for (const k of [...state.plots.keys(), ...state.placed.keys()]) {
  const [x, y] = k.split(',').map(Number)
  if (!SOIL.includes(terrain(x, y))) state.plots.delete(k), state.placed.delete(k)
}
if (d) {
  const [x, y] = Array.isArray(d.f) ? d.f : []
  if (int(x) && int(y) && open(x, y)) Object.assign(farmer, { x, y })
  if ([0, 1, 2].includes(d.s)) seed = d.s
  turn = d.t | 0
  if (Number.isFinite(d.n)) born = d.n
  if (d.a === 0) ambience = false
}
const back = Number.isFinite(d?.w)
  ? welcomeBack([...state.plots.values()].map((p) => ({ crop: CROP_IDS.indexOf(p.crop) as 0 | 1 | 2, at: p.at })), d.w, Date.now(), GROW_MS)
  : null

let saving: ReturnType<typeof setTimeout> | 0 = 0
function flush() {
  clearTimeout(saving)
  saving = 0
  try {
    const extra = { f: [farmer.x, farmer.y], t: turn, s: seed, n: born, a: +ambience, w: Date.now() }
    localStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(serialize(state)), ...extra }))
  } catch {}
}
// At most one write a second; leaving the page writes whatever is pending.
const save = () => (saving ||= setTimeout(flush, 1000))
addEventListener('pagehide', flush)

function attr(el: Element, name: string, v: string | null) {
  if (el.getAttribute(name) === v) return
  if (v === null) el.removeAttribute(name)
  else el.setAttribute(name, v)
}

let timer = 0

// Repaint the fixed pool for the camera on the farmer: the DOM is the same size wherever she roams.
function render() {
  const now = Date.now()
  const fish = fishing(state, now).kind === 'bite' ? 'bite' : 'bob'
  let next = Infinity
  ground.forEach((g, k) => {
    const x = farmer.x + (k % VW) - CX
    const y = farmer.y + Math.floor(k / VW) - CY
    const m = terrain(x, y)
    const p = state.plots.get(key(x, y))
    const q = state.placed.get(key(x, y))
    const mult = p ? growMultiplier(x, y, state.placed) : 1
    const s = p ? stage(p, now, mult) : 0
    if (p && s < 3) next = Math.min(next, p.at + (s * GROW_MS) / mult)
    attr(g, 'data-m', m)
    attr(g, 'data-e', m === '~' || m === 'k' ? rim(x, y) : null)
    attr(g, 'data-p', p ? '' : null)
    const u = bob?.x === x && bob.y === y ? fish : p ? p.crop[0] + s : q ? (q === 'fence' ? 'f' : q) : UPRIGHT.includes(m) ? m : null
    // A slot that now shows another cell drops any one-shot animation meant for the old one.
    if (slots[k].getAttribute('data-u') !== u) slots[k].classList.remove('pop', 'rustle')
    attr(slots[k], 'data-u', u)
  })
  const hx = HOUSE.x - farmer.x + CX
  const hy = HOUSE.y - farmer.y + CY
  house.hidden = hx + HOUSE.w <= 0 || hx >= VW || hy + HOUSE.h <= 0 || hy >= VH
  house.style.setProperty('--hx', String(hx))
  house.style.setProperty('--hy', String(hy))
  mini.forEach((m, k) => {
    const x = farmer.x + (k % MW) - MC
    const y = farmer.y + Math.floor(k / MW) - MC
    attr(m, 'data-k', state.plots.has(key(x, y)) ? 'p' : state.placed.has(key(x, y)) ? 'f' : terrain(x, y))
  })
  // Home is a pin when on the map, else an arrow on the map's rim pointing at it.
  const dx = FARMER[0] - farmer.x
  const dy = FARMER[1] - farmer.y
  const far = Math.max(Math.abs(dx), Math.abs(dy))
  const s = far > MC ? (MC - 1) / far : 1
  pin.hidden = !far
  attr(pin, 'data-far', far > MC ? '' : null)
  pin.style.setProperty('--px', String(MC + dx * s))
  pin.style.setProperty('--py', String(MC + dy * s))
  pin.style.setProperty('--pa', far > MC ? `${Math.atan2(dy, dx) + Math.PI / 2}rad` : '0rad')
  away.textContent = far > MC ? String(Math.abs(dx) + Math.abs(dy)) : ''
  // One timer, for the next stage change on screen. Plots out of view grow by the clock alone.
  clearTimeout(timer)
  timer = next < Infinity ? setTimeout(tick, next - now) : 0
}

function tick() {
  const before = describe(farmer.x, farmer.y)
  render()
  const after = describe(farmer.x, farmer.y)
  if (after !== before) speak(after)
}

function renderHud() {
  seedEls.forEach((b, i) => {
    b.ariaPressed = String(!placing && i === seed)
    b.nextElementSibling!.textContent = String(count(state, SEEDS[i]))
  })
  const item = PLACEABLES[tool]
  toolEl.ariaPressed = String(placing)
  toolEl.ariaLabel = `${ITEMS[item].name} (4)`
  toolEl.style.backgroundImage = `var(--i-${item})`
  toolEl.nextElementSibling!.textContent = String(count(state, item))
  coinsEl.textContent = String(state.coins)
  if (panel.open) renderPanel()
}

const near = (m: string) => STEPS.some(([dx, dy]) => terrain(farmer.x + dx, farmer.y + dy) === m)

// The panel's rows are fixed at build time; this only fills in counts and greys out what cannot be done.
function renderPanel() {
  const now = Date.now()
  panel.toggleAttribute('data-bin', near('X'))
  for (const li of panel.querySelectorAll<HTMLElement>('[data-item]')) {
    const n = count(state, li.dataset.item as ItemId)
    li.hidden = !n
    li.querySelector('b')!.textContent = String(n)
  }
  const btns = (k: string) => panel.querySelectorAll<HTMLButtonElement>(`[data-${k}]`)
  for (const b of btns('craft')) b.disabled = !ingredients(state.inv, b.dataset.craft as RecipeId)
  for (const b of btns('buy')) b.disabled = state.coins < SHOP[b.dataset.buy as SeedId]
  for (const b of btns('pouch')) b.disabled = !claimable(state, now)
  for (const b of btns('fulfil')) {
    const o = order(state.orders[Number(b.dataset.fulfil)])
    const li = b.parentElement!
    li.querySelector('i')!.style.backgroundImage = `var(--i-${o.item})`
    li.querySelector('span')!.textContent = `${o.qty} ${lower(o.item)}, pays ${ITEMS[o.item].price * o.qty + o.bonus}c`
    b.disabled = count(state, o.item) < o.qty
  }
  for (const li of panel.querySelectorAll<HTMLElement>('[data-j]')) li.toggleAttribute('data-found', state.journal.has(li.dataset.j as ItemId))
  panel.querySelector('[data-pane="journal"] b')!.textContent = String(state.journal.size)
}

function showTab(t: string) {
  for (const b of panel.querySelectorAll<HTMLElement>('[role="tab"]')) b.ariaSelected = String(b.dataset.tab === t)
  for (const p of panel.querySelectorAll<HTMLElement>('[data-pane]')) p.hidden = p.dataset.pane !== t
}

function openPanel(t: string) {
  showTab(t)
  said.textContent = ''
  renderPanel()
  if (!panel.open) panel.showModal()
}

// Every game change goes through the rules in items.ts. A refused action hands back the same state, so nothing is
// saved or redrawn for it. `quiet` keeps sowing by drag or Shift-walk off the announcer, as before.
function run(a: Action, quiet = false) {
  const before = state
  const r = act(state, a, ctx())
  if (!quiet) speak(r.note)
  if (r.state === before) return r
  state = r.state
  play(CUES[a.type])
  if (a.type === 'cast') bob = { x: a.x, y: a.y }
  if (!state.line) bob = null
  if (a.type === 'harvest' || a.type === 'shake' || a.type === 'mine' || a.type === 'reel')
    for (const [id, n] of state.inv) if (n > count(before, id)) fly(id)
  save()
  renderHud()
  // The crop pops before its slot empties.
  if (a.type === 'harvest') once(slotAt(a.x, a.y), 'pop').then(render)
  else render()
  if (a.type === 'cast' || a.type === 'reel') fish()
  return r
}

// A copy of the item's sprite flies from the farmer to its hotbar slot, or to the bag.
function fly(id: ItemId) {
  const from = farmerEl.getBoundingClientRect()
  const i = SEEDS.indexOf(id as SeedId)
  const to = (i >= 0 ? seedEls[i] : bagEl).getBoundingClientRect()
  const el = document.createElement('i')
  el.className = 'flyer'
  el.style.cssText = `left:${from.x + from.width / 2 - 16}px;top:${from.y}px;background-image:var(--i-${id});--fx:${to.x + to.width / 2 - from.x - from.width / 2}px;--fy:${to.y - from.y}px`
  document.body.append(el)
  once(el, 'fly').then(() => el.remove())
}

// While a line is out: one timer to the bite, then one to the end of the bite window, when the fish gets away.
let fishTimer = 0
function fish() {
  clearTimeout(fishTimer)
  const now = Date.now()
  const f = fishing(state, now)
  if (f.kind === 'idle') return void (state.line && run({ type: 'reel' }))
  if (f.kind === 'bite') {
    play('splash')
    speak('A bite! Press Space to reel in')
    render()
  }
  fishTimer = setTimeout(fish, (f.kind === 'bite' ? f.until + 1 : f.biteAt) - now)
}

function pet() {
  once(dogEl, 'hearts')
  play('bark')
  speak(`${dogName(born)} wags happily`)
}

// Space or a tap on her own cell. The rules pick from her cell and the one she faces; the page adds the stalls, placing
// and petting the dog, which only it knows about.
function use(ahead: At = { x: farmer.x + facing.x, y: farmer.y + facing.y }) {
  const a = space(state, farmer, ahead, SEEDS[seed], ctx())
  if (!a || a.type === 'plant') {
    const desk = DESKS[terrain(ahead.x, ahead.y)]
    if (desk) return openPanel(desk)
    if (placing && (ahead.x !== farmer.x || ahead.y !== farmer.y)) return void run({ type: 'place', item: PLACEABLES[tool], ...ahead })
    if (!a) return pet()
  }
  if (a.type === 'shake') once(slotAt(a.x, a.y), 'rustle')
  run(a)
}

function pickSeed(i: number) {
  seed = i
  placing = false
  renderHud()
  save()
  return `${ITEMS[SEEDS[i]].name}: ${count(state, SEEDS[i])} left`
}

// The fourth hotbar slot: picking it again moves on to the next placeable in the bag.
function pickTool() {
  const start = placing ? tool + 1 : tool
  const order = PLACEABLES.map((_, i) => (start + i) % PLACEABLES.length)
  tool = order.find((i) => count(state, PLACEABLES[i])) ?? order[0]
  placing = true
  renderHud()
  const item = PLACEABLES[tool]
  return `Placing ${lower(item)} in front of you: ${count(state, item)} in the bag`
}

// Movement input: screen directions held down (latest wins), one buffered tap shorter than a step, and a path of cells.
const held: number[] = []
let queued = -1
let path: At[] = []
// Where a tap asked her to act once she arrives: her goal cell, or the solid cell beside it.
let arrive: At | null = null
let moving = false
let sow = false
let ended = -Infinity
const clamp = (v: number) => Math.max(-1, Math.min(1, v))

// FLIP: the pool already shows the new camera, so the world starts one cell back and slides home. Steps only ever start
// when the last one ended, and a long jump (home from afar) slides a single cell.
function glide(dx: number, dy: number, more: boolean) {
  if (still.matches) return void setTimeout(next, STEP_MS)
  const from = `calc(${clamp(dx)} * var(--t)) calc(${clamp(dy)} * var(--t))`
  const slide = world.animate({ translate: [from, '0 0'] }, { duration: STEP_MS, easing: more ? 'linear' : 'ease-out' })
  // A chained step starts exactly when the last one ended, so a held key glides on without a stalled frame.
  if ((document.timeline.currentTime as number) - ended < 50) slide.startTime = ended
  slide.onfinish = () => {
    ended = (slide.startTime as number) + STEP_MS
    next()
  }
}

// Facing is in screen terms, so a board step is turned into its on-screen horizontal direction.
function face(el: HTMLElement, dx: number, dy: number) {
  const sx = [dx, -dy, -dx, dy][((turn % 4) + 4) % 4]
  if (sx) el.dataset.f = sx < 0 ? 'l' : 'r'
}

function turnTo(dx: number, dy: number) {
  if (Math.abs(dx) + Math.abs(dy) === 1) facing = { x: dx, y: dy }
  face(farmerEl, dx, dy)
}

function walk(dx: number, dy: number, more: boolean) {
  turnTo(dx, dy)
  face(dogEl, dx, dy)
  farmer.x += dx
  farmer.y += dy
  dogEl.style.setProperty('--dx', String(-Math.sign(dx)))
  dogEl.style.setProperty('--dy', String(-Math.sign(dy)))
  moving = true
  board.dataset.walking = ''
  render()
  glide(dx, dy, more)
  save()
}

// Runs when a step lands (and to start from rest): sow if asked, then take the next step or come to rest.
function next() {
  const here = { ...farmer }
  const sown = sow && run({ type: 'plant', seed: SEEDS[seed], ...here }, true).ok
  const a = held.at(-1) ?? queued
  queued = -1
  if (a >= 0) {
    path = []
    arrive = null
  }
  const [sx, sy] = STEPS[(((a - turn) % 4) + 4) % 4]
  const to = a >= 0 ? { x: here.x + sx, y: here.y + sy } : path.shift()
  if (to && open(to.x, to.y)) walk(to.x - here.x, to.y - here.y, held.length + path.length > 0)
  else {
    moving = false
    delete board.dataset.walking
    // A bump turns her to face what stopped her, so Space then uses it.
    if (to) turnTo(to.x - here.x, to.y - here.y)
    if (to && 'TKO'.includes(terrain(to.x, to.y))) once(slotAt(to.x, to.y), 'rustle')
    const t = arrive
    arrive = null
    // Only when she got there: a path cut short by a new obstacle acts on nothing.
    if (t && Math.abs(t.x - here.x) + Math.abs(t.y - here.y) <= 1) {
      turnTo(t.x - here.x, t.y - here.y)
      return use(t)
    }
    render()
    save()
    speak(to ? `Blocked by ${thing(to.x, to.y).toLowerCase()}` : describe(here.x, here.y))
  }
  if (sown) pop(here.x, here.y)
}

function pop(x: number, y: number) {
  if (!still.matches) slotAt(x, y)?.animate({ scale: [0, 1] }, { duration: 400, easing: 'cubic-bezier(0.3, 1.5, 0.5, 1)' })
}

function rotate(d: number) {
  turn += d
  // Uprights transition their counter-rotation only while turning, so a slot that changes kind mid-walk never swings.
  board.dataset.turning = ''
  main.style.setProperty('--r', String(turn))
  save()
}

board.addEventListener('transitionend', (e) => {
  if (e.target === board) delete board.dataset.turning
})

// Breadth-first search over open cells within REACH of the farmer; the path excludes her cell and ends on the goal,
// or, with `beside`, on the first open cell next to it.
function route(tx: number, ty: number, beside = false) {
  const S = 2 * REACH + 1
  const ox = farmer.x - REACH
  const oy = farmer.y - REACH
  if (Math.abs(tx - farmer.x) > REACH || Math.abs(ty - farmer.y) > REACH) return null
  const from = new Int32Array(S * S).fill(-1)
  const start = REACH * S + REACH
  const queue = [start]
  from[start] = start
  for (const c of queue) {
    const cx = c % S
    const cy = Math.floor(c / S)
    if (Math.abs(cx + ox - tx) + Math.abs(cy + oy - ty) === Number(beside)) {
      const out = []
      for (let k = c; k !== start; k = from[k]) out.push({ x: (k % S) + ox, y: Math.floor(k / S) + oy })
      return out.reverse()
    }
    for (const [dx, dy] of STEPS) {
      const n = (cy + dy) * S + cx + dx
      if (cx + dx < 0 || cy + dy < 0 || cx + dx >= S || cy + dy >= S || from[n] >= 0 || !open(cx + dx + ox, cy + dy + oy)) continue
      from[n] = c
      queue.push(n)
    }
  }
  return null
}

function go(steps: At[], then: At | null) {
  path = steps
  arrive = then
  if (!moving) next()
}

function home() {
  const [x, y] = FARMER
  if (farmer.x === x && farmer.y === y) return speak('Home')
  // Out of reach, she takes one long step: the camera jumps and slides the last cell.
  go(route(x, y) ?? [{ x, y }], null)
}

const dir = (e: KeyboardEvent) => KEYS[e.key.length > 1 ? e.key : e.key.toLowerCase()]

addEventListener('keydown', (e) => {
  sow = e.shiftKey
  if (e.ctrlKey || e.metaKey || e.altKey || help.open || panel.open) return
  const a = dir(e)
  if (a !== undefined) {
    e.preventDefault()
    // Holds are tracked here, so the OS key repeat and its initial delay play no part in the walking pace.
    if (e.repeat) return
    held.push(a)
    queued = a
    if (!moving) next()
    return
  }
  const k = e.key.toLowerCase()
  if ((k === ' ' || k === 'enter') && !(e.target as Element).closest?.('button')) {
    e.preventDefault()
    use()
  }
  if (k === 'q' || k === 'e') rotate(k === 'q' ? -1 : 1)
  if (k === '1' || k === '2' || k === '3') speak(pickSeed(Number(k) - 1))
  if (k === '4') speak(pickTool())
  if (k === 'h') home()
  if (k === 'i' || k === 'c') openPanel(k === 'i' ? 'bag' : 'craft')
})

addEventListener('keyup', (e) => {
  sow = e.shiftKey
  const i = held.indexOf(dir(e))
  if (i >= 0) held.splice(i, 1)
})

addEventListener('blur', () => {
  held.length = 0
  sow = false
})

// The world cell under a screen point. Every element there is checked, as the board's own box shares the ground's plane.
function cellAt(px: number, py: number) {
  for (const el of document.elementsFromPoint(px, py)) {
    const k = cell.get(el)
    if (k !== undefined) return { x: farmer.x + (k % VW) - CX, y: farmer.y + Math.floor(k / VW) - CY }
  }
}

let drag: { x: number; y: number; px: number; py: number; sown: number } | undefined

board.addEventListener('pointerdown', (e) => {
  board.focus({ preventScroll: true })
  if (e.target === dogEl) return pet()
  const c = e.button ? undefined : cellAt(e.clientX, e.clientY)
  if (!c) return
  drag = { ...c, px: e.clientX, py: e.clientY, sown: -1 }
  board.setPointerCapture(e.pointerId)
})

// Dragging sows every plantable cell the pointer crosses, sampled along the segment so a quick swipe skips none.
board.addEventListener('pointermove', (e) => {
  if (!drag) return
  const n = Math.ceil(Math.hypot(e.clientX - drag.px, e.clientY - drag.py) / 6)
  for (let i = 1; i <= n; i++) {
    const c = cellAt(drag.px + ((e.clientX - drag.px) * i) / n, drag.py + ((e.clientY - drag.py) * i) / n)
    if (!c || (drag.sown < 0 && c.x === drag.x && c.y === drag.y)) continue
    if (drag.sown < 0) drag.sown = Number(sowAt(drag))
    drag.sown += Number(sowAt(c))
  }
  drag.px = e.clientX
  drag.py = e.clientY
})

function sowAt({ x, y }: At) {
  if (!run({ type: 'plant', seed: SEEDS[seed], x, y }, true).ok) return false
  pop(x, y)
  return true
}

board.addEventListener('pointerup', () => {
  const d = drag
  drag = undefined
  if (!d) return
  if (d.sown >= 0) return speak(`Planted ${d.sown} ${lower(SEEDS[seed])}`)
  // A tap walks there along a path and plants or picks; a tap on a tree, pond, rock or stall walks beside it and uses it.
  if (d.x === farmer.x && d.y === farmer.y) return use({ x: d.x, y: d.y })
  const target = { x: d.x, y: d.y }
  const steps = route(d.x, d.y, !open(d.x, d.y))
  if (!steps) return speak(`${describe(d.x, d.y)}. No way there`)
  go(steps, target)
})

board.addEventListener('pointercancel', () => (drag = undefined))

panel.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button')
  const d = b?.dataset ?? {}
  if (d.tab) return showTab(d.tab)
  const a: Action | null = d.sell
    ? { type: 'sell', item: d.sell as ItemId }
    : d.craft
      ? { type: 'craft', recipe: d.craft as RecipeId }
      : d.buy
        ? { type: 'buy', item: d.buy as SeedId }
        : d.fulfil
          ? { type: 'fulfil', slot: Number(d.fulfil) }
          : b?.hasAttribute('data-pouch')
            ? { type: 'pouch' }
            : null
  if (a) run(a)
})

function setAmbience(on: boolean) {
  ambience = on
  root.dataset.ambience = on ? 'on' : 'off'
  petalEl.ariaPressed = String(on)
}

document.querySelector('#home')!.addEventListener('click', home)
document.querySelector('#ask')!.addEventListener('click', () => help.showModal())
bagEl.addEventListener('click', () => openPanel('bag'))
toolEl.addEventListener('click', () => speak(pickTool()))
muteEl.addEventListener('click', () => {
  setMuted(!isMuted())
  muteEl.ariaPressed = String(!isMuted())
})
petalEl.addEventListener('click', () => {
  setAmbience(!ambience)
  save()
})
for (const b of document.querySelectorAll<HTMLElement>('[data-turn]')) {
  b.addEventListener('click', () => rotate(Number(b.dataset.turn)))
}
seedEls.forEach((b, i) => b.addEventListener('click', () => speak(pickSeed(i))))

document.querySelector('#help-t')!.textContent = `Controls · walking with ${dogName(born)} the corgi`
muteEl.ariaPressed = String(!isMuted())
setAmbience(ambience)
startClock((p) => (root.dataset.phase = p))
render()
renderHud()
main.style.setProperty('--r', String(turn))
if (back) speak(back)
// Flush styles before enabling transitions so a saved rotation does not animate in on load.
void board.offsetWidth
board.dataset.ready = ''
