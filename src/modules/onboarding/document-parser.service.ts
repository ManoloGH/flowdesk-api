import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

export interface ParsedDocument {
  source_type: 'company_info' | 'team' | 'processes' | 'financial' | 'audit' | 'other';
  extracted: Record<string, unknown>;
  raw_text: string;
  confidence: 'high' | 'medium' | 'low';
}

@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  async parseText(text: string, hint?: string): Promise<ParsedDocument> {
    const prompt = `Eres un extractor de datos estructurados. Analiza el siguiente documento y extrae toda la información relevante sobre la empresa.

${hint ? `Contexto adicional: ${hint}\n` : ''}

DOCUMENTO:
${text.slice(0, 8000)}

Extrae y devuelve un JSON con esta estructura:
{
  "source_type": "company_info" | "team" | "processes" | "financial" | "audit" | "other",
  "confidence": "high" | "medium" | "low",
  "extracted": {
    // Campos que encuentres — solo incluye los que estén presentes en el documento:
    "company_name": "...",
    "industry": "...",
    "mission": "...",
    "vision": "...",
    "tagline": "...",
    "website": "...",
    "team_members": [{"name": "...", "role": "...", "email": "..."}],
    "products_services": [{"name": "...", "description": "...", "price": "..."}],
    "key_processes": [{"name": "...", "description": "...", "steps": ["..."]}],
    "clients": [{"name": "...", "status": "..."}],
    "kpis": [{"name": "...", "current_value": "...", "target": "..."}],
    "pain_points": ["..."],
    "tools_used": [{"name": "...", "purpose": "..."}],
    "financial": {"mrr": "...", "revenue": "...", "costs": "..."}
  }
}

Responde ÚNICAMENTE con el JSON, sin markdown ni texto adicional.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      const text_block = response.content.find(b => b.type === 'text');
      if (!text_block || text_block.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      const jsonStr = text_block.text.trim();
      const parsed = JSON.parse(jsonStr);

      return {
        source_type: parsed.source_type ?? 'other',
        extracted: parsed.extracted ?? {},
        raw_text: text.slice(0, 2000),
        confidence: parsed.confidence ?? 'medium',
      };
    } catch (err) {
      this.logger.error(`Document parse error: ${(err as Error).message}`);
      return {
        source_type: 'other',
        extracted: {},
        raw_text: text.slice(0, 500),
        confidence: 'low',
      };
    }
  }

  async parseFileBuffer(buffer: Buffer, mimetype: string, hint?: string): Promise<ParsedDocument> {
    // Para PDFs e imágenes usamos la API de Claude con vision
    if (mimetype.startsWith('image/')) {
      return this.parseImageBuffer(buffer, mimetype, hint);
    }

    // Para texto plano, Word, etc. — extraemos como texto
    const text = buffer.toString('utf-8');
    return this.parseText(text, hint);
  }

  private async parseImageBuffer(buffer: Buffer, mimetype: string, hint?: string): Promise<ParsedDocument> {
    const base64 = buffer.toString('base64');
    const mediaType = mimetype as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: `Extrae toda la información de negocio visible en esta imagen${hint ? ` (${hint})` : ''}. Devuelve un JSON con los mismos campos que un documento de empresa: company_name, industry, products_services, team_members, etc. Solo incluye campos que aparezcan en la imagen. Responde ÚNICAMENTE con JSON.`,
            },
          ],
        }],
      });

      const text_block = response.content.find(b => b.type === 'text');
      if (!text_block || text_block.type !== 'text') throw new Error('No text response');

      const parsed = JSON.parse(text_block.text.trim());
      return { source_type: parsed.source_type ?? 'company_info', extracted: parsed, raw_text: '', confidence: 'medium' };
    } catch {
      return { source_type: 'other', extracted: {}, raw_text: '', confidence: 'low' };
    }
  }
}
