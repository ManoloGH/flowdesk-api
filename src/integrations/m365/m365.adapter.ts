import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class M365Adapter {
  private readonly logger = new Logger(M365Adapter.name);
  private readonly graphUrl = 'https://graph.microsoft.com/v1.0';

  // Obtener token de acceso usando el refresh token del slot (OAuth)
  async getAccessToken(refreshToken: string): Promise<string | null> {
    const res = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.MS_CLIENT_ID ?? '',
        client_secret: process.env.MS_CLIENT_SECRET ?? '',
        scope: 'Mail.ReadWrite Mail.Send Calendars.ReadWrite offline_access',
      }),
    });
    if (!res.ok) { this.logger.error('M365 token refresh failed'); return null; }
    const data = await res.json();
    return data.access_token;
  }

  // Leer inbox de Outlook
  async getInbox(accessToken: string, top = 20) {
    const res = await fetch(
      `${this.graphUrl}/me/mailFolders/inbox/messages?$top=${top}&$orderby=receivedDateTime desc`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return res.json();
  }

  // Enviar email desde Outlook
  async sendEmail(accessToken: string, to: string, subject: string, body: string) {
    const res = await fetch(`${this.graphUrl}/me/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: body },
          toRecipients: [{ emailAddress: { address: to } }],
        },
      }),
    });
    return res.ok;
  }

  // Obtener eventos del calendario de Outlook
  async getCalendarEvents(accessToken: string, startDate: string, endDate: string) {
    const res = await fetch(
      `${this.graphUrl}/me/calendarView?startDateTime=${startDate}&endDateTime=${endDate}&$orderby=start/dateTime`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return res.json();
  }

  // Crear evento con link de Teams
  async createTeamsMeeting(accessToken: string, data: {
    subject: string; start: string; end: string; attendees: string[];
  }) {
    const res = await fetch(`${this.graphUrl}/me/onlineMeetings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: data.subject,
        startDateTime: data.start,
        endDateTime: data.end,
        participants: {
          attendees: data.attendees.map(email => ({
            upn: email, role: 'attendee',
          })),
        },
      }),
    });
    const meeting = await res.json();
    return { join_url: meeting.joinWebUrl, meeting_id: meeting.id };
  }

  // Intercambiar código de autorización por tokens (OAuth callback)
  async exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string; email: string } | null> {
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: process.env.MS_CLIENT_ID ?? '',
        client_secret: process.env.MS_CLIENT_SECRET ?? '',
        redirect_uri: process.env.MS_REDIRECT_URI ?? '',
        scope: 'Mail.ReadWrite Mail.Send Calendars.ReadWrite offline_access',
      }),
    });
    if (!res.ok) { this.logger.error('M365 code exchange failed'); return null; }
    const data = await res.json();
    const userRes = await fetch(`${this.graphUrl}/me`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const user = userRes.ok ? await userRes.json() : {};
    return { access_token: data.access_token, refresh_token: data.refresh_token ?? '', email: user.mail ?? user.userPrincipalName ?? '' };
  }

  // URL de autorización OAuth para conectar cuenta de un empleado
  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID ?? '',
      response_type: 'code',
      redirect_uri: process.env.MS_REDIRECT_URI ?? '',
      scope: 'Mail.ReadWrite Mail.Send Calendars.ReadWrite offline_access',
      state,
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
  }
}
