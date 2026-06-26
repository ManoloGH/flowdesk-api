import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';
import { PresenceGateway } from '../presence/presence.gateway';
import { StartBuildDto, DeployDto, StartFromBriefDto, StartFromInstagramDto } from './dto/start-build.dto';

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

const BUILD_SYSTEM = `Eres un experto en diseño web premium para negocios. Generas webs de una sola página con animaciones de scroll que parecen hechas por una agencia de diseño top.

REGLA FUNDAMENTAL: NUNCA inventes datos del negocio. Todo contenido viene del contexto proporcionado. Datos desconocidos: marcar con <!-- REVISAR: [qué falta] -->.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PASO 1: DETECTAR SECTOR Y ELEGIR ESTILO VISUAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Analiza el sector del negocio y aplica estas guías:

RESTAURANTE / BAR / CAFETERÍA
- Tema: OSCURO (fondo #0d0d0d, acentos dorados/terracota o del color de marca)
- Tipografía: Playfair Display (titulares), Lato (cuerpo)
- Sección estrella: "Nuestra Carta" con categorías y precios reales
- CTA principal: "RESERVA TU MESA" o "VER LA CARTA"
- Tono: sensorial, evocador — las palabras deben hacer sentir el sabor y el ambiente

GIMNASIO / CROSSFIT / DEPORTES
- Tema: OSCURO (negro + color de marca saturado)
- Tipografía: Bebas Neue (titulares), Inter (cuerpo)
- Sección estrella: "Planes" con tabla comparativa, plan recomendado destacado
- CTA: "EMPIEZA TU PRUEBA GRATIS"
- Tono: energético, directo, motivacional

PELUQUERÍA / BARBERÍA / ESTÉTICA / SPA
- Tema: OSCURO elegante (negro + dorado o rosé)
- Tipografía: Cormorant Garamond (titulares), Raleway (cuerpo)
- Sección estrella: "Servicios" con precios detallados
- CTA: "PIDE TU CITA"
- Tono: cuidado, sofisticado, personal

CLÍNICA / MÉDICO / SALUD
- Tema: CLARO (blanco #ffffff, fondo secciones #f8fafc, acentos azul/verde suave)
- Tipografía: Nunito (titulares), Inter (cuerpo)
- Sección estrella: "Especialidades" o "Tratamientos" con descripción + icono
- CTA: "AGENDA TU CITA"
- Tono: profesional, confiable, cercano — sin tecnicismos innecesarios

ESTUDIO CREATIVO / AGENCIA / FREELANCE
- Tema: OSCURO o CLARO según la paleta de marca
- Tipografía: Space Grotesk (titulares), Inter (cuerpo)
- Sección estrella: "Proyectos" o "Portfolio" con trabajos reales
- CTA: "HABLEMOS DE TU PROYECTO"
- Tono: seguro, creativo, directo

SERVICIOS DEL HOGAR (fontanería, electricidad, mudanzas, reformas)
- Tema: OSCURO (dark + color de marca)
- Tipografía: Bebas Neue (titulares), Inter (cuerpo)
- Sección estrella: "Servicios" con lista visual + precios aproximados si existen
- CTA: "LLÁMANOS AHORA" o "ESCRÍBENOS"
- Tono: confiable, urgente, práctico

TIENDA / COMERCIO LOCAL
- Tema: adaptar a la categoría del producto
- Tipografía: según estilo de marca
- Sección estrella: "Productos destacados" con precios reales
- CTA: "VER PRODUCTOS" / "VISÍTANOS"

DEFAULT (cualquier otro sector)
- Tema: OSCURO premium
- Tipografía: Bebas Neue (titulares), Inter (cuerpo)
- Estructura: hero + servicios + prueba social + contacto

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PASO 2: ESTRUCTURA DE SECCIONES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NAVEGACIÓN FIJA (siempre incluir cuando hay 3+ secciones de contenido)
- sticky top:0, fondo semi-transparente + backdrop-filter:blur(12px)
- Logo a la izquierda, links a secciones, botón CTA a la derecha
- Scroll suave entre secciones

HERO (100vh, id="hero") — SIEMPRE
- Comentario exacto: <!-- SCROLL-VIDEO-SECTION -->
- <video id="heroVideo" src="assets/hero.mp4" poster="assets/hero-poster.jpg" playsinline muted loop preload="auto">
- Si no hay video: fondo visual impactante (gradiente animado o imagen CSS)
- Overlay sobre el video adaptado al sector (oscuro para negocios oscuros, más sutil para claros)
- Titular: máx 6 palabras · tipografía del sector · clamp(56px,7vw,100px)
- Subtítulo: lo que el cliente gana en concreto (máx 15 palabras)
- Botón CTA principal adaptado al sector
- Scroll indicator animado

SOBRE NOSOTROS (altura auto, padding generoso) — si se tienen datos reales
- Texto descriptivo con la historia/propósito real del negocio
- Estadísticas reales (años, clientes, servicios) con counter JS animado al entrar en viewport
- NUNCA inventar estadísticas

SECCIÓN ESTRELLA (altura auto, padding generoso) — SIEMPRE — nombre adaptado al sector
- Contenido real del negocio: servicios, carta, planes, portfolio, especialidades
- Precios reales si los hay; si no, omitir precio sin poner placeholder visible
- Grid o lista visual según lo que mejor encaje
- Hover effects en cards

GALERÍA (altura auto) — SOLO si hay fotos o el usuario la pidió
- Con fotos: rutas relativas a assets/
- Sin fotos: omitir completamente (no poner placeholders)

TESTIMONIOS (altura auto) — SOLO si hay testimonios reales proporcionados
- Exactamente los testimonios que se dieron, sin añadir ni inventar
- Si no hay testimonios: OMITIR ESTA SECCIÓN COMPLETAMENTE

CONTACTO + FOOTER (min-height auto)
- Datos reales: teléfono, email, dirección
- Teléfono: <a href="tel:..."> clickable
- Formulario de contacto simple (nombre, email, mensaje) si hay email real
- REDES SOCIALES: SOLO si existen URLs reales en los datos. Usar iconos SVG inline para cada red:
  · Instagram: SVG del logo de Instagram (gradiente rojo-naranja)
  · Facebook: SVG logo azul
  · TikTok: SVG logo negro/blanco
  · YouTube: SVG logo rojo
  · LinkedIn: SVG logo azul
  · Twitter/X: SVG logo negro
  Los iconos van en fila horizontal, tamaño 24px, con link a la URL real y hover: transform scale(1.15)
  No mostrar ninguna red si su URL no fue proporcionada
- WhatsApp: botón grande o link final → wa.me/{telefono}?text=...
- Footer: nombre empresa + © año actual

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PASO 3: EFECTOS DE SCROLL OBLIGATORIOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Implementar con Intersection Observer nativo (sin librerías):

1. REVEAL ANIMATIONS: elementos entran con fade + slide al hacer scroll
   .reveal { opacity:0; transform:translateY(40px); transition:opacity .8s ease,transform .8s ease; }
   .reveal.visible { opacity:1; transform:translateY(0); }
   Stagger en grids: transition-delay incremental por item

2. COUNTER ANIMATION: números de estadísticas cuentan de 0 al valor real en 2s al entrar en viewport

3. PARALLAX: al menos 1 elemento con movimiento diferencial en scroll (background-position o transform)

4. HOVER en cards: transform:translateY(-4px) + box-shadow elevado, transition 0.2s ease

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PASO 4: CSS Y BOTÓN WHATSAPP FLOTANTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CSS (todo en <style> inline, sin frameworks):
:root { --primary: [color real o derivado del sector]; --dark: #0a0a12; --light: #f8fafc; --wa: #25D366; }
- Tipografía: cargar desde Google Fonts CDN según sector
- Responsive: funcionar bien en móvil (320px) y desktop (1440px)
- Max-width 1200px centrado con padding lateral
- Scrollbar personalizada acorde al tema

@keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(37,211,102,.5)} 70%{box-shadow:0 0 0 16px transparent} }
@keyframes fadeUp { from{opacity:0;transform:translateY(40px)} to{opacity:1;transform:translateY(0)} }

BOTÓN WHATSAPP FLOTANTE (siempre visible):
<a href="https://wa.me/[telefono]?text=Hola%2C%20quiero%20información" class="wa-float" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">
  <svg viewBox="0 0 32 32" fill="white" width="32" height="32"><path d="M16 1C7.73 1 1 7.73 1 16c0 2.64.69 5.1 1.89 7.24L1 31l8.01-2.1A15 15 0 0016 31c8.27 0 15-6.73 15-15S24.27 1 16 1zm0 27.5a12.46 12.46 0 01-6.35-1.74l-.45-.27-4.76 1.25 1.26-4.63-.3-.48A12.5 12.5 0 1116 28.5zm6.85-9.37c-.37-.19-2.2-1.09-2.54-1.21-.34-.12-.59-.19-.84.19s-.96 1.21-1.18 1.46-.43.28-.8.09a10.1 10.1 0 01-2.97-1.83 11.17 11.17 0 01-2.06-2.56c-.21-.37 0-.57.16-.75.15-.16.37-.43.56-.65.18-.21.25-.37.37-.62.12-.25.06-.46-.03-.65-.09-.19-.84-2.03-1.15-2.78-.3-.72-.61-.62-.84-.63h-.71c-.25 0-.65.09-.99.46s-1.3 1.27-1.3 3.09 1.33 3.58 1.52 3.83c.18.25 2.62 4 6.35 5.61.89.38 1.58.61 2.12.78.89.28 1.7.24 2.34.15.71-.11 2.2-.9 2.51-1.77.31-.87.31-1.62.22-1.77-.09-.16-.34-.25-.71-.44z"/></svg>
</a>
.wa-float { position:fixed; bottom:24px; right:24px; width:60px; height:60px; border-radius:50%; background:var(--wa); display:flex; align-items:center; justify-content:center; text-decoration:none; animation:pulse 2s infinite; z-index:999; box-shadow:0 4px 20px rgba(37,211,102,.4); }

JAVASCRIPT (inline antes de </body>):
1. Intersection Observer para .reveal
2. Counter animation para estadísticas numéricas
3. Smooth scroll para links de navegación
4. El script de scroll-video se añadirá en el siguiente paso (NO incluir aquí)

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

const BRIEF_BUILD_SYSTEM = `Eres un experto en diseño web premium. Con el brief del negocio como única fuente, generas una web profesional y única — no un template genérico.

REGLAS ABSOLUTAS:
- Usa los textos del brief EXACTAMENTE como se proporcionan — no parafrasees ni inventes
- Usa color_primario como --primary en :root; color_secundario como --secondary (si no existe, derivar del primario)
- Carga tipografia_titular desde Google Fonts CDN; Inter para cuerpo
- Si un campo del brief está vacío u omitido, omite esa sección sin dejar huecos ni placeholders
- Todos los botones CTA enlazan a: https://wa.me/{whatsapp}?text={mensaje_whatsapp url-encoded}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTILO VISUAL SEGÚN TONO Y SECTOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Elige el estilo combinando TONO + SECTOR del brief:

TONO filosófico
→ Mucho espacio vacío · frases solas con tipografía XL · animaciones lentas y sutiles
→ Pocos elementos por pantalla · jerarquía basada en silencio visual

TONO gaming
→ Alto contraste · glow en botones · animaciones rápidas · colores muy saturados
→ Texto en MAYÚSCULAS · sensación de energía y urgencia

TONO profesional
→ Estructura limpia y ordenada · animaciones discretas · mucho padding y respiro
→ Paleta sobria · tipografía cuidada · credibilidad visual

TONO minimalista
→ Solo lo esencial · decoración casi nula · tipografía es el diseño
→ Fondo muy oscuro o muy claro · máximo contraste texto/fondo

SECTOR: adapta nombres de secciones, vocabulario y CTA al sector indicado
- restaurante/bar: "Nuestra Carta", "Reserva tu mesa"
- clínica/salud: tema CLARO, "Nuestros servicios", "Agenda tu cita"
- gym/deporte: "Planes", "Empieza hoy"
- peluquería/estética: "Servicios y precios", "Pide tu cita"
- servicios del hogar: "Lo que hacemos", "Llámanos ahora"
- otros: usar vocabulario del propio brief

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTRUCTURA — adaptar según contenido del brief
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NAVEGACIÓN FIJA — incluir cuando hay 3+ secciones
- sticky, fondo semi-transparente + backdrop-filter:blur(12px)
- Logo/nombre a la izquierda, links a secciones, botón CTA derecha

HERO (100vh, id="hero") — SIEMPRE
- <!-- SCROLL-VIDEO-SECTION --> (scroll-video se añade en paso posterior)
- <video id="heroVideo" src="assets/hero.mp4" poster="assets/hero-poster.jpg" playsinline muted loop preload="auto">
- Overlay adaptado al tono (oscuro gaming, sutil filosófico, mínimo minimalista)
- Si logo_url existe: <img src="{logo_url}" alt="{nombre}" class="hero-logo">
- Titular: frase_impacto exacta · tipografia_titular · clamp(48px,7vw,90px)
  Gaming: MAYÚSCULAS; filosófico/minimalista: respetar capitalización original
- Subtítulo: subtitulo exacto del brief
- Botón CTA: texto adaptado al sector → WhatsApp

SOBRE / PROPUESTA (altura auto, padding generoso) — si hay subtitulo + puntos_clave
- Si prueba_social es un número: elemento visual dominante con counter JS (0→N en 2s al viewport)
- Si prueba_social es texto: cita visual grande
- puntos_clave: lista con iconos SVG simples (checkmarks o flechas)
- Botón secundario → mismo WhatsApp

DIFERENCIADOR (altura auto) — si diferenciador está en el brief
- Una sola frase poderosa · tipografía muy grande · es el momento más bold de la web
- Subtexto corto de apoyo si hay espacio

CTA FINAL (100vh, id="cta-final")
- Botón grande "CONTÁCTANOS POR WHATSAPP" con @keyframes pulse → https://wa.me/{whatsapp}?text={mensaje_whatsapp url-encoded}
- Teléfono clickable: <a href="tel:+{whatsapp}">
- REDES SOCIALES: si redes_sociales tiene URLs reales, incluir iconos SVG inline en fila:
  · Instagram (gradiente rojo-naranja) · Facebook (azul) · TikTok (negro) · YouTube (rojo) · LinkedIn (azul) · Twitter/X (negro)
  Tamaño 28px · hover scale(1.15) · solo las redes con URL real
- Footer mínimo: {nombre} + © {año actual}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CSS Y EFECTOS DE SCROLL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

:root { --primary:{color_primario}; --secondary:{color_secundario}; --dark:#0a0a12; --light:#f8fafc; --wa:#25D366; }
.reveal { opacity:0; transform:translateY(40px); transition:opacity .8s ease,transform .8s ease; }
.reveal.visible { opacity:1; transform:translateY(0); }
@keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(37,211,102,.5)} 70%{box-shadow:0 0 0 18px transparent} }
@keyframes fadeUp { from{opacity:0;transform:translateY(40px)} to{opacity:1;transform:translateY(0)} }

BOTÓN WHATSAPP FLOTANTE (siempre, con SVG del logo WhatsApp):
.wa-float { position:fixed; bottom:24px; right:24px; width:60px; height:60px; border-radius:50%; background:var(--wa); display:flex; align-items:center; justify-content:center; text-decoration:none; animation:pulse 2s infinite; z-index:999; }

JS (inline antes de </body>):
1. Intersection Observer para .reveal
2. Counter animation si prueba_social es numérico
3. Smooth scroll para nav links
4. NO incluir el script de scroll-video — se añade en el paso siguiente

FORMATO — devuelve SOLO este JSON (sin markdown):
{"index.html": "<!DOCTYPE html>..."}`;

const INSTAGRAM_BUILD_SYSTEM = `Eres un experto en diseño web premium para marcas personales. Conviertes un perfil de Instagram en una web profesional que refleja la identidad y estilo del creador.

REGLA FUNDAMENTAL: No inventes ningún dato. Todo el contenido viene del perfil extraído. Lo que no existe, se omite.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ADAPTAR DISEÑO AL TIPO DE CUENTA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fotografo/videografo/creativo → Tema oscuro. Portfolio visual como protagonista. Tipografía artística. CTA: "Reserva tu sesión"
coach/consultor/mentor → Tema claro u oscuro elegante. Social proof destacado. Servicios y programas claros. CTA: "Agenda una llamada"
influencer/creador → Fresco y personal. Stats de todas las redes. Colaboraciones destacadas. CTA: "Colabora conmigo"
freelancer/diseñador/dev → Profesional moderno. Portfolio de proyectos. Skills en badges. CTA: "Hablemos de tu proyecto"
nutricionista/fitness/salud → Energético y saludable. Planes/programas. Resultados de clientes. CTA: "Empieza tu plan"
artista/musico → Expresivo e inmersivo. Galería/obra/shows. CTA: "Escúchame"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTRUCTURA DE SECCIONES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. NAVEGACIÓN FIJA
   - Logo/nombre a la izquierda, links a secciones, botón CTA a la derecha
   - Fondo semi-transparente + backdrop-filter:blur(12px) al hacer scroll

2. HERO (100vh, id="hero")
   - <!-- SCROLL-VIDEO-SECTION --> (scroll-video se añade en paso posterior)
   - <video id="heroVideo" src="assets/hero.mp4" poster="assets/hero-poster.jpg" playsinline muted loop preload="auto">
   - Overlay acorde al tipo de cuenta
   - TARJETA PREMIUM DE INSTAGRAM (el elemento visual más importante del hero):
     · Foto de perfil con anillo animado estilo Instagram Stories (gradiente que rota)
     · Nombre + badge de verificación (círculo azul con check blanco)
     · Handle @{handle} como link clickable a instagram.com/{handle}
     · Stats visibles sin animación: {publicaciones} publicaciones · {seguidores} seguidores · {siguiendo} siguiendo
     · Categoría profesional
     · Bio real completa
     · Botones de acción estilo IG: "Contactar" → WhatsApp/email, "Ver perfil" → instagram.com/{handle}
     · Mini grid de 6 fotos de posts (assets/instagram/post-1.jpg ... post-6.jpg) en la parte inferior de la tarjeta
   - Debajo de la tarjeta: título grande con la misión/propósito del creador
   - Si hay total_comunidad: badge con el número total de seguidores en todas las redes

3. SOBRE MÍ (id="sobre") — si hay bio o descripcion_extendida
   - Bio expandida real
   - Áreas de expertise en badges/pills
   - Grid de fotos reales (assets/instagram/)

4. SERVICIOS (id="servicios") — SOLO si servicios[] no está vacío
   - Tarjetas con nombre, descripción y precio (si se dio precio)
   - Si precio no se dio: no mostrar precio
   - Si tiene comunidad/formación (ej: Skool): darle sección propia con stats
   - CTA adaptado al tipo de cuenta

5. GALERÍA (id="galeria") — si hay fotos en fotos_posts[]
   - Grid masonry o cuadrícula de las fotos reales descargadas
   - Rutas: assets/instagram/post-N.jpg
   - Hover effects elegantes

6. MÉTRICAS (id="metricas") — si hay datos numéricos reales (seguidores, casos, años)
   - Barra de stats con counter animation al entrar en viewport
   - Solo datos reales

7. TESTIMONIOS (id="testimonios") — SOLO si testimonios[] no está vacío
   - Testimonios reales, exactamente los proporcionados
   - Elegir los que mencionan resultados concretos

8. CONTACTO + FOOTER (id="contacto")
   - Formulario: nombre, email, mensaje (solo si hay email real)
   - Iconos SVG inline de redes sociales (SOLO las que tienen URL real):
     · Instagram (gradiente rojo-naranja) · Facebook (azul) · TikTok (negro)
     · YouTube (rojo) · LinkedIn (azul) · Twitter/X (negro)
     Tamaño 28px · fila horizontal · hover scale(1.15) · link a URL real
   - Si hay whatsapp: botón "Escríbeme por WhatsApp" → wa.me/{whatsapp}
   - CTA directo a Instagram del perfil
   - Copyright nombre + año

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CSS Y EFECTOS OBLIGATORIOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Fuentes de Google Fonts según el tipo de cuenta:
- fotografo/artista: Cormorant Garamond (títulos) + Raleway (cuerpo)
- coach/consultor: Playfair Display (títulos) + Lato (cuerpo)
- influencer/creador: Space Grotesk (títulos) + Inter (cuerpo)
- otros: Inter o Space Grotesk

:root { --primary: [extraer de marca o elegir acorde al tipo]; --ig-grad: linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888); --wa: #25D366; }

@keyframes igRing { to { transform: rotate(360deg); } } /* para el anillo de la foto de perfil */
@keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(37,211,102,.5)} 70%{box-shadow:0 0 0 16px transparent} }
@keyframes fadeUp { from{opacity:0;transform:translateY(40px)} to{opacity:1;transform:translateY(0)} }
.reveal { opacity:0; transform:translateY(40px); transition:opacity .8s ease,transform .8s ease; }
.reveal.visible { opacity:1; transform:translateY(0); }

Instagram ring: pseudo-elemento con background: var(--ig-grad) que rota con igRing 3s linear infinite

Botón WhatsApp flotante: siempre visible (si hay whatsapp), position fixed, bottom 24px, right 24px, border-radius 50%, background var(--wa), animation pulse 2s infinite

JS (inline antes de </body>):
1. Intersection Observer para .reveal + stagger en grids
2. Counter animation para métricas numéricas
3. Smooth scroll entre secciones
4. NO incluir script de scroll-video — se añade en paso posterior

FORMATO — devuelve SOLO este JSON (sin markdown):
{"index.html": "<!DOCTYPE html>..."}`;

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
    await this.assertWebBuilderEnabled(tenantId);
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

  async startFromBrief(tenantId: string, slotId: string, proyectoId: string, dto: StartFromBriefDto) {
    await this.assertWebBuilderEnabled(tenantId);
    await this.getAndVerify(tenantId, proyectoId);
    await this.prisma.webProyecto.update({
      where: { id: proyectoId },
      data: { build_log: [], fase: 'assets' },
    });
    this.runBriefPipeline(tenantId, slotId, proyectoId, dto).catch(err => {
      this.emit(slotId, proyectoId, 'error', String(err.message ?? err), 'error');
      this.prisma.webProyecto.update({
        where: { id: proyectoId },
        data: { fase: 'assets' },
      }).catch(() => {});
    });
    return { status: 'started', proyectoId };
  }

  async startFromInstagram(tenantId: string, slotId: string, proyectoId: string, dto: StartFromInstagramDto) {
    await this.assertWebBuilderEnabled(tenantId);
    await this.getAndVerify(tenantId, proyectoId);
    await this.prisma.webProyecto.update({
      where: { id: proyectoId },
      data: { build_log: [], fase: 'assets' },
    });
    this.runInstagramPipeline(tenantId, slotId, proyectoId, dto).catch(err => {
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
    return { files: p.files ?? {}, fase: p.fase, build_log: p.build_log ?? [] };
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

  // ─── Pipeline desde brief ───────────────────────────────────────────────────

  private async runBriefPipeline(
    tenantId: string,
    slotId: string,
    proyectoId: string,
    dto: StartFromBriefDto,
  ) {
    const log = (phase: string, message: string, status: BuildEvent['status'] = 'running') => {
      this.emit(slotId, proyectoId, phase, message, status);
      return this.appendLog(proyectoId, { phase, message, status, ts: new Date().toISOString() });
    };

    await log('pages', `Construyendo landing "${dto.nombre}" — tono ${dto.tono}...`);
    const rawPages = await this.buildFromBrief(dto);
    await log('pages', 'Landing page generada desde brief de marca', 'done');

    await log('scroll', 'Añadiendo efecto scroll cinematográfico al hero...');
    const indexWithScroll = await this.applyScrollEffect(rawPages['index.html']);
    await log('scroll', 'Efecto scroll aplicado', 'done');

    await log('seo', 'Optimizando SEO, Schema.org y performance...');
    const businessData = {
      nombre: dto.nombre,
      sector: dto.sector ?? 'empresa',
      ciudad: '',
      telefono: dto.whatsapp,
      email: '',
    };
    const finalFiles = await this.applySeo(
      { ...rawPages, 'index.html': indexWithScroll },
      businessData,
    );
    await log('seo', 'SEO local, Schema.org, sitemap.xml y robots.txt aplicados', 'done');

    const withWidget = await this.injectWidgetIfActive(proyectoId, finalFiles);

    await this.prisma.webProyecto.update({
      where: { id: proyectoId },
      data: { files: withWidget, fase: 'seo' },
    });

    await log('ready', '¡Landing lista! Revisa la vista previa y publica cuando quieras.', 'done');
    this.presence.emitToSlot(slotId, 'web-builder:ready', {
      proyectoId,
      fileCount: Object.keys(withWidget).length,
    });
  }

  // ─── Pipeline desde Instagram ───────────────────────────────────────────────

  private async runInstagramPipeline(
    tenantId: string,
    slotId: string,
    proyectoId: string,
    dto: StartFromInstagramDto,
  ) {
    const handle = dto.handle.replace('@', '');
    const log = (phase: string, message: string, status: BuildEvent['status'] = 'running') => {
      this.emit(slotId, proyectoId, phase, message, status);
      return this.appendLog(proyectoId, { phase, message, status, ts: new Date().toISOString() });
    };

    await log('extract', `Analizando perfil @${handle} en Instagram...`);
    const scrapedContent = await this.scrapeInstagram(handle);

    const profileData: Record<string, any> = {
      handle,
      whatsapp: dto.whatsapp ?? '',
      email: dto.email ?? '',
      fotos_posts: Array.from({ length: 9 }, (_, i) => `assets/instagram/post-${i + 1}.jpg`),
      foto_perfil: 'assets/instagram/profile.jpg',
    };

    if (scrapedContent) {
      await log('extract', 'Perfil encontrado, extrayendo datos...');
      const extracted = await this.extractInstagramData(handle, scrapedContent);
      Object.assign(profileData, extracted);
      await log('extract', `Perfil extraído: ${extracted.nombre ?? handle}`, 'done');
    } else if (dto.datos_manuales) {
      await log('extract', 'Usando datos proporcionados manualmente...', 'done');
      Object.assign(profileData, { datos_manuales: dto.datos_manuales });
    } else {
      await log('extract', [
        'No pudimos acceder a Instagram automáticamente.',
        'Coloca tus fotos en assets/instagram/ (post-1.jpg…post-9.jpg, profile.jpg)',
        'y vuelve a intentar con el campo "datos_manuales" para añadir bio y servicios.',
      ].join(' '), 'error');
      return;
    }

    await log('pages', 'Construyendo tu web de marca personal...');
    const rawPages = await this.buildFromInstagram(profileData);
    await log('pages', 'Web de marca personal generada', 'done');

    await log('scroll', 'Añadiendo efecto scroll cinematográfico al hero...');
    const indexWithScroll = await this.applyScrollEffect(rawPages['index.html']);
    await log('scroll', 'Efecto scroll aplicado', 'done');

    await log('seo', 'Optimizando SEO y Schema.org...');
    const finalFiles = await this.applySeo(
      { ...rawPages, 'index.html': indexWithScroll },
      { nombre: profileData.nombre ?? handle, sector: 'marca personal', ciudad: '', telefono: dto.whatsapp ?? '', email: dto.email ?? '' },
    );
    await log('seo', 'SEO aplicado', 'done');

    const withWidget = await this.injectWidgetIfActive(proyectoId, finalFiles);
    await this.prisma.webProyecto.update({
      where: { id: proyectoId },
      data: { files: withWidget, fase: 'seo' },
    });

    await log('ready', '¡Tu web de marca personal está lista! Revisa la vista previa.', 'done');
    this.presence.emitToSlot(slotId, 'web-builder:ready', {
      proyectoId,
      fileCount: Object.keys(withWidget).length,
    });
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

    // ── Inyectar widget si está configurado y activo ───────────────────────────
    const withWidget = await this.injectWidgetIfActive(proyectoId, finalFiles);

    // ── Guardar archivos y actualizar fase ─────────────────────────────────────
    await this.prisma.webProyecto.update({
      where: { id: proyectoId },
      data: { files: withWidget, fase: 'seo' },
    });

    await log('ready', '¡Web lista! Revisa la vista previa y publica cuando quieras.', 'done');
    this.presence.emitToSlot(slotId, 'web-builder:ready', {
      proyectoId,
      fileCount: Object.keys(withWidget).length,
    });
  }

  // ─── Llamadas a Claude ──────────────────────────────────────────────────────

  private async buildFromBrief(dto: StartFromBriefDto): Promise<Record<string, string>> {
    const msg = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: BRIEF_BUILD_SYSTEM,
      messages: [{
        role: 'user',
        content: `Brief de marca:\n${JSON.stringify(dto, null, 2)}`,
      }],
    });
    return this.parseJson(this.getText(msg));
  }

  private async scrapeInstagram(handle: string): Promise<string> {
    const key = process.env.FIRECRAWL_API_KEY;
    if (!key) return '';
    try {
      const resp = await fetch('https://api.firecrawl.dev/v2/scrape', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `https://www.instagram.com/${handle}/`,
          formats: ['markdown'],
          onlyMainContent: false,
          actions: [{ type: 'wait', milliseconds: 3000 }],
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) return '';
      const data = await resp.json() as any;
      return (data.markdown ?? data.content ?? '').slice(0, 12000);
    } catch {
      return '';
    }
  }

  private async extractInstagramData(handle: string, content: string): Promise<Record<string, any>> {
    const msg = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `Dado el contenido scrapeado de un perfil de Instagram, extrae los datos y devuelve SOLO JSON válido:
{
  "nombre": "nombre real de la persona",
  "bio": "bio completa",
  "categoria": "categoría profesional",
  "seguidores": "número con formato (ej: 12.4K)",
  "siguiendo": "número",
  "publicaciones": "número",
  "link_bio": "URL del link en bio o null",
  "tipo_cuenta": "fotografo|coach|influencer|freelancer|nutricionista|artista|otro",
  "redes_sociales": {}
}
Si un dato no está disponible, usa null. No inventes datos.`,
      messages: [{ role: 'user', content: `Handle: @${handle}\n\nContenido scrapeado:\n${content}` }],
    });
    try {
      return this.parseJson(this.getText(msg));
    } catch {
      return { nombre: handle };
    }
  }

  private async buildFromInstagram(profileData: Record<string, any>): Promise<Record<string, string>> {
    const msg = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 10000,
      system: INSTAGRAM_BUILD_SYSTEM,
      messages: [{
        role: 'user',
        content: `Datos del perfil de Instagram:\n${JSON.stringify(profileData, null, 2)}\n\nGenera la web de marca personal.`,
      }],
    });
    return this.parseJson(this.getText(msg));
  }

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

  private async injectWidgetIfActive(
    proyectoId: string,
    files: Record<string, string>,
  ): Promise<Record<string, string>> {
    const widget = await this.prisma.widgetConfig.findFirst({
      where: { proyecto_id: proyectoId, activo: true },
    });
    if (!widget) return files;

    const apiUrl = process.env.API_PUBLIC_URL ?? 'https://api.flowdesk.mx';
    const scriptTag = `\n<script src="${apiUrl}/public/widget/${proyectoId}/script.js" defer></script>`;
    const index = files['index.html'];
    if (!index) return files;

    return {
      ...files,
      'index.html': index.replace('</body>', `${scriptTag}\n</body>`),
    };
  }

  // ─── Higgsfield video generation ─────────────────────────────────────────────

  async generateHeroVideo(tenantId: string, proyectoId: string, dto: { photo_url?: string; prompt: string }) {
    await this.getAndVerify(tenantId, proyectoId);

    // Auth: "Key {api_key}:{api_key_secret}" — obtén las credenciales en cloud.higgsfield.ai
    const apiKey = process.env.HIGGS_API_KEY;
    const apiSecret = process.env.HIGGS_API_SECRET;
    if (!apiKey || !apiSecret) {
      throw new BadRequestException('Credenciales de Higgsfield no configuradas (HIGGS_API_KEY / HIGGS_API_SECRET).');
    }

    const HIGGS = 'https://platform.higgsfield.ai';
    const auth = `Key ${apiKey}:${apiSecret}`;
    const fullPrompt = `${dto.prompt}, cinematic, slow motion, 4K, professional lighting, hero section video, seamless loop, no text, no logos`;

    // Modelo: image-to-video si hay foto, text-to-video (DoP) si no
    const model = dto.photo_url
      ? 'kling-video/v2.1/pro/image-to-video'
      : 'higgsfield-ai/dop/preview';

    const body: Record<string, any> = { prompt: fullPrompt };
    if (dto.photo_url) body.image_url = dto.photo_url;

    const genResp = await fetch(`${HIGGS}/${model}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!genResp.ok) {
      const err = await genResp.text();
      throw new BadRequestException(`Error Higgsfield: ${err}`);
    }
    const { request_id } = await genResp.json() as { request_id: string };
    return { jobId: request_id };
  }

  async getHeroVideoStatus(tenantId: string, proyectoId: string, jobId: string) {
    await this.getAndVerify(tenantId, proyectoId);
    const apiKey = process.env.HIGGS_API_KEY;
    const apiSecret = process.env.HIGGS_API_SECRET;
    if (!apiKey || !apiSecret) throw new BadRequestException('Credenciales Higgsfield no configuradas.');

    const resp = await fetch(`https://platform.higgsfield.ai/requests/${jobId}/status`, {
      headers: { Authorization: `Key ${apiKey}:${apiSecret}` },
    });
    if (!resp.ok) throw new BadRequestException('No se pudo consultar el estado del video.');
    const data = await resp.json() as any;

    const status = data.status === 'completed' ? 'completed'
      : data.status === 'failed' ? 'failed'
      : 'processing';

    return {
      status,
      video_url: data.video?.url as string | undefined,
    };
  }

  private async assertWebBuilderEnabled(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { web_builder_enabled: true },
    });
    if (!t?.web_builder_enabled) {
      throw new BadRequestException('El módulo Web Builder no está activado para tu empresa. Contacta con FlowDesk.');
    }
  }

  private async getAndVerify(tenantId: string, proyectoId: string) {
    const p = await this.prisma.webProyecto.findFirst({
      where: { id: proyectoId, tenant_id: tenantId },
    });
    if (!p) throw new NotFoundException('Proyecto web no encontrado');
    return p;
  }
}
