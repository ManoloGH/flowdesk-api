import { IsString, IsEmail, IsOptional, IsArray, IsObject, IsBoolean, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class OnboardingStartDto {
  @ApiProperty({ example: 'Inmobiliaria del Norte' })
  @IsString()
  @MinLength(2)
  company_name: string;

  @ApiProperty({ example: 'inmobiliaria-norte' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'Solo letras minúsculas, números y guiones' })
  slug: string;

  @ApiProperty({ example: 'real_estate', enum: ['solo', 'real_estate', 'construction', 'corporate'] })
  @IsString()
  template: string;

  @ApiProperty({ example: 'Juan García' })
  @IsString()
  owner_name: string;

  @ApiProperty({ example: 'juan@empresa.com' })
  @IsEmail()
  owner_email: string;

  @ApiProperty({ example: 'Password123!@' })
  @IsString()
  @MinLength(12)
  owner_password: string;

  @ApiProperty({ required: false, example: '#10B981' })
  @IsOptional()
  @IsString()
  primary_color?: string;

  @ApiProperty({
    required: false,
    default: true,
    description: 'false = modo solo (solo Desk, sin campus ni equipo)',
  })
  @IsOptional()
  @IsBoolean()
  campus_enabled?: boolean;
}

export class OnboardingDepartmentsDto {
  @ApiProperty({ description: 'Si true, usa los departamentos del template. Si false, usa custom_departments.' })
  @IsBoolean()
  use_template: boolean;

  @ApiProperty({
    required: false,
    example: [{ name: 'Ventas', color: '#10B981', icon: '💰' }],
  })
  @IsOptional()
  @IsArray()
  custom_departments?: { name: string; color?: string; icon?: string; parent_id?: string }[];
}

export class OnboardingTeamSlotsDto {
  @ApiProperty({
    example: [
      { name: 'María López', email: 'maria@empresa.com', role: 'admin', department_name: 'Ventas' },
    ],
  })
  @IsArray()
  humans: {
    name: string;
    email: string;
    role?: string;
    department_name?: string;
  }[];

  @ApiProperty({
    required: false,
    description: 'Si true, añade los agentes sugeridos del template automáticamente',
  })
  @IsOptional()
  @IsBoolean()
  add_suggested_agents?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  custom_agents?: {
    name: string;
    instructions: string;
    department_name?: string;
    model?: string;
  }[];
}

export class OnboardingScheduleDto {
  @ApiProperty({ description: 'Si true, usa el horario del template' })
  @IsBoolean()
  use_template: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  custom_schedule?: {
    name: string;
    check_in_time: string;
    check_out_time: string;
    tolerance_minutes: number;
    work_days: string[];
  };
}

export class OnboardingRoomsDto {
  @ApiProperty({ description: 'Si true, usa las salas del template' })
  @IsBoolean()
  use_template: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  custom_rooms?: {
    name: string;
    room_type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
  }[];
}
