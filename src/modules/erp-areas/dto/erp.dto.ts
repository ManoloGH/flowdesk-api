import {
  IsString, IsNotEmpty, IsOptional, IsBoolean, IsInt,
  IsIn, IsArray, ValidateNested, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';

const ERP_STATUSES = ['LEVANTAMIENTO','CONFIGURACION','PRUEBA','AJUSTE','APROBADO','PRODUCCION','CANCELADO'];

// ── Requerimiento ─────────────────────────────────────────────────────────────

export class CreateErpRequirementDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  department_id: string;

  @ApiProperty({ example: 'ERP Contabilidad' })
  @IsString() @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  current_tools?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  current_pain?: string;

  @ApiPropertyOptional()
  @IsInt() @IsOptional()
  monthly_volume?: number;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  notes?: string;
}

export class UpdateErpRequirementDto extends PartialType(CreateErpRequirementDto) {
  @ApiPropertyOptional({ enum: ERP_STATUSES })
  @IsIn(ERP_STATUSES) @IsOptional()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  attachments?: any[];
}

// ── Servicio del requerimiento ────────────────────────────────────────────────

export class FormFieldDto {
  @IsString() @IsNotEmpty() id: string;
  @IsString() @IsNotEmpty() label: string;
  @IsIn(['text','textarea','number','select','multiselect','date','file','checkbox']) type: string;
  @IsBoolean() required: boolean;
  @IsString() @IsOptional() placeholder?: string;
  @IsArray() @IsOptional() options?: string[];
  @IsString() @IsOptional() helpText?: string;
}

export class ApprovalStepDto {
  @IsInt() @Min(1) step: number;
  @IsString() @IsNotEmpty() label: string;
  @IsString() @IsOptional() role?: string;
  @IsString() @IsOptional() slot_id?: string;
}

export class CreateErpServiceDto {
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

  // AS-IS
  @ApiPropertyOptional()
  @IsString() @IsOptional()
  current_process?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  pain_points?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  requester_profile?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  delivered_how?: string;

  @ApiPropertyOptional()
  @IsInt() @IsOptional()
  monthly_volume?: number;

  // TO-BE
  @ApiPropertyOptional()
  @IsInt() @IsOptional()
  sla_hours?: number;

  @ApiPropertyOptional()
  @IsBoolean() @IsOptional()
  requires_approval?: boolean;

  @ApiPropertyOptional()
  @IsArray() @IsOptional()
  @ValidateNested({ each: true }) @Type(() => ApprovalStepDto)
  approval_flow?: ApprovalStepDto[];

  @ApiPropertyOptional()
  @IsArray() @IsOptional()
  @ValidateNested({ each: true }) @Type(() => FormFieldDto)
  form_schema?: FormFieldDto[];

  // Acceso: ¿quién puede solicitar este servicio?
  @ApiPropertyOptional({ enum: ['all','roles','department'], default: 'all' })
  @IsIn(['all','roles','department']) @IsOptional()
  visible_to?: string;

  @ApiPropertyOptional({ description: 'Roles habilitados si visible_to = roles' })
  @IsArray() @IsOptional()
  visible_roles?: string[];

  @ApiPropertyOptional({ description: 'Departamento habilitado si visible_to = department' })
  @IsString() @IsOptional()
  visible_dept_id?: string;

  // Atención: ¿quién atiende las solicitudes?
  @ApiPropertyOptional({ enum: ['department','person'], default: 'department' })
  @IsIn(['department','person']) @IsOptional()
  assigned_to_type?: string;

  @ApiPropertyOptional({ description: 'Persona específica que atiende si assigned_to_type = person' })
  @IsString() @IsOptional()
  assigned_slot_id?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  auto_agent_id?: string;

  @ApiPropertyOptional()
  @IsBoolean() @IsOptional()
  auto_respond?: boolean;
}

export class UpdateErpServiceDto extends PartialType(CreateErpServiceDto) {
  @ApiPropertyOptional({ enum: ['BORRADOR','REVISADO','APROBADO'] })
  @IsIn(['BORRADOR','REVISADO','APROBADO']) @IsOptional()
  status?: string;
}

// ── Retroalimentación ─────────────────────────────────────────────────────────

export class CreateErpFeedbackDto {
  @ApiProperty({ enum: ['feedback','approval','rejection'] })
  @IsIn(['feedback','approval','rejection'])
  type: string;

  @ApiProperty()
  @IsString() @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: 'Comentarios específicos por servicio' })
  @IsArray() @IsOptional()
  service_refs?: { service_id: string; comment: string }[];
}
