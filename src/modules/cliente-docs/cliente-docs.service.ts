import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateClienteDocDto } from './dto/create-cliente-doc.dto';

@Injectable()
export class ClienteDocsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateClienteDocDto) {
    const doc = await this.prisma.clienteDoc.create({
      data: {
        tipo:       dto.tipo || 'propuesta',
        folio:      dto.folio,
        titulo:     dto.titulo || dto.documento,
        nombre:     dto.nombre,
        cargo:      dto.cargo,
        empresa:    dto.empresa,
        email:      dto.email,
        remitente:  dto.remitente,
        nda:        dto.nda_aceptado ?? false,
        datos:      (dto.datos ?? {}) as object,
        html:       dto.html,
        firmado_at: dto.timestamp ? new Date(dto.timestamp) : new Date(),
      },
    });

    return {
      id:  doc.id,
      url: `https://api.flowdesk.mx/cliente-docs/${doc.id}`,
    };
  }

  async findOne(id: string) {
    const doc = await this.prisma.clienteDoc.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    return doc;
  }

  async findAll(tipo?: string) {
    return this.prisma.clienteDoc.findMany({
      where: tipo ? { tipo } : undefined,
      orderBy: { firmado_at: 'desc' },
      select: {
        id: true, tipo: true, folio: true, titulo: true,
        nombre: true, empresa: true, email: true,
        remitente: true, firmado_at: true,
      },
    });
  }
}
