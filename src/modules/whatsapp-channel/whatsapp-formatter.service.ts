import { Injectable } from '@nestjs/common';

@Injectable()
export class WhatsAppFormatterService {
  // WhatsApp usa su propio subset de markdown, diferente al estándar
  toWhatsApp(text: string): string {
    return text
      .replace(/\*\*(.*?)\*\*/gs, '*$1*')        // **bold** → *bold*
      .replace(/__(.*?)__/gs, '_$1_')              // __italic__ → _italic_
      .replace(/^#{1,6}\s+(.*)/gm, '*$1*')         // # Header → *Header*
      .replace(/~~(.*?)~~/gs, '~$1~')              // ~~strike~~ → ~strike~
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')          // [text](url) → text (WhatsApp no soporta links inline)
      .trim();
  }

  // Trunca la respuesta si es muy larga para WhatsApp (límite ~4096 chars)
  truncate(text: string, maxLength = 3800): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '\n\n_[Respuesta recortada — continúa en FlowDesk]_';
  }

  format(text: string): string {
    return this.truncate(this.toWhatsApp(text));
  }
}
