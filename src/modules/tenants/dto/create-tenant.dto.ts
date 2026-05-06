import { IsString, IsEmail, IsOptional, IsHexColor, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTenantDto {
  @ApiProperty({ example: 'Inmobiliaria del Norte' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'inmobiliaria-norte', description: 'Identificador único URL-friendly' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'El slug solo puede tener letras minúsculas, números y guiones' })
  slug: string;

  @ApiProperty({ example: 'starter', enum: ['starter', 'growth', 'enterprise'] })
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiProperty({ example: '#4F46E5', required: false })
  @IsOptional()
  @IsHexColor()
  primary_color?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  logo_url?: string;

  // Datos del primer owner (se crea junto con el tenant)
  @ApiProperty({ example: 'Juan García', description: 'Nombre del dueño de la empresa' })
  @IsString()
  owner_name: string;

  @ApiProperty({ example: 'juan@empresa.com' })
  @IsEmail()
  owner_email: string;

  @ApiProperty({ example: 'Password123!@' })
  @IsString()
  @MinLength(12)
  owner_password: string;
}
