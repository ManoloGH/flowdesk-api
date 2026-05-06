import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsInt,
  Min,
  Max,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const MEMORY_TYPES = ['factual', 'episodic', 'preference', 'goal', 'relationship', 'skill', 'context'];
const SOURCE_TYPES = ['message', 'task', 'calendar', 'file', 'conversation', 'manual', 'email', 'agent_response'];

export class CreateMemoryDto {
  @ApiProperty({ example: 'factual', enum: MEMORY_TYPES })
  @IsIn(MEMORY_TYPES)
  memory_type: string;

  @ApiProperty({ example: 'Le gusta trabajar con tareas organizadas por prioridad' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ example: 'manual', enum: SOURCE_TYPES })
  @IsIn(SOURCE_TYPES)
  @IsOptional()
  source_type?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  source_id?: string;

  @ApiPropertyOptional({ example: 8, minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  importance?: number;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  expires_at?: string;
}

export class QueryMemoriesDto {
  @ApiPropertyOptional({ example: 'tareas reuniones pendientes' })
  @IsString()
  @IsOptional()
  query?: string;

  @ApiPropertyOptional({ example: 'preference', enum: MEMORY_TYPES })
  @IsIn(MEMORY_TYPES)
  @IsOptional()
  memory_type?: string;

  @ApiPropertyOptional({ example: 10 })
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit?: number;
}
