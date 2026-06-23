import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class PreguntaDto {
  @IsString() @IsNotEmpty()
  id: string;

  @IsString() @IsNotEmpty()
  texto: string;
}

export class CreateWidgetConfigDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  nombre_agente: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  saludo: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  objetivo: string;

  @ApiProperty({ type: [PreguntaDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => PreguntaDto)
  preguntas: PreguntaDto[];

  @ApiProperty() @IsString() @IsNotEmpty()
  cierre_instruccion: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  whatsapp: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  mensaje_wa_template?: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  color_primario?: string;
}

export class HistoryItemDto {
  @IsString() role: 'user' | 'assistant';
  @IsString() content: string;
}

export class ChatDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  session_id: string;

  @ApiProperty({ type: [HistoryItemDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => HistoryItemDto)
  history: HistoryItemDto[];
}

export class SaveLeadDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  session_id: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  nombre?: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  email?: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  telefono?: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  diagnostico?: string;
}
