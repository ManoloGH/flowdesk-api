import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ example: 'Hola equipo, reunión en 10 minutos' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: 'ID del slot destinatario (DM). Omitir para mensaje de canal.' })
  @IsString()
  @IsOptional()
  receiver_id?: string;

  @ApiPropertyOptional({ description: 'ID del departamento para mensajes de canal.' })
  @IsString()
  @IsOptional()
  channel_id?: string;

  @ApiPropertyOptional({ enum: ['CHAT', 'EMAIL', 'POSTIT', 'ANNOUNCEMENT'], default: 'CHAT' })
  @IsIn(['CHAT', 'EMAIL', 'POSTIT', 'ANNOUNCEMENT'])
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({ description: 'Metadata adicional (color postit, asunto email, etc.)' })
  @IsOptional()
  metadata?: Record<string, any>;
}

export class GetMessagesDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  with_slot_id?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  channel_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  page?: number;
}
