import { Module } from '@nestjs/common';
import { MicroDiagnosticoService } from './micro-diagnostico.service';
import { MicroDiagnosticoController } from './micro-diagnostico.controller';

@Module({
  controllers: [MicroDiagnosticoController],
  providers: [MicroDiagnosticoService],
  exports: [MicroDiagnosticoService],
})
export class MicroDiagnosticoModule {}
