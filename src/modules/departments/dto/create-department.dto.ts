import { IsString, IsOptional, IsHexColor, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDepartmentDto {
  @ApiProperty({ example: 'Ventas' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: '#6366F1', required: false })
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiProperty({ example: '🏢', required: false })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiProperty({ description: 'ID del departamento padre (para sub-departamentos)', required: false })
  @IsOptional()
  @IsString()
  parent_id?: string;
}
