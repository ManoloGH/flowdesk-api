import { Module } from '@nestjs/common';
import { WebProyectosService } from './web-proyectos.service';
import { WebProyectosController } from './web-proyectos.controller';

@Module({
  controllers: [WebProyectosController],
  providers: [WebProyectosService],
  exports: [WebProyectosService],
})
export class WebProyectosModule {}
