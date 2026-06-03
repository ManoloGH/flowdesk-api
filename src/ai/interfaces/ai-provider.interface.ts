export type AiProvider = 'anthropic' | 'openai' | 'ollama' | 'openrouter';

export interface AiProviderConfig {
  provider: AiProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

// Mismo formato que Anthropic — los adaptadores convierten al formato nativo
export interface AiSystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface AiTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface AiChatResult {
  response: string;
  tokensUsed: number;
}

export interface IAiAdapter {
  chatWithTools(params: {
    systemBlocks: AiSystemBlock[];
    historyMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
    userMessage: string;
    tools: AiTool[];
    model: string;
    maxTokens: number;
    maxIterations: number;
    toolExecutor: (name: string, input: Record<string, any>) => Promise<any>;
  }): Promise<AiChatResult>;

  chat(params: {
    systemPrompt: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    model: string;
    maxTokens: number;
  }): Promise<AiChatResult>;
}
