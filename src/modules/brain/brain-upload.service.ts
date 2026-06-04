import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

export interface ExtractedFile {
  title: string;
  content: string;
  source_type: 'document' | 'sop' | 'culture' | 'decision' | 'other';
  mimetype: string;
}

@Injectable()
export class BrainUploadService {
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  async extractFromBuffer(
    buffer: Buffer,
    mimetype: string,
    originalName: string,
    hint?: string,
  ): Promise<ExtractedFile> {
    const title = originalName.replace(/\.[^.]+$/, '');

    if (mimetype.startsWith('image/')) {
      return this.extractFromImage(buffer, mimetype, title, hint);
    }

    if (mimetype === 'application/pdf') {
      return this.extractFromPdf(buffer, title, hint);
    }

    // Texto plano, markdown, CSV, JSON, DOCX como texto
    const raw = buffer.toString('utf-8').replace(/\0/g, ' ').trim();
    return this.summarizeText(raw, title, hint);
  }

  private async extractFromPdf(buffer: Buffer, title: string, hint?: string): Promise<ExtractedFile> {
    try {
      const base64 = buffer.toString('base64');
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            } as any,
            {
              type: 'text',
              text: this.buildPrompt(title, hint),
            },
          ],
        }],
      });

      const text = response.content.find(b => b.type === 'text');
      const raw = text?.type === 'text' ? text.text : '';
      return this.parseResponse(raw, title);
    } catch {
      // Fallback: extraer texto plano del buffer
      const raw = buffer.toString('utf-8').replace(/\0/g, ' ').trim().slice(0, 8000);
      return this.summarizeText(raw, title, hint);
    }
  }

  private async extractFromImage(buffer: Buffer, mimetype: string, title: string, hint?: string): Promise<ExtractedFile> {
    const base64 = buffer.toString('base64');
    const mediaType = mimetype as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

    const response = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: this.buildPrompt(title, hint) },
        ],
      }],
    });

    const text = response.content.find(b => b.type === 'text');
    const raw = text?.type === 'text' ? text.text : '';
    return this.parseResponse(raw, title);
  }

  private async summarizeText(text: string, title: string, hint?: string): Promise<ExtractedFile> {
    if (text.length < 200) {
      return { title, content: text, source_type: 'other', mimetype: 'text/plain' };
    }

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: `${this.buildPrompt(title, hint)}\n\nDOCUMENTO:\n${text.slice(0, 8000)}` }],
        }],
      });

      const block = response.content.find(b => b.type === 'text');
      const raw = block?.type === 'text' ? block.text : text.slice(0, 3000);
      return this.parseResponse(raw, title);
    } catch {
      return { title, content: text.slice(0, 5000), source_type: 'other', mimetype: 'text/plain' };
    }
  }

  private buildPrompt(title: string, hint?: string): string {
    return `Eres un asistente que procesa documentos de empresa para una base de conocimiento.
Archivo: "${title}"${hint ? `\nContexto: ${hint}` : ''}

Extrae y resume el contenido de forma clara y útil. Devuelve un JSON:
{
  "source_type": "document" | "sop" | "culture" | "decision" | "other",
  "content": "resumen completo y detallado del documento, conservando datos importantes como nombres, números, fechas, procesos y decisiones"
}

Responde ÚNICAMENTE con el JSON, sin markdown.`;
  }

  private parseResponse(raw: string, title: string): ExtractedFile {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match?.[0] ?? raw);
      return {
        title,
        content: parsed.content ?? raw,
        source_type: parsed.source_type ?? 'document',
        mimetype: 'application/octet-stream',
      };
    } catch {
      return { title, content: raw.slice(0, 5000), source_type: 'document', mimetype: 'application/octet-stream' };
    }
  }
}
