import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsDateString,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export class CreateTaskDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: PRIORITIES, default: 'medium' })
  @IsIn(PRIORITIES)
  @IsOptional()
  priority?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  due_date?: string;

  @ApiPropertyOptional({ description: 'Slot al que se asigna (si difiere del creador)' })
  @IsString()
  @IsOptional()
  assignee_id?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  department_id?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsOptional()
  tags?: string[];
}

export class UpdateTaskDto extends PartialType(CreateTaskDto) {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsIn(STATUSES)
  @IsOptional()
  status?: string;
}

export class CreateGoalDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: ['personal', 'department', 'company'], default: 'personal' })
  @IsIn(['personal', 'department', 'company'])
  @IsOptional()
  goal_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  target_value?: number;

  @ApiPropertyOptional({ example: '%' })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiPropertyOptional({ enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'], default: 'monthly' })
  @IsIn(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'])
  @IsOptional()
  period?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  start_date?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  end_date?: string;
}

export class UpdateGoalDto extends PartialType(CreateGoalDto) {
  @ApiPropertyOptional()
  @IsOptional()
  current_value?: number;

  @ApiPropertyOptional({ enum: ['active', 'completed', 'paused', 'cancelled'] })
  @IsIn(['active', 'completed', 'paused', 'cancelled'])
  @IsOptional()
  status?: string;
}
