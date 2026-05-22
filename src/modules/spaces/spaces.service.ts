import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { CreateSpaceDto, UpdateSpaceDto, CreateCameraDto, UpdateCameraDto } from './dto/space.dto';

@Injectable()
export class SpacesService {
  constructor(
    private prisma: PrismaService,
    private enc: EncryptionService,
  ) {}

  // ─── Spaces ──────────────────────────────────────────────────────────────────

  async listSpaces(tenantId: string) {
    const spaces = await this.prisma.space.findMany({
      where: { tenant_id: tenantId },
      include: {
        cameras: {
          select: {
            id: true, name: true, type: true, status: true,
            refresh_interval_secs: true, cloud_embed_url: true,
            created_at: true, updated_at: true,
            // URLs cifradas NO se devuelven en el listado
          },
        },
      },
      orderBy: [{ floor: 'asc' }, { name: 'asc' }],
    });
    return spaces;
  }

  async createSpace(tenantId: string, dto: CreateSpaceDto) {
    return this.prisma.space.create({
      data: {
        tenant_id: tenantId,
        name: dto.name,
        type: dto.type ?? 'OFFICE',
        floor: dto.floor ?? 1,
      },
    });
  }

  async updateSpace(tenantId: string, spaceId: string, dto: UpdateSpaceDto) {
    await this.assertSpaceOwnership(tenantId, spaceId);
    return this.prisma.space.update({
      where: { id: spaceId },
      data: { ...dto },
    });
  }

  async deleteSpace(tenantId: string, spaceId: string) {
    await this.assertSpaceOwnership(tenantId, spaceId);
    await this.prisma.space.delete({ where: { id: spaceId } });
    return { ok: true };
  }

  // ─── Cameras ─────────────────────────────────────────────────────────────────

  async addCamera(tenantId: string, spaceId: string, dto: CreateCameraDto) {
    await this.assertSpaceOwnership(tenantId, spaceId);
    return this.prisma.camera.create({
      data: {
        tenant_id: tenantId,
        space_id: spaceId,
        name: dto.name,
        type: dto.type ?? 'MJPEG',
        stream_url_enc:   dto.stream_url   ? this.enc.encrypt(dto.stream_url)   : null,
        snapshot_url_enc: dto.snapshot_url ? this.enc.encrypt(dto.snapshot_url) : null,
        rtsp_url_enc:     dto.rtsp_url     ? this.enc.encrypt(dto.rtsp_url)     : null,
        cloud_embed_url:  dto.cloud_embed_url ?? null,
        refresh_interval_secs: dto.refresh_interval_secs ?? 5,
      },
      select: {
        id: true, name: true, type: true, status: true,
        refresh_interval_secs: true, cloud_embed_url: true,
        space_id: true, created_at: true,
      },
    });
  }

  async updateCamera(tenantId: string, spaceId: string, cameraId: string, dto: UpdateCameraDto) {
    await this.assertCameraOwnership(tenantId, spaceId, cameraId);
    const data: Record<string, any> = {};
    if (dto.name !== undefined)                data.name = dto.name;
    if (dto.type !== undefined)                data.type = dto.type;
    if (dto.refresh_interval_secs !== undefined) data.refresh_interval_secs = dto.refresh_interval_secs;
    if (dto.cloud_embed_url !== undefined)     data.cloud_embed_url = dto.cloud_embed_url;
    if (dto.stream_url !== undefined)          data.stream_url_enc = dto.stream_url ? this.enc.encrypt(dto.stream_url) : null;
    if (dto.snapshot_url !== undefined)        data.snapshot_url_enc = dto.snapshot_url ? this.enc.encrypt(dto.snapshot_url) : null;
    if (dto.rtsp_url !== undefined)            data.rtsp_url_enc = dto.rtsp_url ? this.enc.encrypt(dto.rtsp_url) : null;

    return this.prisma.camera.update({
      where: { id: cameraId },
      data,
      select: {
        id: true, name: true, type: true, status: true,
        refresh_interval_secs: true, cloud_embed_url: true,
        space_id: true, updated_at: true,
      },
    });
  }

  async deleteCamera(tenantId: string, spaceId: string, cameraId: string) {
    await this.assertCameraOwnership(tenantId, spaceId, cameraId);
    await this.prisma.camera.delete({ where: { id: cameraId } });
    return { ok: true };
  }

  // Endpoint dedicado: devuelve la URL descifrada para que el frontend conecte al stream.
  // Solo se llama al abrir la card de la cámara — no en el listado general.
  async getStreamUrl(tenantId: string, spaceId: string, cameraId: string) {
    await this.assertCameraOwnership(tenantId, spaceId, cameraId);
    const cam = await this.prisma.camera.findUnique({
      where: { id: cameraId },
      select: {
        type: true, status: true,
        stream_url_enc: true, snapshot_url_enc: true,
        rtsp_url_enc: true, cloud_embed_url: true,
        refresh_interval_secs: true,
      },
    });
    if (!cam) throw new Error('Cámara no encontrada');

    return {
      type: cam.type,
      status: cam.status,
      refresh_interval_secs: cam.refresh_interval_secs,
      stream_url:    cam.stream_url_enc   ? this.enc.safeDecrypt(cam.stream_url_enc)   : null,
      snapshot_url:  cam.snapshot_url_enc ? this.enc.safeDecrypt(cam.snapshot_url_enc) : null,
      rtsp_url:      cam.rtsp_url_enc     ? this.enc.safeDecrypt(cam.rtsp_url_enc)     : null,
      cloud_embed_url: cam.cloud_embed_url ?? null,
    };
  }

  // ─── Guards ───────────────────────────────────────────────────────────────────

  private async assertSpaceOwnership(tenantId: string, spaceId: string) {
    const space = await this.prisma.space.findUnique({ where: { id: spaceId } });
    if (!space) throw new NotFoundException('Espacio no encontrado');
    if (space.tenant_id !== tenantId) throw new ForbiddenException();
    return space;
  }

  private async assertCameraOwnership(tenantId: string, spaceId: string, cameraId: string) {
    const cam = await this.prisma.camera.findUnique({ where: { id: cameraId } });
    if (!cam) throw new NotFoundException('Cámara no encontrada');
    if (cam.tenant_id !== tenantId || cam.space_id !== spaceId) throw new ForbiddenException();
    return cam;
  }
}
