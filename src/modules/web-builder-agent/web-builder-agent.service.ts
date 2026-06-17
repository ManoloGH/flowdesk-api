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

const BUILD_SYSTEM = `Eres un experto en landing pages de alta conversión con estética gaming/premium para negocios locales.

OBJETIVO: Una sola página (index.html) que convierte visitas en contactos de WhatsApp o citas agendadas.
No es un sitio informativo — es un embudo visual de 3 pantallas. Sin menú de navegación. Sin secciones extensas.

FILOSOFÍA:
- Cada sección ocupa 100vh — como levels de un juego
- Una sola acción por pantalla
- Texto mínimo: 1 titular + 1 subtítulo + 1 botón por sección
- El botón de WhatsApp flota siempre visible (esquina inferior derecha)
- Animaciones de entrada CSS con Intersection Observer (sin frameworks externos)
- NUNCA inventar datos — usar solo la información proporcionada
- Datos desconocidos: marcar con <!-- REVISAR -->

TIPOGRAFÍA (Google Fonts CDN obligatorio):
- Titulares: Bebas Neue (mayúsculas, impacto máximo)
- Cuerpo: Inter (legibilidad)

ESTRUCTURA — 3 SECCIONES:

──────────────────────────────────────────────
SECCIÓN 1: HERO (100vh, id="hero")
──────────────────────────────────────────────
- Comentario exacto: <!-- SCROLL-VIDEO-SECTION -->
- <video id="heroVideo" src="assets/hero.mp4" poster="assets/hero-poster.jpg" playsinline muted loop preload="auto">
- Si no hay video: gradiente oscuro animado de alto contraste como fondo
- Overlay semitransparente 60% sobre el video
- Titular: máx 5 palabras, Bebas Neue, 80px clamp, blanco, MAYÚSCULAS
- Subtítulo: máx 12 palabras, lo que el cliente gana (resultado concreto)
- Botón CTA: "ESCRÍBENOS POR WHATSAPP" — fondo #25D366, glow animado verde
  href="https://wa.me/521XXXXXXXXXX?text=Hola%2C%20quiero%20información"

──────────────────────────────────────────────
SECCIÓN 2: PRUEBA SOCIAL (100vh, id="prueba")
──────────────────────────────────────────────
- 1 número grande que impresiona (años de experiencia, clientes atendidos, o trabajos completados)
  Con animación counter JS que cuenta hasta el número cuando entra en viewport
- 2 testimonios cortos (máx 2 líneas cada uno, con nombre y ciudad)
- Botón: "ESCRÍBENOS AHORA" → mismo link de WhatsApp que el hero

──────────────────────────────────────────────
SECCIÓN 3: CTA FINAL (100vh, id="cta-final")
──────────────────────────────────────────────
- Frase de garantía o urgencia: máx 8 palabras en Bebas Neue grande
- Número de teléfono clickable: <a href="tel:+52XXXXXXXXXX">
- Botón "CONTÁCTANOS POR WHATSAPP" grande con efecto pulse — mismo link WhatsApp
- Footer mínimo dentro de esta sección: nombre empresa + © año

CSS GAMING OBLIGATORIO (todo en <style> inline, sin frameworks):
:root { --primary: [color del negocio o #6366f1]; --dark: #0a0a12; --light: #f3f4f6; --wa: #25D366; }
- Secciones: fondo oscuro, display flex, align-items center, justify-content center, flex-direction column
- Animación de entrada: cada sección con clase .reveal (opacity:0, translateY 40px) → visible con Intersection Observer
- Botón CTA principal: box-shadow 0 0 30px var(--wa), transition, hover scale(1.06)
- Counter: JS que anima el número del 0 al valor real en 2s cuando entra en viewport
- Botón WhatsApp flotante: position fixed, bottom 24px, right 24px, width 60px, height 60px,
  border-radius 50%, background var(--wa), animation pulse 2s infinite
- @keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(37,211,102,.5)} 70%{box-shadow:0 0 0 16px transparent} }
- @keyframes fadeUp { from{opacity:0;transform:translateY(40px)} to{opacity:1;transform:translateY(0)} }
- Hover en todos los botones: transform scale(1.05), transition 0.2s ease

BOTÓN WHATSAPP FLOTANTE (siempre visible, fuera de las secciones):
<a href="https://wa.me/521XXXXXXXXXX?text=..." class="wa-float" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">
  <svg viewBox="0 0 32 32" fill="white" width="32" height="32">
    <path d="M16 1C7.73 1 1 7.73 1 16c0 2.64.69 5.1 1.89 7.24L1 31l8.01-2.1A15 15 0 0016 31c8.27 0 15-6.73 15-15S24.27 1 16 1zm0 27.5a12.46 12.46 0 01-6.35-1.74l-.45-.27-4.76 1.25 1.26-4.63-.3-.48A12.5 12.5 0 1116 28.5zm6.85-9.37c-.37-.19-2.2-1.09-2.54-1.21-.34-.12-.59-.19-.84.19s-.96 1.21-1.18 1.46-.43.28-.8.09a10.1 10.1 0 01-2.97-1.83 11.17 11.17 0 01-2.06-2.56c-.21-.37 0-.57.16-.75.15-.16.37-.43.56-.65.18-.21.25-.37.37-.62.12-.25.06-.46-.03-.65-.09-.19-.84-2.03-1.15-2.78-.3-.72-.61-.62-.84-.63h-.71c-.25 0-.65.09-.99.46s-1.3 1.27-1.3 3.09 1.33 3.58 1.52 3.83c.18.25 2.62 4 6.35 5.61.89.38 1.58.61 2.12.78.89.28 1.7.24 2.34.15.71-.11 2.2-.9 2.51-1.77.31-.87.31-1.62.22-1.77-.09-.16-.34-.25-.71-.44z"/>
  </svg>
</a>

JAVASCRIPT (inline antes de </body>):
1. Intersection Observer para .reveal (animar secciones al entrar en viewport)
2. Counter animation para el número grande de sección 2
3. El script de scroll-video se añadirá en el siguiente paso (no incluir aquí)

FORMATO — devuelve SOLO este JSON (sin markdown):
{"index.html": "<!DOCTYPE html>..."}`;

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

Esta es una landing page de una sola página enfocada en conversión (WhatsApp / cita).
Aplica lo siguiente a index.html:
- <title>: [Keyword principal] en [Ciudad] | [Empresa] (máx 60 chars)
- <meta name="description">: 140-160 chars, incluye CTA ("Llama o escríbenos por WhatsApp")
- Open Graph y Twitter Card completos (og:locale es_MX, og:type website)
- <link rel="preconnect"> a fonts.googleapis.com y fonts.gstatic.com
- <link rel="preload" as="image" href="assets/hero-poster.jpg">
- Un solo <h1> con keyword principal + ciudad
- Alt text en todas las imágenes
- Schema.org JSON-LD en <head> según sector:
  mudanzas→MovingCompany, restaurante→Restaurant, clínica→MedicalBusiness,
  abogados→LegalService, fontanería/electricidad→HomeAndConstructionBusiness,
  default→LocalBusiness
  Incluir: name, telephone, address (addressLocality), url, sameAs vacío []

Devuelve SOLO este JSON (sin markdown):
{"index.html":"...html completo con SEO aplicado...","sitemap.xml":"...xml...","robots.txt":"..."}`;

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
    await log('pages', 'Construyendo landing page gaming con 3 pantallas...');
    const rawPages = await this.buildPages(businessData, dto.logo_url);
    await log('pages', 'Landing page generada — hero, prueba social, CTA final', 'done');

    // ── Fase 3: Añadir efecto scroll al hero ───────────────────────────────────
    await log('scroll', 'Añadiendo efecto scroll cinematográfico al hero...');
    const indexWithScroll = await this.applyScrollEffect(rawPages['index.html']);
    const pagesWithScroll = { ...rawPages, 'index.html': indexWithScroll };
    await log('scroll', 'Efecto scroll aplicado', 'done');

    // ── Fase 4: SEO completo ───────────────────────────────────────────────────
    await log('seo', 'Optimizando SEO, Schema.org y performance...');
    const finalFiles = await this.applySeo(pagesWithScroll, businessData);
    await log('seo', 'SEO local, Schema.org, sitemap.xml y robots.txt aplicados', 'done');

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
      max_tokens: 8000,
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
