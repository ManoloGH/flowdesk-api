import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsEmail,
  IsArray,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

const STATUSES = ['lead', 'prospect', 'customer', 'churned', 'partner'];
const ACTIVITY_TYPES = ['note', 'call', 'email', 'message', 'meeting', 'task', 'deal_update', 'payment'];

export class CreateContactDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  last_name?: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  company?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  position?: string;

  @ApiPropertyOptional({ enum: STATUSES, default: 'lead' })
  @IsIn(STATUSES)
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  custom_fields?: Record<string, any>;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  owner_slot_id?: string;
}

export class UpdateContactDto extends PartialType(CreateContactDto) {}

export class AddActivityDto {
  @ApiProperty({ enum: ACTIVITY_TYPES })
  @IsIn(ACTIVITY_TYPES)
  activity_type: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class CreateDealDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  pipeline_id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  stage_id: string;

  @ApiPropertyOptional()
  @IsOptional()
  value?: number;

  @ApiPropertyOptional({ default: 'MXN' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  expected_close?: string;
}
