// OpenAI-kompatibler LLM-Client (server-only, Key nur in process.env).
// Default: Googles OpenAI-kompatibler Gemini-Endpoint (direkter Gemini-Key).
// Per LLM_BASE_URL auch auf ein LiteLLM-Gateway umstellbar (dann Pfad mit /v1).
// Modelle werden zur Laufzeit via GET /models entdeckt; Praeferenz via LLM_MODELS.
// 1:1 uebernommen aus TaikoEat (server/services/ai.js), nur TOOL_SLUG geaendert.

import crypto from 'node:crypto'

const TOOL_SLUG = 'taiko-beschluss'

const BASE_URL = (
  process.env.LLM_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai'
).replace(/\/+$/, '')
const IS_LITELLM = BASE_URL.includes('litellm')

const PREFERRED_MODELS = (process.env.LLM_MODELS ?? '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean)

const ENV_NAME = process.env.NODE_ENV || 'production'
const DEFAULT_TAGS = [`tool=${TOOL_SLUG}`, `env=${ENV_NAME}`]
const SESSION_ID = crypto.randomUUID()

function authHeaders() {
  if (!process.env.LLM_API_KEY) {
    throw new Error('LLM_API_KEY is not set (server/.env)')
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.LLM_API_KEY}`,
  }
}

let _availableModels = null

async function getAvailableModels() {
  if (_availableModels) return _availableModels
  try {
    const res = await fetch(`${BASE_URL}/models`, { headers: authHeaders() })
    if (!res.ok) throw new Error(`models ${res.status}`)
    const data = await res.json()
    _availableModels = (data.data ?? [])
      .map((m) => (m.id ?? '').replace(/^models\//, '')) // Google prefixt mit "models/"
      .filter(Boolean)
  } catch (error) {
    console.warn('model discovery failed, using preference list:', error.message)
    _availableModels = [...PREFERRED_MODELS]
  }
  return _availableModels
}

async function candidateModels() {
  const available = await getAvailableModels()
  if (!available.length) return [...PREFERRED_MODELS]
  const preferred = PREFERRED_MODELS.filter((m) => available.includes(m))
  if (!preferred.length) return available
  const rest = available.filter((m) => !preferred.includes(m))
  return [...preferred, ...rest]
}

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504])
const TRANSIENT_ERROR_MARKERS = [
  'quota',
  'resource_exhausted',
  'overloaded',
  'overload',
  'unavailable',
  'temporarily unavailable',
  'service unavailable',
  'rate limit',
]

export function isRetryableModelError(error) {
  const message = String(error?.message ?? '').toLowerCase()
  const status = Number(error?.status)
  return (
    TRANSIENT_STATUS_CODES.has(status) ||
    TRANSIENT_ERROR_MARKERS.some((marker) => message.includes(marker))
  )
}

export async function chatCompletion(input) {
  const body = {
    model: input.model,
    messages: input.messages,
    // metadata ist eine LiteLLM-Erweiterung — Googles Endpoint wuerde sie ablehnen
    ...(IS_LITELLM
      ? {
          metadata: {
            session_id: input.sessionId ?? SESSION_ID,
            tags: [...DEFAULT_TAGS, ...(input.tags ?? [])],
            ...(input.generationName ? { generation_name: input.generationName } : {}),
            ...(input.userId ? { trace_user_id: input.userId } : {}),
          },
        }
      : {}),
    ...(input.extra ?? {}),
  }

  if (input.jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: input.jsonSchema.name,
        strict: input.jsonSchema.strict ?? true,
        schema: input.jsonSchema.schema,
      },
    }
  }

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`LLM ${res.status}: ${text || res.statusText}`)
    err.status = res.status
    throw err
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

export async function chatCompletionWithFallback(rest) {
  const models = await candidateModels()
  if (!models.length) {
    throw new Error('No models available — neither /models nor LLM_MODELS returned a model.')
  }

  let lastError
  for (const model of models) {
    try {
      return await chatCompletion({ ...rest, model })
    } catch (error) {
      if (isRetryableModelError(error)) {
        console.warn(`model ${model} busy, trying next:`, error.message)
        lastError = error
        continue
      }
      throw error
    }
  }
  throw lastError ?? new Error('all models exhausted')
}
