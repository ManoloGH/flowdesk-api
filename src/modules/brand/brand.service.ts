import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';

export interface BrandColors {
  primary: string;
  secondary: string;
  tertiary: string;
}

export interface ModuleConfig {
  key:     string;  // coincide con el href sin la barra inicial (ej: 'erp-areas')
  label:   string;
  enabled: boolean;
}

export interface BrandConfig {
  logo_url:       string | null;
  tenant_name:    string | null;
  colors:         BrandColors;
  configured:     boolean;
  modules_config: ModuleConfig[] | null;
}

const DEFAULT_COLORS: BrandColors = {
  primary:   '#1DBDF0',  // fd-cyan
  secondary: '#2566E8',  // fd-blue
  tertiary:  '#E91E7A',  // fd-magenta
};

type SupportedMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

const MIME_MAP: Record<string, SupportedMime> = {
  'image/png':  'image/png',
  'image/jpg':  'image/jpeg',
  'image/jpeg': 'image/jpeg',
  'image/gif':  'image/gif',
  'image/webp': 'image/webp',
};

@Injectable()
export class BrandService {
  private readonly anthropic: Anthropic;

  constructor(private prisma: PrismaService) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  /* ── Public API ── */

  async getBrandConfig(tenantId: string): Promise<BrandConfig> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name:            true,
        logo_url:        true,
        primary_color:   true,
        secondary_color: true,
        campus_config:   true,
        modules_config:  true,
      },
    });

    if (!tenant) return { logo_url: null, tenant_name: null, colors: DEFAULT_COLORS, configured: false, modules_config: null };

    const cfg  = (tenant.campus_config as Record<string, any>) ?? {};
    const configured = Boolean(cfg.brand_configured);

    const colors: BrandColors = {
      primary:   tenant.primary_color   ?? DEFAULT_COLORS.primary,
      secondary: tenant.secondary_color ?? DEFAULT_COLORS.secondary,
      tertiary:  cfg.brand_tertiary     ?? DEFAULT_COLORS.tertiary,
    };

    const modules_config = Array.isArray(tenant.modules_config)
      ? (tenant.modules_config as unknown as ModuleConfig[])
      : null;

    return { logo_url: tenant.logo_url ?? null, tenant_name: tenant.name ?? null, colors, configured, modules_config };
  }

  async extractAndSaveBrand(
    tenantId:    string,
    imageBuffer: Buffer,
    mimeType:    string,
    logoUrl?:    string,
  ): Promise<BrandConfig> {
    const base64 = imageBuffer.toString('base64');
    const validMime: SupportedMime = MIME_MAP[mimeType.toLowerCase()] ?? 'image/png';

    const colors = await this.extractColorsFromBase64(base64, validMime);
    await this.persistBrand(tenantId, colors, logoUrl);

    return this.getBrandConfig(tenantId);
  }

  /* ── Internal ── */

  private async extractColorsFromBase64(
    base64:   string,
    mimeType: SupportedMime,
  ): Promise<BrandColors> {
    try {
      const response = await this.anthropic.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content: [
              {
                type:   'image',
                source: { type: 'base64', media_type: mimeType, data: base64 },
              },
              {
                type: 'text',
                text: `Analiza este logo. Extrae los 3 colores principales de la identidad de marca.
Reglas:
- Ignora fondos blancos/transparentes; usa los colores de los elementos gráficos
- Los colores deben ser vibrantes y funcionar en fondos oscuros (#0A0E1A)
- Si el logo es monocromático, deriva una paleta armónica desde su color principal
Responde SOLO con JSON válido, sin markdown ni explicación:
{"primary":"#RRGGBB","secondary":"#RRGGBB","tertiary":"#RRGGBB"}`,
              },
            ],
          },
        ],
      });

      const text  = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
      const match = text.match(/\{[^}]+\}/);
      if (!match) return DEFAULT_COLORS;

      const parsed = JSON.parse(match[0]) as Partial<BrandColors>;
      return {
        primary:   this.validateHex(parsed.primary)   ?? DEFAULT_COLORS.primary,
        secondary: this.validateHex(parsed.secondary) ?? DEFAULT_COLORS.secondary,
        tertiary:  this.validateHex(parsed.tertiary)  ?? DEFAULT_COLORS.tertiary,
      };
    } catch {
      return DEFAULT_COLORS;
    }
  }

  private async persistBrand(
    tenantId: string,
    colors:   BrandColors,
    logoUrl?: string,
  ): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { campus_config: true },
    });

    const existing = (tenant?.campus_config as Record<string, any>) ?? {};

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        primary_color:   colors.primary,
        secondary_color: colors.secondary,
        ...(logoUrl ? { logo_url: logoUrl } : {}),
        campus_config: {
          ...existing,
          brand_configured: true,
          brand_tertiary:   colors.tertiary,
        },
      },
    });
  }

  private validateHex(value?: string): string | null {
    if (!value) return null;
    const clean = value.trim();
    return /^#[0-9A-Fa-f]{6}$/.test(clean) ? clean : null;
  }
}
