import { describe, it, expect } from 'vitest'
import { chatParamsFromRequestBody } from '../src/utilities/chat-params'

describe('chatParamsFromRequestBody', () => {
  const validBody = {
    threadId: 'thread-1',
    runId: 'run-1',
    state: {},
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'hello',
        // TanStack canonical (extra) — should pass through untouched
        parts: [{ type: 'text', content: 'hello' }],
      },
    ],
    tools: [],
    context: [],
    forwardedProps: { temperature: 0.7 },
  }

  it('returns parsed fields verbatim on a valid body', async () => {
    const result = await chatParamsFromRequestBody(validBody)
    expect(result.threadId).toBe('thread-1')
    expect(result.runId).toBe('run-1')
    expect(result.messages).toHaveLength(1)
    expect(result.tools).toEqual([])
    expect(result.forwardedProps).toEqual({ temperature: 0.7 })
  })

  it('preserves the `parts` field on messages (AG-UI strip mode tolerates extras in raw JSON)', async () => {
    const result = await chatParamsFromRequestBody(validBody)
    const m = result.messages[0] as { parts?: unknown }
    expect(m.parts).toEqual([{ type: 'text', content: 'hello' }])
  })

  it('throws on missing threadId', async () => {
    const { threadId, ...rest } = validBody
    await expect(chatParamsFromRequestBody(rest)).rejects.toThrow()
  })

  it('throws on missing runId', async () => {
    const { runId, ...rest } = validBody
    await expect(chatParamsFromRequestBody(rest)).rejects.toThrow()
  })

  it('throws on missing messages', async () => {
    const { messages, ...rest } = validBody
    await expect(chatParamsFromRequestBody(rest)).rejects.toThrow()
  })

  it('rejects the legacy {messages, data} shape with a migration-pointing error', async () => {
    const oldBody = {
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', content: 'hi' }] }],
      data: {},
    }
    await expect(chatParamsFromRequestBody(oldBody)).rejects.toThrow(
      /AG-UI|RunAgentInput|migration/i,
    )
  })
})
