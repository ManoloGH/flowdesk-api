import { IsString, IsOptional, IsArray, IsBoolean, IsInt, IsEnum, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AntiValueDto {
  @IsString() behavior: string;
  @IsString() reason: string;
}

export class RecognitionAwardDto {
  @IsString() name: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() frequency?: string; // weekly | monthly | special
}

export class InternalTermDto {
  @IsString() term: string;
  @IsString() definition: string;
}

export class AgendaItemDto {
  @IsString() topic: string;
  @IsInt() @IsOptional() @Min(1) minutes?: number;
}

export class UpsertCultureConfigDto {
  // Etapa 1 — Identidad fundadora
  @IsOptional() @IsString() purpose?: string;
  @IsOptional() @IsString() problem_statement?: string;
  @IsOptional() @IsString() desired_impact?: string;

  // Etapa 2 — Filosofía operativa
  @IsOptional() @IsArray() @IsString({ each: true }) operative_philosophy?: string[];

  // Etapa 3 — No negociable
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AntiValueDto)
  anti_values?: AntiValueDto[];

  // Etapa 4 — Reconocimiento
  @IsOptional() @IsArray() @IsString({ each: true }) recognition_behaviors?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RecognitionAwardDto)
  recognition_awards?: RecognitionAwardDto[];
  @IsOptional() @IsArray() @IsString({ each: true }) feedback_framework?: string[]; // [situación, comportamiento, impacto, mejora]

  // Etapa 5 — Lenguaje interno
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => InternalTermDto)
  internal_language?: InternalTermDto[];

  // Etapa 8 — IA-first
  @IsOptional() @IsArray() @IsString({ each: true }) ai_principles?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) ai_human_tasks?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) ai_bot_tasks?: string[];
}

export class CreatePrincipleDto {
  @IsString() name: string;
  @IsString() observable_behavior: string;
  @IsOptional() @IsInt() @Min(0) sort_order?: number;
}

export class UpdatePrincipleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() observable_behavior?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsInt() @Min(0) sort_order?: number;
}

export enum RitualType {
  DAILY     = 'DAILY',
  WEEKLY    = 'WEEKLY',
  MONTHLY   = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  SPECIAL   = 'SPECIAL',
}

export class CreateRitualDto {
  @IsString() name: string;
  @IsEnum(RitualType) ritual_type: RitualType;
  @IsOptional() @IsInt() @Min(5) duration_minutes?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AgendaItemDto)
  agenda?: AgendaItemDto[];
  @IsOptional() @IsInt() @Min(0) sort_order?: number;
}

export class UpdateRitualDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(RitualType) ritual_type?: RitualType;
  @IsOptional() @IsInt() @Min(5) duration_minutes?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AgendaItemDto)
  agenda?: AgendaItemDto[];
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsInt() @Min(0) sort_order?: number;
}
