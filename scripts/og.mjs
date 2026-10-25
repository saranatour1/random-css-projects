// Renders the Open Graph card to public/og.png (1200x630) from the running game. No dependencies.
// Usage: start `astro preview` (or `astro dev`), then `node scripts/og.mjs [url]`. Safe to rerun; it overwrites the PNG.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.argv[2] ?? 'http://localhost:4321/'
const OUT = new URL('../public/og.png', import.meta.url)
const [W, H] = [1200, 630]
const PORT = 9334
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// A tended home patch: each garden bed ripe with one crop, a scarecrow and a lantern, the farmer by the house.
const ripe = Date.now() - 600_000
const beds = { carrot: 0, turnip: 4, wheat: 8 }
const plots = Object.entries(beds).flatMap(([crop, x0]) =>
  [0, 1, 2].flatMap((dx) => [6, 7].map((y) => [`${x0 + dx},${y}`, crop, ripe])),
)
const save = {
  inv: [['carrot_seed', 12], ['turnip_seed', 9], ['wheat_seed', 15], ['koi', 1]],
  coins: 240,
  plots,
  placed: [['3,6', 'scarecrow'], ['7,3', 'lantern']],
  f: [3, 3],
  t: 0,
  s: 0,
  a: 0,
  n: 0,
  w: Date.now(),
}

// Runs in the page: fixes the light, hides the HUD, freezes motion and adds the title lockup.
function overlay(phase) {
  document.documentElement.dataset.phase = phase
  for (const el of document.querySelectorAll('.map, .corner, .hud, .petals, #say')) el.style.visibility = 'hidden'
  for (const a of document.getAnimations()) a.finish?.()
  const card = document.createElement('div')
  card.innerHTML = '<b>Pocket<br>Farm</b><span>A cozy infinite farm made of pure CSS&nbsp;3D</span>'
  card.style.cssText = `position:fixed;left:32px;top:32px;width:316px;padding:22px 28px 26px;z-index:9;display:grid;gap:12px;
    background:#fffaf0;color:#4b3a2f;border:5px solid #4b3a2f;border-radius:22px;box-shadow:0 8px 0 #4b3a2f66;
    font-family:ui-rounded,system-ui,sans-serif`
  card.querySelector('b').style.cssText = 'font-size:98px;line-height:0.92;font-weight:900;letter-spacing:-0.02em'
  card.querySelector('span').style.cssText = 'font-size:29px;line-height:1.15;font-weight:700;color:#6a4f3a'
  document.body.append(card)
}

const profile = mkdtempSync(join(tmpdir(), 'pf-og-'))
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--window-size=${W},${H}`,
  '--hide-scrollbars', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  let target
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200)
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page') } catch {}
  }
  if (!target) throw new Error(`Chrome did not open a debugging target on port ${PORT}`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r, j) => (ws.addEventListener('open', r), ws.addEventListener('error', j)))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data)
    if (m.id) pending.get(m.id)?.(m)
  })
  const send = (method, params = {}) => new Promise((r, j) => {
    pending.set(++id, (m) => (m.error ? j(new Error(`${method}: ${m.error.message}`)) : r(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
  const until = async (expression, what) => {
    for (let i = 0; i < 50; i++, await sleep(200)) if (await evaluate(expression).catch(() => false)) return
    throw new Error(`timed out waiting for ${what}; is the game running at ${URL_}?`)
  }
  const loaded = `location.origin !== 'null' && document.readyState === 'complete' && !!document.querySelector('.board[data-ready]')`
  await send('Page.navigate', { url: URL_ })
  await until(loaded, 'the game to load')
  // Writes are blocked until the reload, so the old page's pagehide save cannot overwrite the seeded farm.
  await evaluate(`localStorage.clear(); localStorage.setItem('pocket-farm-3', ${JSON.stringify(JSON.stringify(save))});
    Storage.prototype.setItem = function () {}; location.reload()`)
  await sleep(500)
  await until(loaded, 'the game to reload')
  const ok = await evaluate(`document.querySelectorAll('[data-u="c3"], [data-u="t3"], [data-u="w3"]').length`)
  if (ok < plots.length) throw new Error(`expected ${plots.length} ripe crops on screen, saw ${ok}; is the game running at ${URL_}?`)
  await evaluate(`(${overlay})(${JSON.stringify(process.env.PHASE ?? 'golden')})`)
  await sleep(500)
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } })
  writeFileSync(OUT, Buffer.from(data, 'base64'))
  const png = Buffer.from(data, 'base64')
  console.log(`wrote ${OUT.pathname} ${png.readUInt32BE(16)}x${png.readUInt32BE(20)} ${(statSync(OUT).size / 1024).toFixed(1)} KB`)
  ws.close()
} finally {
  chrome.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
