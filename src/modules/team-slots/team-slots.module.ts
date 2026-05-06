import { Module } from '@nestjs/common';
import { TeamSlotsService } from './team-slots.service';
import { TeamSlotsController } from './team-slots.controller';

@Module({
  controllers: [TeamSlotsController],
  providers: [TeamSlotsService],
  exports: [TeamSlotsService],
})
export class TeamSlotsModule {}
