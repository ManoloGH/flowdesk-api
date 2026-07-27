import { IsString, IsOptional, IsEnum, IsEmail, IsInt, Min, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PrDocType { MEJORA = 'MEJORA', NUEVO_DESARROLLO = 'NUEVO_DESARROLLO', CORRECCION = 'CORRECCION', MANTENIMIENTO = 'MANTENIMIENTO' }
export enum PrStatus { BORRADOR = 'BORRADOR', EN_REVISION = 'EN_REVISION', APROBADO = 'APROBADO', EN_DESARROLLO = 'EN_DESARROLLO', EN_PRUEBAS = 'EN_PRUEBAS', LISTO = 'LISTO', CANCELADO = 'CANCELADO' }
export enum PrIntakeSource { FORMULARIO = 'FORMULARIO', EXCEL_AREA = 'EXCEL_AREA', DIAGNOSTICO = 'DIAGNOSTICO' }

export class CreateRequirementDto {
  @ApiProperty() @IsString() title: string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(PrDocType) doc_type?: PrDocType;
  @ApiPropertyOptional() @IsOptional() @IsEnum(PrIntakeSource) intake_source?: PrIntakeSource;
  @ApiPropertyOptional() @IsOptional() @IsString() pm_slot_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() current_situation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() problem_statement?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() objective?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() business_policies?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() related_systems?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() committed_dates?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() scope?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() out_of_scope?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assumptions?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() constraints?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() requested_by?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() requested_by_email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() responsible_systems?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() responsible_business?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) estimated_effort_days?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() estimated_duration?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() start_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() due_date?: string;
  @ApiPropertyOptional() @IsOptional() excel_upload_id?: string;
}

export class UpdateRequirementDto extends CreateRequirementDto {}

export class UpdateRequirementStatusDto {
  @ApiProperty({ enum: PrStatus }) @IsEnum(PrStatus) status: PrStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class GenerateRequirementDocDto {
  @ApiPropertyOptional({ description: 'Incluir reglas de negocio activas en el contexto del agente' })
  @IsOptional()
  include_rules?: boolean;
}
