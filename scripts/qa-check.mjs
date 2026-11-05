#!/usr/bin/env node
/*
 * qa-check.mjs — functional QA for a production build. Beyond boot: asserts the
 * proxy stack actually initializes (service worker + vendored engine global +
 * controller), the app renders, and nothing errors.
 *
 *   node scripts/qa-check.mjs http://localhost:8137/
 */
import { chromium } from 'playwright-core'

const base = process.argv[2]
if (!base) { console.error('usage: node scripts/qa-check.mjs <base-url>'); process.exit(1) }

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] })
let failed = false
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failed = true
}

const page = await browser.newPage()
const exceptions = []
const consoleErrors = []
page.on('pageerror', (e) => exceptions.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

await page.goto(base, { waitUntil: 'load', timeout: 30000 })

console.log('=== app boot')
await page.waitForTimeout(10000)
const boot = JSON.parse(await page.evaluate(() => JSON.stringify({
  rootBytes: document.getElementById('root')?.innerHTML.length ?? -1,
  title: document.title,
  flags: window.__shieldFlags ?? null,
})))
check('app renders', boot.rootBytes > 2000, `rootBytes=${boot.rootBytes}`)
check('runtime brand title restored', boot.title === 'Fracital', `title=${boot.title}`)
check('no page exceptions', exceptions.length === 0, exceptions.slice(0, 2).join(' | '))

console.log('=== proxy stack (vendor rename + proxy transform + gate wiring)')
// The app assembles the vendor global from pieces; do the same here so the test
// itself never hardcodes the name either.
const proxy = JSON.parse(await page.evaluate(() => (async () => {
  const out = { readyOk: false, engineGlobal: false, engineVersion: null, controller: false, swControlled: false, swError: null }
  try {
    await Promise.race([
      window.scramjetReady,
      new Promise((_, rej) => setTimeout(() => rej(new Error('scramjetReady timeout')), 15000)),
    ])
    out.readyOk = true
  } catch (e) { out.swError = String(e) }
  const rt = globalThis[['$', 'scram', 'jet'].join('')]
  out.engineGlobal = !!rt
  out.engineVersion = rt?.versionInfo?.version ?? null
  out.controller = !!window.scramjetController
  const reg = await navigator.serviceWorker?.getRegistration()
  out.swControlled = !!reg?.active
  return JSON.stringify(out)
})()))
check('engine ready promise resolves', proxy.readyOk, proxy.swError || '')
check('engine runtime global present', proxy.engineGlobal, `version=${proxy.engineVersion}`)
check('controller global present', proxy.controller)
check('service worker active', proxy.swControlled)

console.log('=== text obfuscation (HolyText)')
const holy = JSON.parse(await page.evaluate(() => {
  const hosts = [...document.querySelectorAll('#root *')].filter((el) => el.shadowRoot)
  return JSON.stringify({
    shadowHosts: hosts.length,
    bodyHasBrand: (document.body.textContent || '').includes('FRACITAL'),
  })
}))
check('bot tripwire flagged headless (dash placeholders)', boot.flags?.likelyBot === true)
check('brand text never in light DOM (bot view)', !holy.bodyHasBrand)

// Human view: mask the webdriver flag so the tripwire passes, reload, and
// confirm HolyText hosts clear their dash placeholder (host.textContent = ''
// on reveal) while the real text lives in a closed shadow root — invisible to
// .shadowRoot (closed) and to textContent (never crosses the boundary).
const page2 = await browser.newPage()
await page2.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }))
await page2.goto(base, { waitUntil: 'load', timeout: 30000 })
await page2.waitForTimeout(10000)
const human = JSON.parse(await page2.evaluate(() => {
  const hosts = [...document.querySelectorAll('#root .obfuscated-text')]
  const revealed = hosts.filter((el) => el.textContent === '').length
  return JSON.stringify({
    total: hosts.length,
    revealed,
    bodyHasBrand: (document.body.textContent || '').includes('FRACITAL'),
  })
}))
check('human view reveals (placeholders cleared)', human.total > 0 && human.revealed >= human.total * 0.8, `${human.revealed}/${human.total} cleared`)
check('brand text never in light DOM (human view)', !human.bodyHasBrand)
await page2.close()

console.log('=== console error scan')
const benign = /503|Failed to load resource|net::ERR|favicon/i
const realErrors = consoleErrors.filter((e) => !benign.test(e))
check('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
const shieldErr = consoleErrors.filter((e) => /shield|bytecode|step budget|integrity/i.test(e))
check('no shield errors', shieldErr.length === 0)

await page.close()
await browser.close()
console.log(failed ? '\nQA FAILED' : '\nQA PASSED')
process.exit(failed ? 2 : 0)
