import { Injectable, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';
import { CreateWidgetConfigDto, ChatDto, SaveLeadDto } from './dto/widget.dto';

// ─── Widget JS embed template ────────────────────────────────────────────────
// Placeholders: {{API_URL}} {{PROYECTO_ID}} {{NOMBRE_AGENTE}} {{SALUDO}} {{COLOR_PRIMARIO}} {{WHATSAPP}}

const WIDGET_SCRIPT = `(function(){
var C={apiUrl:'{{API_URL}}',pid:'{{PROYECTO_ID}}',agente:'{{NOMBRE_AGENTE}}',saludo:'{{SALUDO}}',color:'{{COLOR_PRIMARIO}}',wa:'{{WHATSAPP}}'};
var sid=Math.random().toString(36).slice(2)+Date.now().toString(36);
var hist=[];var started=false;

var css='.wfb{position:fixed;bottom:90px;right:24px;width:56px;height:56px;border-radius:50%;background:'+C.color+';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 24px rgba(0,0,0,.35);z-index:9998;transition:transform .2s}'
+'.wfb:hover{transform:scale(1.1)}'
+'.wov{position:fixed;bottom:160px;right:24px;width:360px;height:500px;background:#0d0d1f;border:1px solid rgba(255,255,255,.1);border-radius:16px;display:none;flex-direction:column;z-index:9999;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:Inter,system-ui,sans-serif}'
+'.wov.open{display:flex}'
+'.whd{padding:16px;background:'+C.color+';color:#fff;font-weight:700;font-size:14px;display:flex;align-items:center;gap:10px;flex-shrink:0}'
+'.wav{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}'
+'.wms{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}'
+'.wm{max-width:85%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.55}'
+'.wm.a{background:rgba(255,255,255,.08);color:#e5e7eb;align-self:flex-start;border-radius:4px 12px 12px 12px}'
+'.wm.u{background:'+C.color+';color:#fff;align-self:flex-end;border-radius:12px 4px 12px 12px}'
+'.wir{padding:10px 12px;border-top:1px solid rgba(255,255,255,.07);display:flex;gap:8px;flex-shrink:0;background:#0d0d1f}'
+'.wi{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#f3f4f6;font-size:13px;padding:8px 12px;outline:none;font-family:inherit}'
+'.ws{background:'+C.color+';border:none;border-radius:8px;color:#fff;padding:8px 14px;cursor:pointer;font-size:13px;font-weight:600}'
+'.wlf{padding:14px;display:flex;flex-direction:column;gap:10px}'
+'.wli{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#f3f4f6;font-size:13px;padding:9px 12px;outline:none;font-family:inherit;width:100%;box-sizing:border-box}'
+'.wwb{background:#25D366;border:none;border-radius:10px;color:#fff;padding:12px;cursor:pointer;font-size:14px;font-weight:700;width:100%}'
+'@keyframes wdot{0%,80%,100%{opacity:0}40%{opacity:1}}';
var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

var btn=document.createElement('button');
btn.className='wfb';
btn.title='Habla con '+C.agente;
btn.innerHTML='<svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>';
document.body.appendChild(btn);

var ov=document.createElement('div');
ov.className='wov';
ov.innerHTML='<div class="whd"><div class="wav">🤖</div><div><div>'+C.agente+'</div><div style="font-size:11px;opacity:.7;font-weight:400">En línea</div></div></div>'
+'<div class="wms" id="wms"></div>'
+'<div class="wir" id="wir"><input class="wi" id="wi" placeholder="Escribe aquí..."/><button class="ws" id="ws">→</button></div>';
document.body.appendChild(ov);

btn.onclick=function(){
  ov.classList.toggle('open');
  if(ov.classList.contains('open')&&!started){started=true;setTimeout(function(){addMsg(C.saludo,'a');hist.push({role:'assistant',content:C.saludo});},300);}
};

function addMsg(txt,role){
  var d=document.getElementById('wms');
  var m=document.createElement('div');
  m.className='wm '+role;m.textContent=txt;
  d.appendChild(m);d.scrollTop=d.scrollHeight;return m;
}

function typing(){
  var d=document.getElementById('wms');
  var m=document.createElement('div');
  m.className='wm a';
  m.innerHTML='<span style="display:inline-flex;gap:4px"><span style="animation:wdot 1.2s .0s infinite">●</span><span style="animation:wdot 1.2s .2s infinite">●</span><span style="animation:wdot 1.2s .4s infinite">●</span></span>';
  d.appendChild(m);d.scrollTop=d.scrollHeight;return m;
}

function send(){
  var inp=document.getElementById('wi');
  var txt=inp.value.trim();if(!txt)return;
  inp.value='';addMsg(txt,'u');hist.push({role:'user',content:txt});
  var t=typing();
  fetch(C.apiUrl+'/public/widget/'+C.pid+'/chat',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({session_id:sid,history:hist})
  }).then(function(r){return r.json();}).then(function(data){
    t.remove();addMsg(data.message,'a');hist.push({role:'assistant',content:data.message});
    if(data.type==='report'||data.type==='done'){showLead(data.message);}
  }).catch(function(){t.remove();addMsg('Hubo un error. Intenta de nuevo.','a');});
}

document.getElementById('ws').onclick=send;
document.getElementById('wi').onkeydown=function(e){if(e.key==='Enter')send();};

function showLead(diag){
  document.getElementById('wir').style.display='none';
  var d=document.getElementById('wms');
  var f=document.createElement('div');f.className='wlf';
  f.innerHTML='<p style="color:#9ca3af;font-size:12px;margin:0">Para enviarte el diagnóstico completo:</p>'
    +'<input class="wli" id="wln" placeholder="Tu nombre"/>'
    +'<input class="wli" id="wlw" placeholder="Tu WhatsApp (con código de país)"/>'
    +'<button class="wwb" id="wlb">💬 Recibir diagnóstico por WhatsApp</button>';
  d.appendChild(f);d.scrollTop=d.scrollHeight;
  document.getElementById('wlb').onclick=function(){
    var nombre=document.getElementById('wln').value.trim();
    var tel=document.getElementById('wlw').value.trim();
    fetch(C.apiUrl+'/public/widget/'+C.pid+'/lead',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({session_id:sid,nombre:nombre,telefono:tel,diagnostico:diag})
    }).then(function(r){return r.json();}).then(function(data){
      window.open(data.wa_url,'_blank');
      f.innerHTML='<p style="color:#34d399;text-align:center;padding:20px;font-size:14px">✅ ¡Listo! Te contactamos pronto.</p>';
    });
  };
}
})();`;

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class WidgetService {
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  constructor(private prisma: PrismaService) {}

  // ── Endpoints públicos ──────────────────────────────────────────────────────

  async getPublicConfig(proyectoId: string) {
    const cfg = await this.prisma.widgetConfig.findUnique({
      where: { proyecto_id: proyectoId },
    });
    if (!cfg || !cfg.activo) throw new NotFoundException('Widget no disponible');
    return { nombre_agente: cfg.nombre_agente, saludo: cfg.saludo, color_primario: cfg.color_primario };
  }

  async chat(proyectoId: string, dto: ChatDto) {
    const cfg = await this.prisma.widgetConfig.findUnique({ where: { proyecto_id: proyectoId } });
    if (!cfg) throw new NotFoundException('Widget no configurado');

    const preguntas = (cfg.preguntas as any[]).map((p, i) => `${i + 1}. ${p.texto}`).join('\n');

    const system = `Eres ${cfg.nombre_agente}, asistente virtual especializado.
Objetivo de la conversación: ${cfg.objetivo}

Preguntas que debes cubrir (una a la vez, de forma natural):
${preguntas}

Cuando hayas recogido toda la información, genera el diagnóstico/reporte.
Instrucción para el reporte: ${cfg.cierre_instruccion}

REGLAS:
- Haz UNA sola pregunta por mensaje
- Sé conversacional, empático y breve (máx 3 líneas por respuesta)
- Cuando entregues el reporte final, empiézalo con "Aquí está tu diagnóstico:"

Responde ÚNICAMENTE en JSON válido sin markdown:
{"message":"...","type":"question"}  — mientras recoges información
{"message":"...","type":"report"}    — cuando entregues el diagnóstico final`;

    const msg = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages: dto.history.map(h => ({ role: h.role as any, content: h.content })),
    });

    const text = (msg.content[0] as any).text as string;
    try {
      const clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
      return JSON.parse(clean);
    } catch {
      return { message: text, type: 'question' };
    }
  }

  async saveLead(proyectoId: string, dto: SaveLeadDto) {
    const cfg = await this.prisma.widgetConfig.findUnique({
      where: { proyecto_id: proyectoId },
      select: { tenant_id: true, whatsapp: true, nombre_agente: true },
    });
    if (!cfg) throw new NotFoundException('Widget no configurado');

    await this.prisma.widgetLead.create({
      data: {
        session_id: dto.session_id,
        tenant_id: cfg.tenant_id,
        proyecto_id: proyectoId,
        nombre: dto.nombre,
        email: dto.email,
        telefono: dto.telefono,
        diagnostico: dto.diagnostico,
      },
    });

    const texto = encodeURIComponent(
      `Hola, soy ${dto.nombre ?? 'un visitante'}. Acabo de recibir mi diagnóstico y quisiera hablar con ustedes.`
    );
    const wa_url = `https://wa.me/${cfg.whatsapp}?text=${texto}`;
    return { ok: true, wa_url };
  }

  async getScript(proyectoId: string, apiUrl: string): Promise<string> {
    const cfg = await this.prisma.widgetConfig.findFirst({
      where: { proyecto_id: proyectoId, activo: true },
    });
    if (!cfg) return '/* Widget no activo para este proyecto */';

    return WIDGET_SCRIPT
      .replace(/{{API_URL}}/g, apiUrl)
      .replace(/{{PROYECTO_ID}}/g, proyectoId)
      .replace(/{{NOMBRE_AGENTE}}/g, cfg.nombre_agente)
      .replace(/{{SALUDO}}/g, cfg.saludo.replace(/'/g, "\\'").replace(/\n/g, '\\n'))
      .replace(/{{COLOR_PRIMARIO}}/g, cfg.color_primario)
      .replace(/{{WHATSAPP}}/g, cfg.whatsapp);
  }

  // ── CRUD config (protegido) ─────────────────────────────────────────────────

  async saveConfig(tenantId: string, proyectoId: string, dto: CreateWidgetConfigDto) {
    const data = {
      tenant_id: tenantId,
      proyecto_id: proyectoId,
      nombre_agente: dto.nombre_agente,
      saludo: dto.saludo,
      objetivo: dto.objetivo,
      preguntas: dto.preguntas as any,
      cierre_instruccion: dto.cierre_instruccion,
      whatsapp: dto.whatsapp,
      mensaje_wa_template: dto.mensaje_wa_template,
      color_primario: dto.color_primario ?? '#6366f1',
    };
    return this.prisma.widgetConfig.upsert({
      where: { proyecto_id: proyectoId },
      create: data,
      update: data,
    });
  }

  async getConfig(tenantId: string, proyectoId: string) {
    return this.prisma.widgetConfig.findFirst({ where: { proyecto_id: proyectoId, tenant_id: tenantId } });
  }

  async toggleActive(tenantId: string, proyectoId: string) {
    const cfg = await this.prisma.widgetConfig.findFirst({ where: { proyecto_id: proyectoId, tenant_id: tenantId } });
    if (!cfg) throw new NotFoundException('Widget no configurado');
    return this.prisma.widgetConfig.update({ where: { id: cfg.id }, data: { activo: !cfg.activo } });
  }

  async getLeads(tenantId: string, proyectoId: string) {
    return this.prisma.widgetLead.findMany({
      where: { proyecto_id: proyectoId, tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
    });
  }

  // Devuelve el tag <script> listo para copiar/incrustar
  getEmbedTag(proyectoId: string, apiUrl: string): string {
    return `<script src="${apiUrl}/public/widget/${proyectoId}/script.js" defer></script>`;
  }
}
