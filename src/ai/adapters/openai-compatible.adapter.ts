import OpenAI from 'openai';
import { IAiAdapter, AiSystemBlock, AiTool, AiChatResult } from '../interfaces/ai-provider.interface';

export class OpenAICompatibleAdapter implements IAiAdapter {
  private readonly client: OpenAI;

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, baseURL });
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

    // Concatenar bloques de sistema ignorando cache_control (no soportado en OpenAI)
    const systemText = systemBlocks.map(b => b.text).join('\n\n');

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemText },
      ...historyMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: userMessage },
    ];

    const openAiTools: OpenAI.ChatCompletionTool[] = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    let totalTokens = 0;

    for (let i = 0; i < maxIterations; i++) {
      const response = await this.client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages,
        tools: openAiTools,
        tool_choice: 'auto',
      });

      const choice = response.choices[0];
      totalTokens += (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);

      const hasToolCalls = choice.message.tool_calls && choice.message.tool_calls.length > 0;

      if (choice.finish_reason === 'stop' || !hasToolCalls) {
        return { response: choice.message.content ?? 'Listo.', tokensUsed: totalTokens };
      }

      if (choice.finish_reason === 'tool_calls' || hasToolCalls) {
        messages.push(choice.message);

        const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];
        for (const toolCall of choice.message.tool_calls!) {
          if (toolCall.type !== 'function') continue;
          const input = JSON.parse(toolCall.function.arguments);
          const result = await toolExecutor(toolCall.function.name, input);
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }
        messages.push(...toolResults);
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

    const response = await this.client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ],
    });

    const choice = response.choices[0];
    const tokensUsed = (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);

    return {
      response: choice.message.content ?? '',
      tokensUsed,
    };
  }
}
