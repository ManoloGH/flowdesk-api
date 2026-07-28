import { IsString, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateIntakeTokenDto {
  @ApiProperty() @IsString() area_name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() area_email?: string;
  @ApiPropertyOptional({ description: 'Días de validez del link (default 7)' })
  @IsOptional()
  expires_days?: number;
}

export class AnswerQuestionnaireDto {
  @ApiProperty({ description: 'Respuestas del área al cuestionario generado por IA' })
  @IsObject()
  area_answers: Record<string, string>;
}
