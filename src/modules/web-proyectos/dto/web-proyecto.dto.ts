import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsIn, IsObject } from 'class-validator';

const FASES = ['setup', 'assets', 'video', 'construccion', 'scroll', 'seo', 'publicado', 'entregado'] as const;

export class CreateWebProyectoDto {
  @ApiProperty({ example: 'Valenciana de Mudanzas' })
  @IsString() @IsNotEmpty()
  nombre_cliente: string;

  @ApiProperty({ example: 'valenciana-mudanzas' })
  @IsString() @IsNotEmpty()
  slug: string;

  @ApiPropertyOptional({ example: 'valencianamudanzas.com' })
  @IsString() @IsOptional()
  dominio?: string;

  @ApiPropertyOptional({ example: 'mudanzas' })
  @IsString() @IsOptional()
  sector?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  notas?: string;
}

export class UpdateWebProyectoDto extends PartialType(CreateWebProyectoDto) {
  @ApiPropertyOptional({ enum: FASES })
  @IsIn(FASES) @IsOptional()
  fase?: string;

  @ApiPropertyOptional({ example: 'https://valenciana-mudanzas.vercel.app' })
  @IsString() @IsOptional()
  vercel_url?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  vercel_project_id?: string;

  @ApiPropertyOptional()
  @IsObject() @IsOptional()
  assets?: Record<string, string>;
}
