// ai.js gegen gestubbtes fetch: Discovery, Praeferenz, Fallback, Retry-Klassifikation.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Modul-State (Model-Cache, env-Snapshot) pro Test frisch laden
async function loadAi(env = {}) {
  vi.resetModules()
  process.env.LLM_API_KEY = 'test-key'
  process.env.LLM_MODELS = env.LLM_MODELS ?? 'model-b'
  return import('../services/ai.js')
}

const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('isRetryableModelError', () => {
  it('transiente Status und Marker -> true, harte Fehler -> false', async () => {
    const { isRetryableModelError } = await loadAi()
    expect(isRetryableModelError({ status: 503, message: 'x' })).toBe(true)
    expect(isRetryableModelError({ status: 429, message: 'x' })).toBe(true)
    expect(isRetryableModelError({ message: 'The model is overloaded' })).toBe(true)
    expect(isRetryableModelError({ message: 'RESOURCE_EXHAUSTED: quota' })).toBe(true)
    expect(isRetryableModelError({ status: 400, message: 'invalid request' })).toBe(false)
    expect(isRetryableModelError({ message: 'schema mismatch' })).toBe(false)
  })
})

describe('chatCompletionWithFallback', () => {
  it('nutzt Praeferenz-Modell zuerst, faellt bei 503 auf naechstes zurueck', async () => {
    const { chatCompletionWithFallback } = await loadAi({ LLM_MODELS: 'model-b' })
    const calls = []
    vi.stubGlobal('fetch', async (url, opts) => {
      if (String(url).endsWith('/models'))
        return jsonRes({ data: [{ id: 'models/model-a' }, { id: 'models/model-b' }] })
      const body = JSON.parse(opts.body)
      calls.push(body.model)
      if (body.model === 'model-b') return new Response('overloaded', { status: 503 })
      return jsonRes({ choices: [{ message: { content: 'antwort' } }] })
    })
    const out = await chatCompletionWithFallback({ messages: [] })
    expect(out).toBe('antwort')
    expect(calls).toEqual(['model-b', 'model-a']) // Praeferenz zuerst, dann Fallback
  })

  it('nicht-retrybarer Fehler bricht sofort ab (kein Modell-Hopping)', async () => {
    const { chatCompletionWithFallback } = await loadAi()
    let completionCalls = 0
    vi.stubGlobal('fetch', async (url) => {
      if (String(url).endsWith('/models'))
        return jsonRes({ data: [{ id: 'model-a' }, { id: 'model-b' }] })
      completionCalls++
      return new Response('invalid schema', { status: 400 })
    })
    await expect(chatCompletionWithFallback({ messages: [] })).rejects.toThrow('LLM 400')
    expect(completionCalls).toBe(1)
  })

  it('Discovery kaputt -> Praeferenz-Liste als Fallback', async () => {
    const { chatCompletionWithFallback } = await loadAi({ LLM_MODELS: 'model-x' })
    vi.stubGlobal('fetch', async (url, opts) => {
      if (String(url).endsWith('/models')) return new Response('nope', { status: 500 })
      expect(JSON.parse(opts.body).model).toBe('model-x')
      return jsonRes({ choices: [{ message: { content: 'ok' } }] })
    })
    expect(await chatCompletionWithFallback({ messages: [] })).toBe('ok')
  })

  it('ohne LLM_API_KEY: klarer Fehler', async () => {
    const ai = await loadAi()
    delete process.env.LLM_API_KEY
    await expect(ai.chatCompletionWithFallback({ messages: [] })).rejects.toThrow('LLM_API_KEY')
  })

  it('jsonSchema landet als response_format im Request', async () => {
    const { chatCompletion } = await loadAi()
    let sentBody
    vi.stubGlobal('fetch', async (_url, opts) => {
      sentBody = JSON.parse(opts.body)
      return jsonRes({ choices: [{ message: { content: '{}' } }] })
    })
    await chatCompletion({
      model: 'm',
      messages: [],
      jsonSchema: { name: 'test', schema: { type: 'object' } },
    })
    expect(sentBody.response_format.type).toBe('json_schema')
    expect(sentBody.response_format.json_schema.name).toBe('test')
    expect(sentBody.metadata).toBeUndefined() // kein LiteLLM -> keine metadata
  })
})
