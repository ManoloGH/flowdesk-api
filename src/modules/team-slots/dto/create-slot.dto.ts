import { IsString, IsEmail, IsOptional, IsEnum, IsObject, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum SlotTypeDto {
  HUMAN = 'HUMAN',
  AI_AGENT = 'AI_AGENT',
}

export class CreateHumanSlotDto {
  @ApiProperty({ example: 'María González' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'maria@empresa.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'employee', enum: ['owner', 'admin', 'manager', 'employee'] })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  department_id?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  schedule_id?: string;
}

export class CreateAgentSlotDto {
  @ApiProperty({ example: 'Asistente de Ventas' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  department_id?: string;

  @ApiProperty({
    example: {
      model: 'claude-sonnet-4-6',
      instructions: 'Eres un asistente de ventas amable...',
      tools: ['send_message', 'create_task'],
      personality: 'profesional y amigable',
    },
  })
  @IsObject()
  agent_config: {
    model: string;
    instructions: string;
    tools?: string[];
    personality?: string;
  };
}
