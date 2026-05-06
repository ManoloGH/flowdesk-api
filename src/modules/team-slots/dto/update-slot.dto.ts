import { IsString, IsOptional, IsObject, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSlotDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false, description: 'Nombre del agente CEO personal. Si se envía, crea o actualiza el CEO Agent del usuario.' })
  @IsOptional()
  @IsString()
  agent_name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  department_id?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  schedule_id?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  avatar_config?: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  avatar_url?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  agent_config?: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  permissions?: Record<string, unknown>;
}

export class UpdateStatusDto {
  @ApiProperty({ enum: ['ONLINE', 'OFFLINE', 'BUSY', 'AWAY'] })
  @IsEnum(['ONLINE', 'OFFLINE', 'BUSY', 'AWAY'])
  status: string;
}

export class SetPasswordDto {
  @ApiProperty({ description: 'Contraseña temporal para el nuevo empleado' })
  @IsString()
  password: string;
}
