import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { DeliverableSkillsController } from './deliverable-skills.controller';
import { DeliverableSkillsService } from './deliverable-skills.service';

@Module({
  imports: [PrismaModule],
  controllers: [DeliverableSkillsController],
  providers: [DeliverableSkillsService],
  exports: [DeliverableSkillsService],
})
export class DeliverableSkillsModule {}
