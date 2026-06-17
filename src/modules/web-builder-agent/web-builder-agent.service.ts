import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';
import { PresenceGateway } from '../presence/presence.gateway';
import { StartBuildDto, DeployDto } from './dto/start-build.dto';

// ─── Prompts del agente ───────────────────────────────────────────────────────

const EXTRACT_SYSTEM = `Eres un experto en análisis de negocios. Dado el código HTML de un sitio web, extrae la información clave del negocio.

Devuelve SOLO JSON válido (sin markdown, sin explicación), con esta estructura exacta:
{
  "nombre": "nombre exacto de la empresa",
  "slogan": "slogan o frase principal",
  "telefono": "número principal",
  "email": "email principal",
  "direccion": "dirección física si aparece",
  "ciudad": "ciudad o zona principal",
  "sector": "sector del negocio (ej: mudanzas, fontanería, restaurante)",
  "servicios": ["servicio 1", "servicio 2"],
  "zonas": ["zona 1", "zona 2"],
  "anos_experiencia": null,
  "color_primario": "#xxxxxx o null",
  "elemento_visual": "descripción del elemento visual principal (ej: camión de mudanzas, herramientas de fontanería)",
  "testimonios": []
}`;

const BUILD_SYSTEM = `Eres un experto desarrollador web que crea sitios profesionales y modernos para negocios locales.

REGLAS OBLIGATORIAS:
- CSS propio en <style> dentro de cada HTML (sin frameworks externos)
- Google Fonts vía CDN (elige tipografía profesional, no Arial)
- Variables CSS para colores: --color-primary, --color-dark, etc.
- Responsive mobile-first con Grid y Flexbox
- NUNCA inventar información — solo usar los datos proporcionados
- Marcar datos desconocidos con <!-- REVISAR -->
- Header sticky con logo, menú y teléfono clickable

ESTRUCTURA hero de index.html:
- Comentario <!-- SCROLL-VIDEO-SECTION --> para identificar la sección
- Video: <video id="heroVideo" src="assets/hero.mp4" poster="assets/hero-poster.jpg" playsinline muted loop preload="auto">
- Si no hay video, usar hero con gradiente CSS animado como fallback
- Fondo semitransparente al 60% sobre el video

SECCIONES OBLIGATORIAS en index.html:
1. Hero con video/gradiente
2. Por qué elegirnos (3-4 puntos de valor)
3. Servicios (tarjetas visuales, máx 6)
4. Números de confianza (años, trabajos, zonas)
5. Testimonios (si existen)
6. CTA final con teléfono
7. Footer con logo, navegación y copyright

FORMATO DE SALIDA — devuelve SOLO este JSON (sin markdown):
{"index.html": "<!DOCTYPE html>...", "servicios.html": "<!DOCTYPE html>...", "nosotros.html": "<!DOCTYPE html>...", "contacto.html": "<!DOCTYPE html>..."}`;

const SCROLL_SYSTEM = `Eres un experto en JavaScript. Añade el efecto de vídeo controlado por scroll al hero de index.html.

El efecto: el vídeo avanza fotograma a fotograma sincronizado con el scroll del usuario (efecto Apple iPhone).
En móvil: autoplay normal.

Busca el comentario <!-- SCROLL-VIDEO-SECTION --> en el HTML.

CSS a añadir dentro del <style> existente:
.scroll-video-hero { height: 500vh; position: relative; }
.scroll-video-sticky { position: sticky; top: 0; height: 100vh; width: 100%; overflow: hidden; }
.scroll-video-sticky video { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; }
.hero-content { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 2; background: rgba(0,0,0,0.55); color: white; text-align: center; padding: 0 20px; }
.scroll-progress-bar { position: absolute; bottom: 0; left: 0; width: 100%; height: 4px; background: rgba(255,255,255,0.2); z-index: 3; }
.scroll-progress-fill { height: 100%; width: 0%; background: var(--color-primary, #6366f1); transition: width 0.05s linear; }
@media (max-width: 768px) { .scroll-video-hero { height: 100vh; } .scroll-video-sticky { position: relative; } }

JS a añadir antes de </body>:
(function(){const v=document.getElementById('heroVideo');const h=document.getElementById('scroll-hero');const pf=document.getElementById('progressFill');if(!v||!h)return;if(window.matchMedia('(max-width:768px)').matches){v.autoplay=true;v.loop=true;v.play().catch(()=>{});return;}v.pause();v.currentTime=0;let ready=false;v.addEventListener('loadedmetadata',()=>{ready=true;});v.load();function update(){if(!ready||!v.duration)return;const r=h.getBoundingClientRect();const sc=-r.top;const sl=h.offsetHeight-window.innerHeight;if(sc<=0){v.currentTime=0;if(pf)pf.style.width='0%';return;}if(sc>=sl){v.currentTime=v.duration;if(pf)pf.style.width='100%';return;}const p=sc/sl;v.currentTime=p*v.duration;if(pf)pf.style.width=(p*100)+'%';}let tick=false;window.addEventListener('scroll',()=>{if(!tick){requestAnimationFrame(()=>{update();tick=false;});tick=true;}},{passive:true});window.addEventListener('resize',update);})();

Devuelve SOLO el HTML completo de index.html modificado (sin JSON wrapper, sin markdown).`;

const SEO_SYSTEM = `Eres un experto en SEO on-page para negocios locales en México.

Aplica a cada página:
- Title: [Keyword] en [Ciudad] | [Empresa] (máx 60 chars)
- Meta description: 140-160 chars con CTA
- Open Graph y Twitter Card completos (og:locale es_MX)
- Schema.org JSON-LD apropiado para el sector en index.html
- BreadcrumbList en las 3 páginas interiores
- Un solo H1 por página con keyword + ciudad
- Alt text descriptivo en todas las imágenes
- loading="lazy" en imágenes no críticas
- Preconnect a Google Fonts en todas las páginas
- Solo en index.html: <link rel="preload" as="image" href="assets/hero-poster.jpg">

Schema según sector: mudanzas→MovingCompany, restaurante→Restaurant, clínica→MedicalBusiness, abogados→LegalService, fontanería/electricidad→HomeAndConstructionBusiness, default→LocalBusiness

Devuelve SOLO este JSON (sin markdown):
{"index.html":"...html completo...", "servicios.html":"...","nosotros.html":"...","contacto.html":"...","sitemap.xml":"...xml...","robots.txt":"..."}`;

// ─── Servicio ─────────────────────────────────────────────────────────────────

interface BuildEvent {
  phase: string;
  message: string;
  status: 'running' | 'done' | 'error';
  ts: string;
}

@Injectable()
export class WebBuilderAgentService {
  private readonly anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  constructor(
    private prisma: PrismaService,
    private presence: PresenceGateway,
  ) {}

  // ─── API pública ────────────────────────────────────────────────────────────

  async startBuild(tenantId: string, slotId: string, proyectoId: string, dto: StartBuildDto) {
    const proyecto = await this.getAndVerify(tenantId, proyectoId);

    await this.prisma.webProyecto.update({
      where: { id: proyectoId },
      data: {
        html_original: dto.html_original,
        logo_url: dto.logo_url ?? proyecto.logo_url,
        build_log: [],
        fase: 'assets',
      },
    });

    // Proceso asíncrono en background
    this.runPipeline(tenantId, slotId, proyectoId, proyecto.slug, dto).catch(err => {
      this.emit(slotId, proyectoId, 'error', String(err.message ?? err), 'error');
      this.prisma.webProyecto.update({
        where: { id: proyectoId },
        data: { fase: 'assets' },
      }).catch(() => {});
    });

    return { status: 'started', proyectoId };
  }

  async getFiles(tenantId: string, proyectoId: string) {
    const p = await this.getAndVerify(tenantId, proyectoId);
    return { files: p.files ?? {}, fase: p.fase };
  }

  async deployToVercel(tenantId: string, slotId: string, proyectoId: string, dto: DeployDto) {
    const proyecto = await this.getAndVerify(tenantId, proyectoId);
    const files = proyecto.files as Record<string, string> | null;
    if (!files || Object.keys(files).length === 0) {
      throw new BadRequestException('El proyecto no tiene archivos generados. Ejecuta la construcción primero.');
    }

    const token = process.env.VERCEL_TOKEN;
    if (!token) throw new BadRequestException('VERCEL_TOKEN no configurado en el servidor.');

    const projectName = dto.project_name ?? `web-${proyecto.slug}`;

    this.emit(slotId, proyectoId, 'deploy', 'Subiendo archivos a Vercel...', 'running');

    const body: any = {
      name: projectName,
      files: Object.entries(files).map(([file, data]) => ({
        file,
        data: Buffer.from(data, 'utf-8').toString('base64'),
        encoding: 'base64',
      })),
      projectSettings: { framework: null },
      target: 'production',
    };

    if (process.env.VERCEL_TEAM_ID) body.teamId = process.env.VERCEL_TEAM_ID;

    const res = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const result = await res.json() as any;
    if (!res.ok) throw new BadRequestException(result.error?.message ?? 'Error al desplegar en Vercel');

    const vercel_url = `https://${result.url}`;
    await this.prisma.webProyecto.update({
      where: { id: proyectoId },
      data: { vercel_url, vercel_project_id: result.projectId, fase: 'publicado' },
    });

    this.emit(slotId, proyectoId, 'deploy', `¡Publicado! ${vercel_url}`, 'done');
    this.presence.emitToSlot(slotId, 'web-builder:complete', { proyectoId, vercel_url });

    return { vercel_url };
  }

  // ─── Pipeline principal ─────────────────────────────────────────────────────

  private async runPipeline(
    tenantId: string,
    slotId: string,
    proyectoId: string,
    slug: string,
    dto: StartBuildDto,
  ) {
    const log = (phase: string, message: string, status: BuildEvent['status'] = 'running') => {
      this.emit(slotId, proyectoId, phase, message, status);
      return this.appendLog(proyectoId, { phase, message, status, ts: new Date().toISOString() });
    };

    // ── Fase 1: Extraer datos del negocio ──────────────────────────────────────
    await log('extract', 'Analizando el contenido del negocio...');
    const businessData = await this.extractBusinessData(dto.html_original);
    await log('extract', `Datos extraídos: ${businessData.nombre} · ${businessData.sector}`, 'done');

    // ── Fase 2: Construir las 4 páginas HTML ───────────────────────────────────
    await log('pages', 'Construyendo las 4 páginas HTML...');
    const rawPages = await this.buildPages(businessData, dto.logo_url);
    await log('pages', 'index.html, servicios.html, nosotros.html, contacto.html generados', 'done');

    // ── Fase 3: Añadir efecto scroll al hero ───────────────────────────────────
    await log('scroll', 'Añadiendo efecto scroll cinematográfico al hero...');
    const indexWithScroll = await this.applyScrollEffect(rawPages['index.html']);
    const pagesWithScroll = { ...rawPages, 'index.html': indexWithScroll };
    await log('scroll', 'Efecto scroll aplicado', 'done');

    // ── Fase 4: SEO completo ───────────────────────────────────────────────────
    await log('seo', 'Optimizando SEO, Schema.org y performance...');
    const finalFiles = await this.applySeo(pagesWithScroll, businessData);
    await log('seo', 'SEO, sitemap.xml y robots.txt aplicados', 'done');

    // ── Guardar archivos y actualizar fase ─────────────────────────────────────
    await this.prisma.webProyecto.update({
      where: { id: proyectoId },
      data: { files: finalFiles, fase: 'seo' },
    });

    await log('ready', '¡Web lista! Revisa la vista previa y publica cuando quieras.', 'done');
    this.presence.emitToSlot(slotId, 'web-builder:ready', {
      proyectoId,
      fileCount: Object.keys(finalFiles).length,
    });
  }

  // ─── Llamadas a Claude ──────────────────────────────────────────────────────

  private async extractBusinessData(html: string): Promise<Record<string, any>> {
    const truncated = html.slice(0, 80_000); // Evitar exceder límites
    const msg = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: EXTRACT_SYSTEM,
      messages: [{ role: 'user', content: `HTML del cliente:\n\n${truncated}` }],
    });
    return this.parseJson(this.getText(msg));
  }

  private async buildPages(data: Record<string, any>, logoUrl?: string): Promise<Record<string, string>> {
    const msg = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: BUILD_SYSTEM,
      messages: [{
        role: 'user',
        content: `Datos del negocio:
${JSON.stringify(data, null, 2)}

Logo URL: ${logoUrl ?? 'assets/logo.png'}
Video hero: assets/hero.mp4
Poster hero: assets/hero-poster.jpg

Genera las 4 páginas HTML completas.`,
      }],
    });
    return this.parseJson(this.getText(msg));
  }

  private async applyScrollEffect(indexHtml: string): Promise<string> {
    const msg = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 12000,
      system: SCROLL_SYSTEM,
      messages: [{
        role: 'user',
        content: `index.html actual:\n\n${indexHtml}`,
      }],
    });
    return this.getText(msg).trim();
  }

  private async applySeo(
    pages: Record<string, string>,
    data: Record<string, any>,
  ): Promise<Record<string, string>> {
    const msg = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: SEO_SYSTEM,
      messages: [{
        role: 'user',
        content: `Datos del negocio: ${JSON.stringify({ nombre: data.nombre, sector: data.sector, ciudad: data.ciudad, telefono: data.telefono, email: data.email })}

Páginas a optimizar:
${JSON.stringify(pages)}`,
      }],
    });
    return this.parseJson(this.getText(msg));
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private getText(msg: Anthropic.Message): string {
    const block = msg.content[0];
    if (block.type !== 'text') throw new Error('Respuesta inesperada de Claude');
    return block.text;
  }

  private parseJson(text: string): any {
    const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch { /**/ }
      }
      throw new Error(`No se pudo parsear la respuesta JSON de Claude. Respuesta: ${cleaned.slice(0, 200)}`);
    }
  }

  private emit(
    slotId: string,
    proyectoId: string,
    phase: string,
    message: string,
    status: BuildEvent['status'],
  ) {
    this.presence.emitToSlot(slotId, 'web-builder:progress', {
      proyectoId, phase, message, status, ts: new Date().toISOString(),
    });
  }

  private async appendLog(proyectoId: string, event: BuildEvent) {
    const p = await this.prisma.webProyecto.findUnique({
      where: { id: proyectoId },
      select: { build_log: true },
    });
    const log = Array.isArray(p?.build_log) ? p.build_log : [];
    await this.prisma.webProyecto.update({
      where: { id: proyectoId },
      data: { build_log: [...(log as any[]), event] },
    });
  }

  private async getAndVerify(tenantId: string, proyectoId: string) {
    const p = await this.prisma.webProyecto.findFirst({
      where: { id: proyectoId, tenant_id: tenantId },
    });
    if (!p) throw new NotFoundException('Proyecto web no encontrado');
    return p;
  }
}
