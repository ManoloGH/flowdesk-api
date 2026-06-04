import { Injectable } from '@nestjs/common';

@Injectable()
export class SearchService {

  // ── Búsqueda web ─────────────────────────────────────────────────────────────

  async webSearch(query: string, count = 5): Promise<{
    results: Array<{ title: string; url: string; description: string; content?: string }>;
    source: string;
  }> {
    const firecrawlKey = process.env.FIRECRAWL_API_KEY;
    if (firecrawlKey) return this.firecrawlSearch(query, count, firecrawlKey);
    const braveKey = process.env.BRAVE_SEARCH_API_KEY;
    if (braveKey) return this.braveSearch(query, count, braveKey);
    return this.duckDuckGoSearch(query, count);
  }

  // ── Leer URL ─────────────────────────────────────────────────────────────────

  async readUrl(url: string): Promise<{ title: string; content: string }> {
    const firecrawlKey = process.env.FIRECRAWL_API_KEY;
    if (firecrawlKey) return this.firecrawlRead(url, firecrawlKey);
    return this.basicFetch(url);
  }

  // ── Implementaciones ─────────────────────────────────────────────────────────

  private async braveSearch(query: string, count: number, apiKey: string) {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(count, 10)));
    url.searchParams.set('search_lang', 'es');
    url.searchParams.set('country', 'MX');
    url.searchParams.set('text_decorations', '0');

    const resp = await fetch(url.toString(), {
      headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) throw new Error(`Brave Search: ${resp.status}`);
    const data = await resp.json() as any;

    const results = (data.web?.results ?? []).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: r.description ?? '',
    }));

    return { results, source: 'brave' };
  }

  private async duckDuckGoSearch(query: string, count: number) {
    // DuckDuckGo Instant Answers — sin key, sin paginación completa
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1&kl=mx-es`;

    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (FlowDesk Agent)' },
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json() as any;

      const raw = [
        ...(data.RelatedTopics ?? []),
        ...(data.Results ?? []),
      ];

      const results = raw
        .filter((t: any) => t.FirstURL && t.Text)
        .slice(0, count)
        .map((t: any) => ({
          title: (t.Text ?? '').split(' - ')[0].slice(0, 100),
          url: t.FirstURL,
          description: t.Text ?? '',
        }));

      return { results, source: 'duckduckgo' };
    } catch {
      return { results: [], source: 'duckduckgo' };
    }
  }

  private async firecrawlSearch(query: string, count: number, apiKey: string) {
    const resp = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        limit: Math.min(count, 10),
        lang: 'es',
        country: 'mx',
        scrapeOptions: { formats: ['markdown'] },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) throw new Error(`Firecrawl Search: ${resp.status}`);
    const data = await resp.json() as any;

    const results = (data.data ?? []).map((r: any) => ({
      title: r.title ?? r.url ?? '',
      url: r.url ?? '',
      description: r.description ?? '',
      content: r.markdown ? (r.markdown as string).slice(0, 3000) : undefined,
    }));

    return { results, source: 'firecrawl' };
  }

  private async firecrawlRead(url: string, apiKey: string) {
    const resp = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) throw new Error(`Firecrawl: ${resp.status}`);
    const data = await resp.json() as any;

    return {
      title: data.metadata?.title ?? url,
      content: (data.markdown ?? '').slice(0, 10000),
    };
  }

  private async basicFetch(url: string) {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (FlowDesk Agent; compatible)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status} al leer ${url}`);
    const html = await resp.text();

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;

    const content = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 10000);

    return { title, content };
  }
}
