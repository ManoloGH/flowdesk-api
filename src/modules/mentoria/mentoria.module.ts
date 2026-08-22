import { Module } from '@nestjs/common';
import { MentoriaController } from './mentoria.controller';
import { MentoriaService } from './mentoria.service';
import { MentoriaProcesamientoService } from './mentoria-procesamiento.service';
import { MentoriaSesionService } from './mentoria-sesion.service';
import { MentoriaAgentesService } from './mentoria-agentes.service';
import { AiModule } from '../../ai/ai.module';
import { IntegrationsModule } from '../../integrations/integrations.module';

@Module({
  imports: [AiModule, IntegrationsModule],
  controllers: [MentoriaController],
  providers: [MentoriaService, MentoriaProcesamientoService, MentoriaSesionService, MentoriaAgentesService],
  exports: [MentoriaService],
})
export class MentoriaModule {}
