import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { OpenAICompatibleAdapter } from './adapters/openai-compatible.adapter';
import { IAiAdapter, AiProvider, AiProviderConfig, AiSystemBlock, AiTool, AiChatResult } from './interfaces/ai-provider.interface';

@Injectable()
export class AiProviderService {
  private readonly adapterCache = new Map<string, IAiAdapter>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly enc: EncryptionService,
  ) {}

  // ─── API pública ─────────────────────────────────────────────────────────────

  async chatWithTools(params: {
    tenantId: string;
    agentRole?: string;       // 'ceo' → Claude | otros → OpenRouter free
    agentAiConfig?: {         // config específica del agente — máxima prioridad
      ai_provider?: string;
      model?: string;
      ai_api_key?: string;
      ai_base_url?: string;
    };
    modelOverride?: string;
    systemBlocks: AiSystemBlock[];
    historyMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
    userMessage: string;
    tools: AiTool[];
    maxTokens?: number;
    maxIterations?: number;
    toolExecutor: (name: string, input: Record<string, any>) => Promise<any>;
  }): Promise<AiChatResult> {
    const config = params.agentAiConfig?.ai_provider
      ? this.buildAgentConfig(params.agentAiConfig)
      : await this.getConfig(params.tenantId, params.agentRole);
    const model = params.modelOverride ?? config.model;
    const adapter = this.getAdapter(config);

    return adapter.chatWithTools({
      systemBlocks: params.systemBlocks,
      historyMessages: params.historyMessages,
      userMessage: params.userMessage,
      tools: params.tools,
      model,
      maxTokens: params.maxTokens ?? 2000,
      maxIterations: params.maxIterations ?? 6,
      toolExecutor: params.toolExecutor,
    });
  }

  async chat(params: {
    tenantId: string;
    agentRole?: string;
    agentAiConfig?: {
      ai_provider?: string;
      model?: string;
      ai_api_key?: string;
      ai_base_url?: string;
    };
    modelOverride?: string;
    systemPrompt: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxTokens?: number;
  }): Promise<AiChatResult> {
    const config = params.agentAiConfig?.ai_provider
      ? this.buildAgentConfig(params.agentAiConfig)
      : await this.getConfig(params.tenantId, params.agentRole);
    const model = params.modelOverride ?? config.model;
    const adapter = this.getAdapter(config);

    return adapter.chat({
      systemPrompt: params.systemPrompt,
      messages: params.messages,
      model,
      maxTokens: params.maxTokens ?? 2000,
    });
  }

  async isConfigured(tenantId: string): Promise<boolean> {
    const config = await this.getConfig(tenantId);
    if (config.provider === 'ollama') return true;
    return !!config.apiKey;
  }

  // ─── Resolución de config por rol ────────────────────────────────────────────

  private async getConfig(tenantId: string, agentRole?: string): Promise<AiProviderConfig> {
    const integration = await this.prisma.integration.findFirst({
      where: { tenant_id: tenantId, provider: 'ai_config' as any, status: 'connected' },
    });

    if (integration?.config) {
      const cfg = integration.config as any;

      if (agentRole === 'ceo') {
        // CEO: lee ceo_ai_provider o cae al proveedor general
        const provider = (cfg.ceo_ai_provider ?? cfg.ai_provider ?? cfg.provider) as AiProvider;
        const model    = cfg.ceo_model ?? cfg.model;
        if (provider && model) {
          let apiKey = cfg.ceo_api_key ?? cfg.apiKey ?? '';
          if (!apiKey && integration.credentials_enc) {
            try { apiKey = this.enc.safeDecrypt(integration.credentials_enc); } catch {}
          }
          return { provider, model, apiKey, baseUrl: cfg.ceo_base_url ?? cfg.base_url ?? undefined };
        }
      } else {
        // Agentes regulares: lee ai_provider
        const provider = (cfg.ai_provider ?? cfg.provider) as AiProvider;
        const model    = cfg.model;
        if (provider && model) {
          let apiKey = cfg.apiKey ?? '';
          if (!apiKey && integration.credentials_enc) {
            try { apiKey = this.enc.safeDecrypt(integration.credentials_enc); } catch {}
          }
          return { provider, model, apiKey, baseUrl: cfg.base_url ?? cfg.baseUrl ?? undefined };
        }
      }
    }

    // Fallback global según rol
    return agentRole === 'ceo' ? this.getCeoGlobalConfig() : this.getAgentGlobalConfig();
  }

  // Construir config directamente desde el agent_config del agente
  private buildAgentConfig(agentAiConfig: {
    ai_provider?: string; model?: string; ai_api_key?: string; ai_base_url?: string;
  }): AiProviderConfig {
    const provider = (agentAiConfig.ai_provider ?? 'openrouter') as AiProvider;
    return {
      provider,
      model: agentAiConfig.model ?? this.defaultModelFor(provider),
      apiKey: agentAiConfig.ai_api_key ?? process.env.AGENT_AI_API_KEY ?? process.env.AI_API_KEY ?? '',
      baseUrl: agentAiConfig.ai_base_url ?? (provider === 'ollama' ? 'http://localhost:11434/v1' : undefined),
    };
  }

  // CEO siempre Anthropic Claude por defecto
  private getCeoGlobalConfig(): AiProviderConfig {
    return {
      provider: 'anthropic',
      model: process.env.CEO_AI_MODEL ?? 'claude-sonnet-4-6',
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    };
  }

  // Agentes de la empresa: OpenRouter free por defecto
  private getAgentGlobalConfig(): AiProviderConfig {
    const provider = (process.env.AGENT_AI_PROVIDER ?? 'openrouter') as AiProvider;
    return {
      provider,
      model: process.env.AGENT_AI_MODEL ?? 'meta-llama/llama-3.3-70b-instruct:free',
      apiKey: process.env.AGENT_AI_API_KEY ?? process.env.AI_API_KEY ?? '',
      baseUrl: process.env.AGENT_AI_BASE_URL ?? (provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : undefined),
    };
  }

  private defaultModelFor(provider: AiProvider): string {
    switch (provider) {
      case 'anthropic':  return 'claude-sonnet-4-6';
      case 'openai':     return 'gpt-4o';
      case 'ollama':     return 'qwen2.5:7b';
      case 'openrouter': return 'meta-llama/llama-3.3-70b-instruct:free';
    }
  }

  // ─── Instanciación de adaptadores con caché ───────────────────────────────────

  private getAdapter(config: AiProviderConfig): IAiAdapter {
    const cacheKey = `${config.provider}:${config.baseUrl ?? ''}:${config.apiKey.slice(0, 8)}`;
    if (this.adapterCache.has(cacheKey)) return this.adapterCache.get(cacheKey)!;
    const adapter = this.buildAdapter(config);
    this.adapterCache.set(cacheKey, adapter);
    return adapter;
  }

  private buildAdapter(config: AiProviderConfig): IAiAdapter {
    switch (config.provider) {
      case 'anthropic':
        return new AnthropicAdapter(config.apiKey);

      case 'openai':
        return new OpenAICompatibleAdapter(config.apiKey);

      case 'ollama':
        return new OpenAICompatibleAdapter(
          config.apiKey || 'ollama',
          config.baseUrl ?? 'http://localhost:11434/v1',
        );

      case 'openrouter':
        return new OpenAICompatibleAdapter(
          config.apiKey,
          config.baseUrl ?? 'https://openrouter.ai/api/v1',
        );
    }
  }
}
