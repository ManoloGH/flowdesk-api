import Anthropic from '@anthropic-ai/sdk';
import { IAiAdapter, AiSystemBlock, AiTool, AiChatResult } from '../interfaces/ai-provider.interface';

export class AnthropicAdapter implements IAiAdapter {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chatWithTools(params: {
    systemBlocks: AiSystemBlock[];
    historyMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
    userMessage: string;
    tools: AiTool[];
    model: string;
    maxTokens: number;
    maxIterations: number;
    toolExecutor: (name: string, input: Record<string, any>) => Promise<any>;
  }): Promise<AiChatResult> {
    const { systemBlocks, historyMessages, userMessage, tools, model, maxTokens, maxIterations, toolExecutor } = params;

    const messages: Anthropic.MessageParam[] = [
      ...historyMessages,
      { role: 'user', content: userMessage },
    ];

    const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool['input_schema'],
    }));

    let totalTokens = 0;

    for (let i = 0; i < maxIterations; i++) {
      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemBlocks as any,
        tools: anthropicTools,
        messages,
      });

      const u = response.usage as any;
      totalTokens +=
        (u?.input_tokens ?? 0) +
        (u?.output_tokens ?? 0) +
        (u?.cache_creation_input_tokens ?? 0) +
        (u?.cache_read_input_tokens ?? 0);

      if (response.stop_reason === 'end_turn') {
        const textBlock = response.content.find(b => b.type === 'text');
        return {
          response: textBlock?.type === 'text' ? textBlock.text : 'Listo.',
          tokensUsed: totalTokens,
        };
      }

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const result = await toolExecutor(block.name, block.input as Record<string, any>);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      break;
    }

    return { response: 'He completado las acciones solicitadas.', tokensUsed: totalTokens };
  }

  async chat(params: {
    systemPrompt: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    model: string;
    maxTokens: number;
  }): Promise<AiChatResult> {
    const { systemPrompt, messages, model, maxTokens } = params;

    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

    return {
      response: textBlock?.type === 'text' ? textBlock.text : '',
      tokensUsed,
    };
  }
}
