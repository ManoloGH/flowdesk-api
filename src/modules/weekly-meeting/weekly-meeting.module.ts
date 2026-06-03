import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { WeeklyMeetingService } from './weekly-meeting.service';

@Module({
  imports: [PrismaModule],
  providers: [WeeklyMeetingService],
  exports: [WeeklyMeetingService],
})
export class WeeklyMeetingModule {}
