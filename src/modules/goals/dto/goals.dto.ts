import { IsString, IsOptional, IsEnum, IsNumber, IsArray, IsBoolean, Min } from 'class-validator';
import {
  KsfLevel, KsfCategory, KsfOrigin,
  MeasurementSource, MeasurementFrequency,
  RelationshipType, CustomerType, RecognitionChannel,
} from '@prisma/client';

export class CreateStrategicPurposeDto {
  @IsString() vision: string;
  @IsString() @IsOptional() mission?: string;
  @IsArray() @IsOptional() values?: string[];
}

export class CreateKsfRelationshipDto {
  @IsEnum(RelationshipType) type: RelationshipType;
  @IsString() name: string;
  @IsString() expectation: string;
  @IsEnum(CustomerType) @IsOptional() customer_type?: CustomerType;
  @IsString() @IsOptional() internal_slot_id?: string;
  @IsString() @IsOptional() discovery_method?: string;
}

export class CreateSuccessAreaDto {
  @IsString() relationship_id: string;
  @IsString() name: string;
}

export class CreateKsfDto {
  @IsString() name: string;
  @IsString() @IsOptional() description?: string;
  @IsString() unit: string;

  @IsEnum(KsfLevel) level: KsfLevel;
  @IsEnum(KsfCategory) category: KsfCategory;
  @IsEnum(KsfOrigin) origin: KsfOrigin;

  @IsString() @IsOptional() purpose_id?: string;
  @IsString() @IsOptional() parent_ksf_id?: string;
  @IsString() @IsOptional() dept_id?: string;
  @IsString() @IsOptional() team_slot_id?: string;
  @IsString() @IsOptional() success_area_id?: string;

  @IsEnum(MeasurementSource) measurement_source: MeasurementSource;
  @IsOptional() measurement_config?: Record<string, unknown>;
  @IsEnum(MeasurementFrequency) measurement_freq: MeasurementFrequency;

  @IsNumber() @Min(0) minimum_level: number;
  @IsNumber() @Min(0) satisfactory_level: number;
  @IsNumber() @Min(0) outstanding_level: number;
}

export class UpdateKsfLevelsDto {
  @IsNumber() @Min(0) minimum_level: number;
  @IsNumber() @Min(0) satisfactory_level: number;
  @IsNumber() @Min(0) outstanding_level: number;
}

export class CreateMilestoneDto {
  @IsString() ksf_id: string;
  @IsString() name: string;
  @IsString() target_date: string;
  @IsString() @IsOptional() notes?: string;
}

export class CompleteMilestoneDto {
  @IsString() @IsOptional() notes?: string;
}

export class CreateEscalationConfigDto {
  @IsNumber() @IsOptional() threshold1_periods?: number;
  @IsNumber() @IsOptional() threshold1_levels?: number;
  @IsNumber() @IsOptional() threshold2_periods?: number;
  @IsNumber() @IsOptional() threshold2_levels?: number;
  @IsString() @IsOptional() rationale?: string;
}

export class SendRecognitionDto {
  @IsString() recognized_id: string;
  @IsString() ksf_id: string;
  @IsString() @IsOptional() message?: string;
  @IsEnum(RecognitionChannel) channel: RecognitionChannel;
}

export class SetReportsToDto {
  @IsString() @IsOptional() reports_to_id?: string;
}
