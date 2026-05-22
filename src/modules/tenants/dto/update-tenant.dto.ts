import { IsString, IsOptional, IsHexColor, IsUrl, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateTenantDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsHexColor()
  primary_color?: string;

  @ApiProperty({ required: false, description: 'Color secundario (gradiente)' })
  @IsOptional()
  @IsHexColor()
  secondary_color?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  logo_url?: string;

  @ApiProperty({ required: false, example: 'inteligencia humana, potencia artificial' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  tagline?: string;

  @ApiProperty({ required: false, example: 'Tecnología — Agentes de IA' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  mission?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  vision?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  website?: string;
}

export class UpdateTenantStatusDto {
  @ApiProperty({ enum: ['active', 'suspended', 'cancelled'] })
  @IsString()
  status: string;
}

export class UpdateTenantTypeDto {
  @ApiProperty({ enum: ['PLATFORM', 'NETWORK', 'BRANCH'] })
  @IsString()
  tenant_type: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  network_id?: string | null;
}
