import { test, expect } from './fixtures'

test.describe('Middleware Lifecycle', () => {
  test('onChunk transforms text content', async ({
    page,
    testId,
    aimockPort,
  }) => {
    const params = new URLSearchParams()
    if (testId) params.set('testId', testId)
    if (aimockPort) params.set('aimockPort', String(aimockPort))
    const qs = params.toString()
    await page.goto(`/middleware-test${qs ? '?' + qs : ''}`)
    await page.waitForTimeout(2000) // hydration
    await page.locator('#mw-scenario-select').selectOption('basic-text')
    await page.locator('#mw-mode-select').selectOption('chunk-transform')
    await page.locator('#mw-run-button').click()

    await page.waitForFunction(
      () =>
        document
          .querySelector('#mw-metadata')
          ?.getAttribute('data-test-complete') === 'true',
      { timeout: 10000 },
    )

    const messagesJson = await page.locator('#mw-messages-json').textContent()
    const messages = JSON.parse(messagesJson || '[]')
    const assistantMsg = messages.find((m: any) => m.role === 'assistant')
    const textPart = assistantMsg?.parts?.find((p: any) => p.type === 'text')
    expect(textPart?.content).toContain('[MW]')
  })

  test('onBeforeToolCall skips tool execution', async ({
    page,
    testId,
    aimockPort,
  }) => {
    const params = new URLSearchParams()
    if (testId) params.set('testId', testId)
    if (aimockPort) params.set('aimockPort', String(aimockPort))
    const qs = params.toString()
    await page.goto(`/middleware-test${qs ? '?' + qs : ''}`)
    await page.waitForTimeout(2000)
    await page.locator('#mw-scenario-select').selectOption('with-tool')
    await page.locator('#mw-mode-select').selectOption('tool-skip')
    await page.locator('#mw-run-button').click()

    await page.waitForFunction(
      () =>
        document
          .querySelector('#mw-metadata')
          ?.getAttribute('data-test-complete') === 'true',
      { timeout: 10000 },
    )

    const messagesJson = await page.locator('#mw-messages-json').textContent()
    const messages = JSON.parse(messagesJson || '[]')

    // Find tool result parts
    const toolResults = messages.flatMap((m: any) =>
      m.parts.filter((p: any) => p.type === 'tool-result'),
    )
    expect(toolResults.length).toBeGreaterThan(0)
    expect(toolResults[0].content).toContain('skipped')
  })

  test('otel middleware emits chat span + per-iteration token histograms', async ({
    page,
    testId,
    aimockPort,
    baseURL,
  }) => {
    const params = new URLSearchParams()
    if (testId) params.set('testId', testId)
    if (aimockPort) params.set('aimockPort', String(aimockPort))
    const qs = params.toString()
    await page.goto(`/middleware-test${qs ? '?' + qs : ''}`)
    await page.waitForTimeout(2000)
    await page.locator('#mw-scenario-select').selectOption('basic-text')
    await page.locator('#mw-mode-select').selectOption('otel')
    await page.locator('#mw-run-button').click()

    await page.waitForFunction(
      () =>
        document
          .querySelector('#mw-metadata')
          ?.getAttribute('data-test-complete') === 'true',
      { timeout: 10000 },
    )

    // Fetch the captured otel state from the server.
    const captureUrl = `${baseURL ?? ''}/api/middleware-test?testId=${encodeURIComponent(testId)}`
    const response = await page.request.get(captureUrl)
    expect(response.ok()).toBe(true)
    const capture = await response.json()

    // Chat span + at least one iteration span, all ended.
    const chatSpan = capture.spans.find(
      (s: any) =>
        s.attributes['gen_ai.operation.name'] === 'chat' &&
        !('tanstack.ai.iteration' in s.attributes),
    )
    expect(chatSpan).toBeDefined()
    expect(chatSpan.ended).toBe(true)

    const iterationSpans = capture.spans.filter(
      (s: any) => 'tanstack.ai.iteration' in s.attributes,
    )
    expect(iterationSpans.length).toBeGreaterThanOrEqual(1)
    for (const iter of iterationSpans) {
      expect(iter.ended).toBe(true)
    }

    // Token histogram records show up with correct unit and low-cardinality attrs.
    const tokenRecords = capture.histograms.filter(
      (h: any) => h.name === 'gen_ai.client.token.usage',
    )
    // Guard against the C1 regression: onUsage used to no-op in production order,
    // losing every token histogram record. If we ever regress, this assertion fails.
    expect(tokenRecords.length).toBeGreaterThanOrEqual(2)
    for (const r of tokenRecords) {
      expect(r.unit).toBe('{token}')
      expect(r.attributes['gen_ai.response.id']).toBeUndefined()
      expect(r.attributes['gen_ai.response.model']).toBeUndefined()
    }

    // Duration histogram is per-run.
    const durationRecords = capture.histograms.filter(
      (h: any) => h.name === 'gen_ai.client.operation.duration',
    )
    expect(durationRecords.length).toBe(1)
    expect(durationRecords[0].unit).toBe('s')
    expect(
      durationRecords[0].attributes['gen_ai.response.model'],
    ).toBeUndefined()
  })

  test('otel middleware nests tool spans under the iteration span that triggered them', async ({
    page,
    testId,
    aimockPort,
    baseURL,
  }) => {
    const params = new URLSearchParams()
    if (testId) params.set('testId', testId)
    if (aimockPort) params.set('aimockPort', String(aimockPort))
    const qs = params.toString()
    await page.goto(`/middleware-test${qs ? '?' + qs : ''}`)
    await page.waitForTimeout(2000)
    await page.locator('#mw-scenario-select').selectOption('with-tool')
    await page.locator('#mw-mode-select').selectOption('otel')
    await page.locator('#mw-run-button').click()

    await page.waitForFunction(
      () =>
        document
          .querySelector('#mw-metadata')
          ?.getAttribute('data-test-complete') === 'true',
      { timeout: 15000 },
    )

    const captureUrl = `${baseURL ?? ''}/api/middleware-test?testId=${encodeURIComponent(testId)}`
    const response = await page.request.get(captureUrl)
    const capture = await response.json()

    // Every tool span carries gen_ai.tool.name + ended outcome. This also
    // guards against the "iteration span closed before onBeforeToolCall"
    // regression — if it regressed, onBeforeToolCall would skip span creation.
    const toolSpans = capture.spans.filter(
      (s: any) => 'gen_ai.tool.name' in s.attributes,
    )
    expect(toolSpans.length).toBeGreaterThanOrEqual(1)
    for (const tool of toolSpans) {
      expect(tool.ended).toBe(true)
      expect(tool.attributes['tanstack.ai.tool.outcome']).toBeDefined()
    }
  })

  test('no middleware passes content through unchanged', async ({
    page,
    testId,
    aimockPort,
  }) => {
    const params = new URLSearchParams()
    if (testId) params.set('testId', testId)
    if (aimockPort) params.set('aimockPort', String(aimockPort))
    const qs = params.toString()
    await page.goto(`/middleware-test${qs ? '?' + qs : ''}`)
    await page.waitForTimeout(2000)
    await page.locator('#mw-scenario-select').selectOption('basic-text')
    await page.locator('#mw-mode-select').selectOption('none')
    await page.locator('#mw-run-button').click()

    await page.waitForFunction(
      () =>
        document
          .querySelector('#mw-metadata')
          ?.getAttribute('data-test-complete') === 'true',
      { timeout: 10000 },
    )

    const messagesJson = await page.locator('#mw-messages-json').textContent()
    const messages = JSON.parse(messagesJson || '[]')
    const assistantMsg = messages.find((m: any) => m.role === 'assistant')
    const textPart = assistantMsg?.parts?.find((p: any) => p.type === 'text')
    expect(textPart?.content).not.toContain('[MW]')
    expect(textPart?.content).toContain('Hello')
  })
})
