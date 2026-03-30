import { test, expect } from '@playwright/test'

const ADMIN_TOKEN = 'fded3790f3f3f6115848a8b5cfae6afc169be52871423722216230d8a356793c'

// Ant Design adds a space between Chinese chars in buttons: "注 册" not "注册"
test.describe('E2E: 完整用户流程', () => {

  test('1. 注册页面 - 新用户注册', async ({ page }) => {
    await page.goto('/register')
    await expect(page.getByText('注册新用户')).toBeVisible()
    await page.getByLabel('用户名').fill('pw-user-' + Date.now())
    await page.locator('button[type="submit"]').click()
    // Modal.success creates .ant-modal-confirm
    await expect(page.locator('.ant-modal-confirm')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.ant-modal-confirm-title').getByText('注册成功')).toBeVisible()
    const tokenArea = page.locator('.ant-modal-confirm textarea')
    await expect(tokenArea).toBeVisible()
    const tokenValue = await tokenArea.inputValue()
    expect(tokenValue.length).toBeGreaterThan(10)
    console.log(`  ✓ 注册成功, token: ${tokenValue.substring(0, 16)}...`)
  })

  test('2. 登录页面 - 无效 Token 登录失败', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Access Token').fill('invalid-token-12345')
    await page.locator('button[type="submit"]').click()
    // Invalid token triggers 401 → api client redirects to /login
    // The user stays on login page (URL doesn't change to /admin or /dashboard)
    await page.waitForTimeout(3000)
    expect(page.url()).toContain('/login')
    console.log('  ✓ 无效 Token 登录被拒绝，停留在登录页')
  })

  test('3. Admin 登录 + 管理菜单', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Access Token').fill(ADMIN_TOKEN)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin/, { timeout: 10_000 })
    console.log(`  ✓ Admin 登录成功, 跳转到: ${page.url()}`)
    await expect(page.getByRole('menu').getByText('用户管理')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('menu').getByText('Key 管理')).toBeVisible()
    console.log('  ✓ 管理员侧边栏菜单正确显示')
  })

  test('4. 管理员 - 用户管理', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Access Token').fill(ADMIN_TOKEN)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin/, { timeout: 10_000 })
    await page.getByRole('menu').getByText('用户管理').click()
    await expect(page.locator('.ant-table')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('.ant-table-row').first()).toBeVisible()
    console.log('  ✓ 用户列表表格正确显示')
  })

  test('5. 管理员 - Key 管理', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Access Token').fill(ADMIN_TOKEN)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin/, { timeout: 10_000 })
    await page.getByRole('menu').getByText('Key 管理').click()
    await page.waitForURL(/\/admin\/keys/, { timeout: 5_000 })
    await expect(page.locator('.ant-table')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('.ant-table-row')).toHaveCount(2, { timeout: 5_000 })
    const tableText = await page.locator('.ant-table').textContent()
    expect(tableText).toContain('minimax')
    expect(tableText).toContain('glm')
    console.log('  ✓ Key 列表正确显示 (2 个 Key, minimax + glm)')
  })

  test('6. 管理员 - Provider 配置', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Access Token').fill(ADMIN_TOKEN)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin/, { timeout: 10_000 })
    await page.getByRole('menu').getByText('Provider').click()
    await page.waitForURL(/\/admin\/providers/, { timeout: 5_000 })
    await expect(page.locator('.ant-table')).toBeVisible({ timeout: 5_000 })
    // Wait for data to load (async fetch)
    await page.waitForTimeout(2000)
    await expect(page.locator('.ant-table-row').first()).toBeVisible({ timeout: 10_000 })
    const tableText = await page.locator('.ant-table').textContent()
    expect(tableText).toContain('MiniMax')
    expect(tableText).toContain('GLM')
    console.log('  ✓ Provider 列表正确显示 (MiniMax + GLM)')
  })

  test('7. 管理员 - 用量查看', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Access Token').fill(ADMIN_TOKEN)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin/, { timeout: 10_000 })
    await page.getByRole('menu').getByText('用量查看').click()
    await page.waitForURL(/\/admin\/usage/, { timeout: 5_000 })
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 5_000 })
    console.log('  ✓ 用量查看页面正确加载')
  })

  test('8. 管理员 - 费用报告', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Access Token').fill(ADMIN_TOKEN)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin/, { timeout: 10_000 })
    await page.getByRole('menu').getByText('费用报告').click()
    await page.waitForURL(/\/admin\/cost/, { timeout: 5_000 })
    await expect(page.locator('button:has-text("生成")')).toBeVisible({ timeout: 5_000 })
    console.log('  ✓ 费用报告页面正确加载')
  })

  test('9. 健康状态指示器', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Access Token').fill(ADMIN_TOKEN)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin/, { timeout: 10_000 })
    await page.waitForTimeout(2000)
    await expect(page.locator('.ant-badge, .ant-tag').first()).toBeVisible({ timeout: 10_000 })
    console.log('  ✓ 健康状态指示器可见')
  })

  test('10. 普通用户 - 只能看到用量面板', async ({ page }) => {
    const res = await page.request.post('/api/user/register', {
      data: { username: `pw-normal-${Date.now()}` },
    })
    const { accessToken } = await res.json()
    await page.goto('/login')
    await page.getByLabel('Access Token').fill(accessToken)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 })
    console.log(`  ✓ 普通用户登录成功, 跳转到: ${page.url()}`)
    await page.waitForTimeout(1000)
    const bodyText = await page.textContent('body')
    expect(bodyText).not.toContain('Key 管理')
    console.log('  ✓ 普通用户看不到管理员菜单')
    await expect(page.locator('.ant-table, .ant-card, .ant-picker').first()).toBeVisible({ timeout: 5_000 })
    console.log('  ✓ 普通用户可以看到用量面板')
  })
})
