import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } })
const page = await ctx.newPage()
const errs: string[] = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0,180)) })
page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0,180)))
await page.goto('http://localhost:3000/login')
await page.getByLabel('Email').fill('risk@ocbc.demo')
await page.getByLabel('Password').fill('Demo!2026')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL(/\/ai$/)
await page.getByTestId('ai-heading').waitFor()
await page.locator('canvas.maplibregl-canvas').first().waitFor({ timeout: 20000 })
await page.waitForTimeout(8000)
const info = await page.evaluate(`(() => {
  var m = window.__hotspotMap;
  return {
    styleLoaded: m ? m.isStyleLoaded() : false,
    pointers: m ? m.queryRenderedFeatures({ layers: ['hotspot-pointers'] }).length : -1,
    tiles: document.querySelectorAll('[data-testid^="tile-"]').length,
    news: document.querySelectorAll('[data-testid^="news-item-"]').length,
    hotspotItems: document.querySelectorAll('[data-testid^="hotspot-item-"]').length
  };
})()`)
console.log('dashboard:', JSON.stringify(info))
await page.screenshot({ path: 'ai-dashboard.png', fullPage: true })
// open a hotspot
await page.locator('[data-testid^="hotspot-item-"]').first().click()
await page.getByTestId('hotspot-popup').waitFor()
console.log('popup name:', await page.getByTestId('hotspot-name').textContent())
console.log('exposure:', await page.getByTestId('hotspot-exposure').textContent(), '| share:', await page.getByTestId('hotspot-share').textContent())
console.log('score state:', await page.getByTestId('score-badges').getAttribute('data-state'))
console.log('reference:', await page.getByTestId('reference-index').textContent())
await page.waitForTimeout(1200)
await page.screenshot({ path: 'ai-popup.png' })
console.log('errors:', errs.length ? errs.slice(0,4) : 'none')
await browser.close()
