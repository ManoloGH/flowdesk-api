import {
  IsString, IsNotEmpty, IsOptional, IsBoolean, IsInt,
  IsIn, IsArray, IsJSON, ValidateNested, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';

// ── Formulario dinámico ───────────────────────────────────────────────────────

export class FormFieldDto {
  @IsString() @IsNotEmpty() id: string;
  @IsString() @IsNotEmpty() label: string;
  @IsIn(['text','textarea','number','select','multiselect','date','file','checkbox'])
  type: string;
  @IsBoolean() required: boolean;
  @IsString() @IsOptional() placeholder?: string;
  @IsArray() @IsOptional() options?: string[];
  @IsString() @IsOptional() helpText?: string;
}

// ── Paso de aprobación ────────────────────────────────────────────────────────

export class ApprovalStepDto {
  @IsInt() @Min(1) step: number;
  @IsString() @IsNotEmpty() label: string;
  @IsIn(['owner','admin','manager','employee']) @IsOptional() role?: string;
  @IsString() @IsOptional() slot_id?: string;
}

// ── Servicios del catálogo ────────────────────────────────────────────────────

export class CreateSocServiceDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  department_id: string;

  @ApiProperty()
  @IsString() @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  category?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  icon?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  color?: string;

  @ApiPropertyOptional()
  @IsInt() @IsOptional()
  sla_hours?: number;

  @ApiPropertyOptional()
  @IsInt() @IsOptional()
  sla_warning_pct?: number;

  @ApiPropertyOptional()
  @IsBoolean() @IsOptional()
  requires_approval?: boolean;

  @ApiPropertyOptional({ description: 'Array de pasos de aprobación' })
  @IsArray() @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ApprovalStepDto)
  approval_flow?: ApprovalStepDto[];

  @ApiPropertyOptional({ description: 'Array de campos del formulario dinámico' })
  @IsArray() @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  form_schema?: FormFieldDto[];

  @ApiPropertyOptional({ enum: ['all','department','roles'] })
  @IsIn(['all','department','roles']) @IsOptional()
  visible_to?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray() @IsOptional()
  visible_roles?: string[];

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  auto_agent_id?: string;

  @ApiPropertyOptional()
  @IsBoolean() @IsOptional()
  auto_respond?: boolean;
}

export class UpdateSocServiceDto extends PartialType(CreateSocServiceDto) {
  @ApiPropertyOptional()
  @IsBoolean() @IsOptional()
  is_active?: boolean;
}

// ── Solicitudes ───────────────────────────────────────────────────────────────

const STATUSES = ['DRAFT','PENDING','APPROVED','IN_PROGRESS','WAITING_INFO','IN_REVIEW','ACCEPTED','CLOSED','REJECTED','CANCELLED'];
const PRIORITIES = ['LOW','NORMAL','HIGH','URGENT'];

export class CreateSocRequestDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  service_id: string;

  @ApiProperty()
  @IsString() @IsNotEmpty()
  title: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: PRIORITIES })
  @IsIn(PRIORITIES) @IsOptional()
  priority?: string;

  @ApiPropertyOptional({ description: 'Respuestas al formulario dinámico del servicio' })
  @IsOptional()
  form_data?: Record<string, any>;
}

export class UpdateSocRequestStatusDto {
  @ApiProperty({ enum: STATUSES })
  @IsIn(STATUSES)
  status: string;

  @ApiPropertyOptional({ enum: PRIORITIES })
  @IsIn(PRIORITIES) @IsOptional()
  priority?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  assigned_to_id?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  notes?: string;
}

export class AddSocCommentDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: 'true = nota interna (solo el equipo la ve)' })
  @IsBoolean() @IsOptional()
  is_internal?: boolean;
}

export class DecideSocApprovalDto {
  @ApiProperty({ enum: ['approved','rejected'] })
  @IsIn(['approved','rejected'])
  decision: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  notes?: string;
}

export class AssignRequestDto {
  @ApiPropertyOptional()
  @IsString() @IsOptional()
  assigned_to_id?: string;
}
