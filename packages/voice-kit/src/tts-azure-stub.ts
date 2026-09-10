import type { TtsProvider, TtsResult, TtsSpeakOptions } from './types.js'

export interface AzureFoundryTtsOptions {
  /** Azure AI Foundry / Speech endpoint */
  endpoint: string
  apiKey: string
  deployment?: string
  defaultVoice?: string
}

/**
 * Stub — Azure Foundry / Speech TTS behind the same TtsProvider iface.
 * Throws until endpoint contract is confirmed for this deployment.
 */
export class AzureFoundryTts implements TtsProvider {
  readonly id = 'azure-foundry'
  private readonly endpoint: string
  private readonly apiKey: string
  private readonly deployment?: string
  private readonly defaultVoice?: string

  constructor(options: AzureFoundryTtsOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.deployment = options.deployment
    this.defaultVoice = options.defaultVoice
  }

  async speak(text: string, opts: TtsSpeakOptions = {}): Promise<TtsResult> {
    void text
    void opts
    void this.endpoint
    void this.apiKey
    void this.deployment
    void this.defaultVoice
    throw new Error(
      'AzureFoundryTts: stub only — wire Speech REST or Foundry deployment before use',
    )
  }
}

/**
 * Stub — Azure Speech STT (not Speaches). Same pattern as Foundry TTS.
 */
export class AzureFoundryStt {
  readonly id = 'azure-foundry-stt'
  async prepare(): Promise<void> {
    /* no-op */
  }
  async transcribe(): Promise<never> {
    throw new Error('AzureFoundryStt: stub only — not implemented')
  }
}
