import { test } from '@playwright/test'

test('debug: 截图注册页', async ({ page }) => {
  await page.goto('/register')
  await page.waitForTimeout(2000)
  await page.getByLabel('用户名').fill('debug-user-' + Date.now())
  await page.locator('button[type="submit"]').click()
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'e2e/screenshots/register-after-submit.png', fullPage: true })
  // Dump all modals
  const modals = await page.locator('[class*="modal"]').count()
  console.log('Modal count:', modals)
  const modalClasses = await page.locator('[class*="modal"]').evaluateAll(els => els.map(e => e.className))
  console.log('Modal classes:', modalClasses)
  // Dump all visible text
  const bodyText = await page.textContent('body')
  console.log('Body contains 注册成功:', bodyText?.includes('注册成功'))
})

test('debug: 截图登录失败', async ({ page }) => {
  await page.goto('/login')
  await page.waitForTimeout(1000)
  await page.getByLabel('Access Token').fill('bad-token')
  await page.locator('button[type="submit"]').click()
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'e2e/screenshots/login-failed.png', fullPage: true })
  const msgCount = await page.locator('[class*="message"]').count()
  console.log('Message elements:', msgCount)
  const msgClasses = await page.locator('[class*="message"]').evaluateAll(els => els.map(e => e.className))
  console.log('Message classes:', msgClasses)
})
