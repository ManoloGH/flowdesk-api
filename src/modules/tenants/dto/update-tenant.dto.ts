import { IsString, IsOptional, IsHexColor } from 'class-validator';
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

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  logo_url?: string;
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
