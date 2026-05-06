import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BranchesService } from './branches.service';
import { BranchesController } from './branches.controller';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule, JwtModule],
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
