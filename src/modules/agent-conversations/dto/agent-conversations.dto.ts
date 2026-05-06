import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatDto {
  @ApiProperty({ example: '¿Cuáles son mis tareas pendientes para hoy?' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({ description: 'Continuar una sesión existente' })
  @IsString()
  @IsOptional()
  session_id?: string;
}
