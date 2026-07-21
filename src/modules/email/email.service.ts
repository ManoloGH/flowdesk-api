import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private resend: Resend | null = null;
  private readonly logger = new Logger(EmailService.name);
  private readonly from: string;

  constructor(private config: ConfigService) {
    const key = this.config.get<string>('RESEND_API_KEY');
    if (key) {
      this.resend = new Resend(key);
    } else {
      this.logger.warn('RESEND_API_KEY no configurado — los emails no se enviarán');
    }
    this.from = this.config.get<string>('EMAIL_FROM') ?? 'FlowDesk <noreply@flowdesk.mx>';
  }

  async sendWelcome(opts: {
    to: string;
    name: string;
    tempPassword: string;
    tenantName: string;
    loginUrl: string;
  }) {
    if (!this.resend) return;
    try {
      await this.resend.emails.send({
        from: this.from,
        to: opts.to,
        subject: `Tu acceso a FlowDesk — ${opts.tenantName}`,
        html: this.welcomeHtml(opts),
      });
    } catch (err: any) {
      this.logger.error(`Error al enviar email de bienvenida a ${opts.to}: ${err?.message}`);
    }
  }

  private welcomeHtml(opts: { to: string; name: string; tempPassword: string; tenantName: string; loginUrl: string }) {
    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Inter',Arial,sans-serif;color:#e8e8e8;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:40px auto;">
    <tr><td>
      <!-- Logo / Header -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td style="padding:24px 32px;background:#111;border-radius:12px 12px 0 0;border-bottom:1px solid #1e1e1e;">
            <span style="font-size:22px;font-weight:700;letter-spacing:-0.03em;">
              <span style="background:linear-gradient(100deg,#1dbdf0,#2566e8 60%,#c026d3);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Flow</span><span style="color:#e8e8e8;">desk</span>
            </span>
          </td>
        </tr>
      </table>

      <!-- Body -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border-radius:0 0 12px 12px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:20px;font-weight:600;color:#fff;">¡Bienvenido/a, ${opts.name}!</p>
          <p style="margin:0 0 24px;font-size:14px;color:#888;">Tu cuenta en <strong style="color:#e8e8e8;">${opts.tenantName}</strong> ha sido creada.</p>

          <!-- Credentials box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:8px;margin-bottom:28px;">
            <tr>
              <td style="padding:20px 24px;">
                <p style="margin:0 0 14px;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#555;">Tus credenciales de acceso</p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:6px 0;font-size:13px;color:#888;width:90px;">Usuario</td>
                    <td style="padding:6px 0;font-size:13px;color:#e8e8e8;font-family:monospace;">${opts.to}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-size:13px;color:#888;">Contraseña</td>
                    <td style="padding:6px 0;">
                      <span style="font-family:monospace;font-size:14px;font-weight:700;letter-spacing:0.08em;color:#1dbdf0;background:rgba(29,189,240,0.08);padding:4px 10px;border-radius:6px;">${opts.tempPassword}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <p style="margin:0 0 20px;font-size:13px;color:#888;line-height:1.6;">
            Te recomendamos cambiar tu contraseña en la primera sesión desde <strong style="color:#e8e8e8;">Configuración → Mi cuenta</strong>.
          </p>

          <!-- CTA -->
          <table cellpadding="0" cellspacing="0"><tr><td>
            <a href="${opts.loginUrl}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#1dbdf0,#2566e8);color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">
              Iniciar sesión →
            </a>
          </td></tr></table>

          <p style="margin:28px 0 0;font-size:11px;color:#444;line-height:1.7;">
            Si no esperabas este correo, ignóralo. Este mensaje fue generado automáticamente por FlowDesk.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }
}
