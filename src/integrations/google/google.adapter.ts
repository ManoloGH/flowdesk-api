import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class GoogleAdapter {
  private readonly logger = new Logger(GoogleAdapter.name);

  // Obtener token usando refresh token del slot
  async getAccessToken(refreshToken: string): Promise<string | null> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      }),
    });
    if (!res.ok) { this.logger.error('Google token refresh failed'); return null; }
    const data = await res.json();
    return data.access_token;
  }

  // Leer inbox de Gmail
  async getInbox(accessToken: string, maxResults = 20) {
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&labelIds=INBOX`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const list = await listRes.json();
    if (!list.messages) return [];

    const messages = await Promise.all(
      list.messages.slice(0, 10).map(async (m: any) => {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        return res.json();
      }),
    );
    return messages;
  }

  // Enviar email desde Gmail
  async sendEmail(accessToken: string, to: string, subject: string, body: string) {
    const raw = btoa(
      `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${body}`,
    ).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    return res.ok;
  }

  // Eventos del Google Calendar
  async getCalendarEvents(accessToken: string, startDate: string, endDate: string) {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${startDate}&timeMax=${endDate}&singleEvents=true&orderBy=startTime`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return res.json();
  }

  // Crear evento con Google Meet
  async createMeetEvent(accessToken: string, data: {
    title: string; start: string; end: string; attendees: string[];
  }) {
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: data.title,
        start: { dateTime: data.start, timeZone: 'America/Mexico_City' },
        end: { dateTime: data.end, timeZone: 'America/Mexico_City' },
        attendees: data.attendees.map(email => ({ email })),
        conferenceData: { createRequest: { requestId: `flowdesk-${Date.now()}` } },
      }),
    });
    const event = await res.json();
    return { join_url: event.hangoutLink, event_id: event.id };
  }

  // Intercambiar código de autorización por tokens (OAuth callback)
  async exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string; email: string } | null> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '',
      }),
    });
    if (!res.ok) { this.logger.error('Google code exchange failed'); return null; }
    const data = await res.json();
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const user = userRes.ok ? await userRes.json() : {};
    return { access_token: data.access_token, refresh_token: data.refresh_token ?? '', email: user.email ?? '' };
  }

  // Crear un Google Doc con el acta de reunión
  async createMeetingDoc(
    accessToken: string,
    title: string,
    body: string,
  ): Promise<{ docId: string; url: string } | null> {
    const createRes = await fetch('https://docs.googleapis.com/v1/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!createRes.ok) { this.logger.error('Google Docs create failed'); return null; }
    const doc = await createRes.json();
    const docId: string = doc.documentId;

    const batchRes = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ insertText: { location: { index: 1 }, text: body } }],
      }),
    });
    if (!batchRes.ok) { this.logger.error('Google Docs batchUpdate failed'); return null; }

    return { docId, url: `https://docs.google.com/document/d/${docId}/edit` };
  }

  // Listar archivos recientes creados por FlowDesk en Drive
  async listDriveFiles(accessToken: string, maxResults = 10) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?pageSize=${maxResults}&orderBy=modifiedTime+desc` +
      `&fields=files(id,name,mimeType,webViewLink,modifiedTime,size)`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return { files: [] };
    return res.json();
  }

  // URL OAuth para conectar cuenta Google de un empleado
  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '',
      response_type: 'code',
      scope: [
        'https://mail.google.com/',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/documents',
        'offline_access',
      ].join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }
}
