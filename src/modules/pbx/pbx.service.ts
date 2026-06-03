import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { AsteriskService } from './asterisk.service';
import { AiCallHandlerService } from './ai-call-handler.service';

@Injectable()
export class PbxService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enc: EncryptionService,
    private readonly asterisk: AsteriskService,
    private readonly aiCallHandler: AiCallHandlerService,
  ) {}

  onModuleInit() {
    // Registrar handler de llamadas entrantes en Asterisk ARI
    this.asterisk.onIncomingCall(async (event, channel) => {
      await this.aiCallHandler.handleIncomingCall(event, channel);
    });
  }

  async getExtensions(tenantId: string) {
    return this.prisma.teamSlot.findMany({
      where: { tenant_id: tenantId, type: 'HUMAN', pbx_extension: { not: null } },
      select: { id: true, name: true, pbx_extension: true, status: true, role: true },
    });
  }

  async assignExtension(tenantId: string, slotId: string, extension: string, sipPassword: string) {
    const encryptedPassword = this.enc.encrypt(sipPassword);
    return this.prisma.teamSlot.update({
      where: { id: slotId, tenant_id: tenantId },
      data: { pbx_extension: extension, pbx_sip_password: encryptedPassword },
      select: { id: true, name: true, pbx_extension: true },
    });
  }

  async getCallHistory(tenantId: string) {
    return this.prisma.phoneCall.findMany({
      where: { tenant_id: tenantId },
      orderBy: { started_at: 'desc' },
      take: 50,
      include: {
        handled_by: { select: { name: true, role: true } },
      },
    });
  }

  getStatus() {
    return {
      asterisk_connected: this.asterisk.isConnected,
      stt_provider: process.env.WHISPER_URL ? 'whisper_local' : (process.env.DEEPGRAM_API_KEY ? 'deepgram' : 'none'),
      tts_provider: process.env.PIPER_URL ? 'piper_local' : 'none',
    };
  }
}
