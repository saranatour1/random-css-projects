// The hand-authored home patch: one char per cell, placed at world (0, 0).
export const MAP = [
  '.T.HHHH.K..T',
  '...HHHH.....',
  'T..HHHH..K..',
  '.~~.,o,....O',
  '~~k~.o,.O...',
  '.~~..o,XPB..',
  'bbb.bbb.bbb.',
  'bbb.bbb.bbb.',
  'fff.fff.fff.',
]
export const W = MAP[0].length

export const LEGEND: Record<string, string> = {
  '.': 'Grass',
  '"': 'Grass',
  '*': 'Wildflowers',
  ',': 'Dirt path',
  o: 'Stepping stone',
  '~': 'Pond',
  k: 'Pond',
  b: 'Garden bed',
  r: 'Rock',
  H: 'House',
  T: 'Oak tree',
  K: 'Cherry tree',
  O: 'Orange tree',
  f: 'Fence',
  X: 'Shipping bin',
  P: 'Seed shop',
  B: 'Orders board',
}
export const SOLID = 'H~kTKOfrXPB'
export const SOIL = '."*,b'
// Terrain that stands up out of the ground, drawn in a cell's upright slot.
export const UPRIGHT = 'TKOfXPB'
export const FARMER = [5, 4] as const

// The camera window: odd sizes, so the farmer stands on the center cell. 29 is the smallest that still
// reaches past every screen edge while the world is one cell into a glide, at the page's --t.
export const VW = 29
export const VH = 29
export const CX = (VW - 1) / 2
export const CY = (VH - 1) / 2

const hy = MAP.findIndex((r) => r.includes('H'))
const hx = MAP[hy].indexOf('H')
export const HOUSE = { x: hx, y: hy, w: MAP[hy].lastIndexOf('H') - hx + 1, h: MAP.filter((r) => r.includes('H')).length }

// Integer hash of a cell, so the wild is the same every visit.
function hash(x: number, y: number) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y + 0x9e3779b9, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  return (h ^ (h >>> 13)) >>> 0
}

// Indexed by hash % 100: 6% trees, 2% rocks, 6% flowers, 16% grass tufts, the rest plain grass.
const WILD = 'TTTKKOrr******""""""""""""""""'

export function terrain(x: number, y: number): string {
  const home = MAP[y]?.[x]
  if (home) return home === '.' && hash(x, y) % 3 === 0 ? '"' : home
  // The inner 2x2 of some 4x4 blocks is a pond; block rows and columns line up with the home patch's edges.
  if ((x & 3) % 3 && (y & 3) % 3 && hash(x >> 2, (y >> 2) + 4099) % 7 === 0) return '~'
  return WILD[hash(x, y) % 100] ?? '.'
}

const pond = (m: string) => m === '~' || m === 'k'
const SIDES = [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]] as const
// Pond sides that meet land, so the bank and its rounded corners can be drawn.
export const rim = (x: number, y: number) =>
  SIDES.filter(([, dx, dy]) => !pond(terrain(x + dx, y + dy))).map(([s]) => s).join('')
// The minimap: an odd square of cells centered on the farmer.
export const MW = 15
