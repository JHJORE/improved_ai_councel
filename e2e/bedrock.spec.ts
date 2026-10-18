import { test, expect } from '@playwright/test'
test('Bedrock key-only chat runs the whole Council without OpenRouter completions', async ({
  page,
}) => {
  let calls = 0
  let openRouterCalls = 0
  page.on('request', (request) => {
    if (request.url().includes('openrouter.ai/api/v1/chat/completions'))
      openRouterCalls++
  })
  await page.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({ json: { data: [] } }),
  )
  await page.route('**/api/bedrock', async (route) => {
    const body = route.request().postDataJSON()
    expect(route.request().headers().authorization).toBe(
      'Bearer fake-bedrock-key',
    )
    expect(body.region).toBe('us-east-1')
    expect(body.model).toMatch(/^us\.(anthropic|amazon|meta)\./)
    calls++
    const prompt = body.messages[0].content
    const text = prompt.includes('Evaluate each candidate')
      ? JSON.stringify({
          evaluations: ['A', 'B', 'C'].map((responseId) => ({
            responseId,
            accuracy: 9,
            completeness: 9,
            reasoning: 9,
            usefulness: 9,
            flaws: [],
          })),
          ranking: ['A', 'B', 'C'],
        })
      : prompt.includes('Return ONE polished')
        ? 'Bedrock final answer.'
        : 'An independent point of view.'
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page
    .getByLabel('Chat provider', { exact: true })
    .selectOption('bedrock')
  await page
    .getByLabel('AWS Bedrock API key', { exact: true })
    .fill('fake-bedrock-key')
  await page.keyboard.press('Escape')
  await page
    .getByLabel('Message', { exact: true })
    .fill('Explain a difficult decision')
  await page.getByLabel('Message', { exact: true }).press('Enter')
  await expect(
    page.getByText('Bedrock final answer.', { exact: true }),
  ).toBeVisible()
  expect(calls).toBe(13)
  expect(openRouterCalls).toBe(0)
  await page.reload()
  await expect(
    page.getByText('Bedrock final answer.', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByLabel('Chat provider', { exact: true })).toHaveValue(
    'bedrock',
  )
  await expect(
    page.getByLabel('AWS Bedrock API key', { exact: true }),
  ).toHaveValue('fake-bedrock-key')
  await expect(page.getByLabel('AWS region', { exact: true })).toHaveValue(
    'us-east-1',
  )
})
