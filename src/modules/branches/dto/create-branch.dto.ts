import { IsString, IsOptional, MinLength, MaxLength, Matches } from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug solo puede contener letras minúsculas, números y guiones' })
  slug: string;

  @IsOptional()
  @IsString()
  primary_color?: string;

  @IsOptional()
  @IsString()
  logo_url?: string;
}
