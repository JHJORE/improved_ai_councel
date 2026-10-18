import { test, expect, type Page } from '@playwright/test'
const ids = [
  'anthropic/claude-opus-4.6',
  'openai/gpt-5.4',
  'google/gemini-3.1-pro-preview',
]
async function setup(page: Page, failOnce = false) {
  const stages: string[] = []
  let failed = false
  await page.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({
      json: {
        data: ids.map((id) => ({
          id,
          name: id,
          pricing: { prompt: '0.000002', completion: '0.00001' },
          supported_parameters: ['structured_outputs'],
        })),
      },
    }),
  )
  await page.route(
    'https://openrouter.ai/api/v1/chat/completions',
    async (route) => {
      const body = route.request().postDataJSON(),
        prompt = body.messages[0].content as string
      const stage = prompt.includes('Return ONE polished')
        ? 'synthesis'
        : prompt.includes('Evaluate each candidate')
          ? 'evaluation'
          : prompt.includes('substantially improved')
            ? 'revision'
            : prompt.includes('Critique each response')
              ? 'critique'
              : 'independent'
      stages.push(stage)
      if (failOnce && !failed && body.model === ids[1]) {
        failed = true
        await route.fulfill({ status: 503, json: { error: 'mock failure' } })
        return
      }
      const labels = body.response_format?.json_schema.schema.properties.ranking
        .items.enum ?? ['A', 'B', 'C']
      const text =
        stage === 'evaluation'
          ? JSON.stringify({
              evaluations: labels.map((responseId: string) => ({
                responseId,
                accuracy: 9,
                completeness: 8,
                reasoning: 9,
                usefulness: 8,
                flaws: ['Evidence remains uncertain'],
              })),
              ranking: labels,
            })
          : stage === 'synthesis'
            ? 'A polished final answer preserving important uncertainty.'
            : `${stage} answer with a useful minority viewpoint.`
      const data = [
        { choices: [{ delta: { content: text } }] },
        {
          choices: [{ finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.001 },
        },
      ]
      await route.fulfill({
        contentType: 'text/event-stream',
        body:
          data.map((d) => `data: ${JSON.stringify(d)}\n\n`).join('') +
          'data: [DONE]\n\n',
      })
    },
  )
  await page.goto('/')
  const sidebarClose = page.getByRole('button', { name: 'Close', exact: true })
  if (await sidebarClose.isVisible()) await sidebarClose.click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page
    .getByLabel('OpenRouter API Key', { exact: true })
    .fill('mock-key-not-a-secret')
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Mode', { exact: true })).toHaveValue('council')
  await page
    .getByLabel('Message', { exact: true })
    .fill('How should we evaluate an uncertain claim?')
  await page.getByLabel('Message', { exact: true }).press('Enter')
  return stages
}
test('full council flow, inspectable stages, usage and reload persistence', async ({
  page,
}) => {
  const stages = await setup(page)
  await expect(
    page.getByRole('heading', { name: 'Final answer', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText(
      'A polished final answer preserving important uncertainty.',
      { exact: true },
    ),
  ).toBeVisible()
  expect(stages).toEqual([
    'independent',
    'independent',
    'independent',
    'critique',
    'critique',
    'critique',
    'revision',
    'revision',
    'revision',
    'evaluation',
    'evaluation',
    'evaluation',
    'synthesis',
  ])
  await page
    .getByText('Inspect answers, rankings and usage', { exact: true })
    .click()
  for (const title of [
    'Revised answers',
    'Rankings',
    'Critiques',
    'Initial answers',
    'Raw execution details',
  ]) {
    await page
      .locator('summary')
      .filter({ hasText: new RegExp(`^${title}$`) })
      .click()
  }
  await expect(page.getByText('mean rank 1.00', { exact: false })).toBeVisible()
  await expect(
    page.getByText('independent answer with a useful minority viewpoint.', {
      exact: true,
    }),
  ).toHaveCount(3)
  await page.reload()
  await expect(page.getByLabel('Mode', { exact: true })).toHaveValue('council')
  await expect(
    page.getByRole('heading', { name: 'Final answer', exact: true }),
  ).toBeVisible()
  expect(stages).toHaveLength(13)
  await page.screenshot({
    path: 'test-results/council-desktop.png',
    fullPage: true,
  })
})
test('failed peer retries only itself and preserves completed answers', async ({
  page,
}) => {
  const stages = await setup(page, true)
  const retry = page.getByRole('button', {
    name: 'Retry GPT only',
    exact: true,
  })
  await expect(retry).toBeVisible()
  await retry.click()
  await expect(
    page.getByRole('heading', { name: 'Final answer', exact: true }),
  ).toBeVisible()
  expect(stages.filter((s) => s === 'independent')).toHaveLength(4)
})
test('mobile council layout remains within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  await expect(
    page.getByRole('heading', { name: 'Final answer', exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390)
  await page.screenshot({
    path: 'test-results/council-mobile.png',
    fullPage: true,
  })
})

test('follow-ups retain context and New conversation starts fresh', async ({
  page,
}) => {
  const prompts: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/chat/completions'))
      prompts.push(request.postDataJSON().messages[0].content)
  })
  const stages = await setup(page)
  await expect(
    page.getByRole('heading', { name: 'Final answer', exact: true }),
  ).toBeVisible()
  await page
    .getByLabel('Message', { exact: true })
    .fill('Which assumption matters most?')
  await page.getByLabel('Message', { exact: true }).press('Enter')
  await expect.poll(() => stages.length).toBe(26)
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByText(
      'A polished final answer preserving important uncertainty.',
      { exact: true },
    ),
  ).toHaveCount(2)
  expect(prompts[13]).toContain('How should we evaluate an uncertain claim?')
  expect(prompts[13]).toContain(
    'A polished final answer preserving important uncertainty.',
  )
  await expect(
    page.getByRole('button', { name: 'New conversation', exact: true }),
  ).toBeEnabled()
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Final answer', exact: true }),
  ).toHaveCount(0)
  await page
    .getByLabel('Message', { exact: true })
    .fill('A completely separate question')
  await page.getByLabel('Message', { exact: true }).press('Enter')
  await expect.poll(() => stages.length).toBe(39)
  expect(prompts[26]).not.toContain('PRIOR CONVERSATION')
})
