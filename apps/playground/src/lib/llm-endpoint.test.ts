import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  chatCompletionsUrl,
  hasOpenAiV1Path,
  healthUrl,
  isHermesGatewayBase,
  isOpenAiCompatBase,
  LLM_HTTP_DEFAULT,
  LLM_HTTPS_DEFAULT,
  LLM_PROXY,
  migrateLegacyHermesBaseUrl,
  playgroundFetchBase,
  resolveToolsEndpoint,
  paneUsesHermesChat,
} from './llm-endpoint.ts'

describe('migrateLegacyHermesBaseUrl', () => {
  it('rewrites the local HTTP default to HTTPS', () => {
    assert.equal(migrateLegacyHermesBaseUrl(LLM_HTTP_DEFAULT), LLM_HTTPS_DEFAULT)
    assert.equal(migrateLegacyHermesBaseUrl(`${LLM_HTTP_DEFAULT}/`), LLM_HTTPS_DEFAULT)
  })

  it('rewrites stale /api/hermes proxies onto /api/llm', () => {
    assert.equal(migrateLegacyHermesBaseUrl('/api/hermes/alpha'), LLM_PROXY)
  })

  it('keeps OpenAI-style /v1 URLs on the HTTP port', () => {
    const openai = `${LLM_HTTP_DEFAULT}/v1`
    assert.equal(migrateLegacyHermesBaseUrl(openai), openai)
  })
})

describe('OpenAI vs gateway detection', () => {
  it('treats /v1 as OpenAI-compatible', () => {
    assert.equal(hasOpenAiV1Path(`${LLM_HTTP_DEFAULT}/v1`), true)
    assert.equal(isOpenAiCompatBase(`${LLM_HTTP_DEFAULT}/v1`), true)
    assert.equal(isOpenAiCompatBase(LLM_PROXY), false)
    assert.equal(isHermesGatewayBase(LLM_PROXY), true)
    assert.equal(isHermesGatewayBase('/api/hermes/x'), true)
    assert.equal(isHermesGatewayBase(`${LLM_HTTP_DEFAULT}/v1`), false)
    assert.equal(isHermesGatewayBase('https://openrouter.ai/api/v1'), false)
  })
})

describe('playgroundFetchBase', () => {
  it('maps local HTTP (+ /v1) onto the Vite proxy', () => {
    assert.equal(playgroundFetchBase(LLM_HTTP_DEFAULT), LLM_PROXY)
    assert.equal(playgroundFetchBase(`${LLM_HTTP_DEFAULT}/v1`), `${LLM_PROXY}/v1`)
  })

  it('leaves HTTPS and unrelated hosts alone', () => {
    assert.equal(playgroundFetchBase(LLM_HTTPS_DEFAULT), LLM_HTTPS_DEFAULT)
    assert.equal(playgroundFetchBase('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1')
  })
})

describe('chatCompletionsUrl / healthUrl', () => {
  it('does not double /v1', () => {
    assert.equal(
      chatCompletionsUrl(`${LLM_HTTP_DEFAULT}/v1`),
      `${LLM_PROXY}/v1/chat/completions`,
    )
    assert.equal(chatCompletionsUrl(LLM_PROXY), `${LLM_PROXY}/v1/chat/completions`)
    assert.equal(healthUrl(`${LLM_HTTP_DEFAULT}/v1`), `${LLM_PROXY}/health`)
  })
})

describe('resolveToolsEndpoint', () => {
  const openrouter = {
    openrouterBaseUrl: 'https://openrouter.ai/api/v1',
    openrouterApiKey: 'or-key',
  }

  it('uses the pane when the agent URL is OpenAI /v1', () => {
    const ep = resolveToolsEndpoint({
      ...openrouter,
      paneBaseUrl: `${LLM_HTTP_DEFAULT}/v1`,
      paneApiKey: 'pane-token',
    })
    assert.equal(ep.source, 'pane')
    assert.equal(ep.baseUrl, `${LLM_HTTP_DEFAULT}/v1`)
    assert.equal(ep.apiKey, 'pane-token')
  })

  it('keeps global OpenRouter for bare gateway pane URLs', () => {
    const ep = resolveToolsEndpoint({
      ...openrouter,
      paneBaseUrl: LLM_PROXY,
      paneApiKey: 'pane-token',
    })
    assert.equal(ep.source, 'openrouter')
    assert.equal(ep.baseUrl, openrouter.openrouterBaseUrl)
    assert.equal(ep.apiKey, 'or-key')
  })
})

describe('paneUsesHermesChat', () => {
  it('keeps default proxy panes on tools runtime', () => {
    assert.equal(paneUsesHermesChat('tools', LLM_PROXY), false)
  })

  it('uses gateway chat when runtime is hermes', () => {
    assert.equal(paneUsesHermesChat('hermes', LLM_PROXY), true)
    assert.equal(paneUsesHermesChat('hermes', `${LLM_HTTP_DEFAULT}/v1`), true)
  })

  it('uses tools chat for unrelated OpenAI /v1 hosts', () => {
    assert.equal(paneUsesHermesChat('tools', 'http://127.0.0.1:9000/v1'), false)
  })
})
