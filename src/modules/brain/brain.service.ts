import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EmbeddingService } from './embedding.service';

export interface BrainDocumentInput {
  source_type: string;
  source_id?: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface BrainSearchResult {
  id: string;
  title: string;
  content: string;
  source_type: string;
  source_id: string | null;
  similarity: number;
  metadata: Record<string, unknown>;
}

@Injectable()
export class BrainService {
  private readonly logger = new Logger(BrainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  async addDocument(tenantId: string, input: BrainDocumentInput): Promise<string> {
    const vector = await this.embedding.embed(input.content);
    const vectorSql = this.embedding.vectorToSql(vector);

    const existing = input.source_id
      ? await this.prisma.empresaBrainDocument.findFirst({
          where: { tenant_id: tenantId, source_type: input.source_type, source_id: input.source_id },
        })
      : null;

    if (existing) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "EmpresaBrainDocument"
         SET title = $1, content = $2, embedding = $3::vector, metadata = $4::jsonb, updated_at = NOW()
         WHERE id = $5`,
        input.title,
        input.content,
        vectorSql,
        JSON.stringify(input.metadata ?? {}),
        existing.id,
      );
      return existing.id;
    }

    const doc = await this.prisma.empresaBrainDocument.create({
      data: {
        tenant_id:   tenantId,
        source_type: input.source_type,
        source_id:   input.source_id,
        title:       input.title,
        content:     input.content,
        metadata:    (input.metadata ?? {}) as any,
      },
    });

    await this.prisma.$executeRawUnsafe(
      `UPDATE "EmpresaBrainDocument" SET embedding = $1::vector WHERE id = $2`,
      vectorSql,
      doc.id,
    );

    return doc.id;
  }

  async addBatch(tenantId: string, inputs: BrainDocumentInput[]): Promise<string[]> {
    const texts = inputs.map(i => i.content);
    const vectors = await this.embedding.embedBatch(texts);
    const ids: string[] = [];

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const vectorSql = this.embedding.vectorToSql(vectors[i]);

      const doc = await this.prisma.empresaBrainDocument.create({
        data: {
          tenant_id:   tenantId,
          source_type: input.source_type,
          source_id:   input.source_id,
          title:       input.title,
          content:     input.content,
          metadata:    (input.metadata ?? {}) as any,
        },
      });

      await this.prisma.$executeRawUnsafe(
        `UPDATE "EmpresaBrainDocument" SET embedding = $1::vector WHERE id = $2`,
        vectorSql,
        doc.id,
      );

      ids.push(doc.id);
    }

    return ids;
  }

  async search(tenantId: string, query: string, options?: {
    limit?: number;
    source_type?: string;
    threshold?: number;
  }): Promise<BrainSearchResult[]> {
    const limit = options?.limit ?? 5;
    const threshold = options?.threshold ?? 0.3;

    const queryVector = await this.embedding.embed(query);
    const vectorSql = this.embedding.vectorToSql(queryVector);

    const whereClause = options?.source_type
      ? `AND source_type = '${options.source_type}'`
      : '';

    const rows = await this.prisma.$queryRawUnsafe<BrainSearchResult[]>(
      `SELECT id, title, content, source_type, source_id, metadata,
              1 - (embedding <=> $1::vector) AS similarity
       FROM "EmpresaBrainDocument"
       WHERE tenant_id = $2
         AND embedding IS NOT NULL
         ${whereClause}
         AND 1 - (embedding <=> $1::vector) > $3
       ORDER BY embedding <=> $1::vector
       LIMIT $4`,
      vectorSql,
      tenantId,
      threshold,
      limit,
    );

    return rows.map(r => ({
      ...r,
      similarity: Number(r.similarity),
      metadata: r.metadata as Record<string, unknown>,
    }));
  }

  async list(tenantId: string, sourceType?: string) {
    return this.prisma.empresaBrainDocument.findMany({
      where: {
        tenant_id:   tenantId,
        ...(sourceType ? { source_type: sourceType } : {}),
      },
      select: {
        id:          true,
        title:       true,
        source_type: true,
        source_id:   true,
        metadata:    true,
        created_at:  true,
        updated_at:  true,
      },
      orderBy: [{ source_type: 'asc' }, { created_at: 'desc' }],
    });
  }

  async deleteBySource(tenantId: string, sourceType: string, sourceId: string): Promise<void> {
    await this.prisma.empresaBrainDocument.deleteMany({
      where: { tenant_id: tenantId, source_type: sourceType, source_id: sourceId },
    });
  }

  async getStats(tenantId: string) {
    const rows = await this.prisma.$queryRaw<{ source_type: string; count: bigint }[]>`
      SELECT source_type, COUNT(*) as count
      FROM "EmpresaBrainDocument"
      WHERE tenant_id = ${tenantId}
      GROUP BY source_type
      ORDER BY count DESC
    `;
    return rows.map(r => ({ source_type: r.source_type, count: Number(r.count) }));
  }
}
