import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly model = 'text-embedding-3-small';
  private readonly apiKey = process.env.OPENAI_API_KEY;

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      this.logger.warn('OPENAI_API_KEY not set — returning zero vector');
      return new Array(1536).fill(0);
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI embedding error: ${response.status} ${err}`);
    }

    const data = await response.json() as { data: { embedding: number[] }[] };
    return data.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) return texts.map(() => new Array(1536).fill(0));

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI embedding batch error: ${response.status} ${err}`);
    }

    const data = await response.json() as { data: { index: number; embedding: number[] }[] };
    return data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
  }

  vectorToSql(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
