import { IsString, IsOptional, IsEnum, IsBoolean, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PrRuleCategory {
  REGLA_NEGOCIO = 'REGLA_NEGOCIO',
  POLITICA_OPERATIVA = 'POLITICA_OPERATIVA',
  CALCULO = 'CALCULO',
  VALIDACION_DATOS = 'VALIDACION_DATOS',
  RESTRICCION_SISTEMA = 'RESTRICCION_SISTEMA',
  CUMPLIMIENTO = 'CUMPLIMIENTO',
  OTRO = 'OTRO',
}

export class CreateBusinessRuleDto {
  @ApiProperty() @IsString() name: string;
  @ApiProperty() @IsString() description: string;
  @ApiPropertyOptional({ enum: PrRuleCategory }) @IsOptional() @IsEnum(PrRuleCategory) category?: PrRuleCategory;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() affected_areas?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() related_systems?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() original_text?: string;
}

export class UpdateBusinessRuleDto extends CreateBusinessRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}

export class ImportRulesFromTextDto {
  @ApiProperty({ description: 'Texto o contenido a analizar para extraer reglas de negocio' })
  @IsString()
  content: string;

  @ApiPropertyOptional({ description: 'Nombre del archivo fuente (para referencia)' })
  @IsOptional()
  @IsString()
  source_file_name?: string;
}
