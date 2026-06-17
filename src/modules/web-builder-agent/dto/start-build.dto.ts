import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class StartBuildDto {
  @ApiProperty({ description: 'HTML completo del cliente (Ctrl+U en el navegador)' })
  @IsString() @IsNotEmpty()
  html_original: string;

  @ApiPropertyOptional({ description: 'URL del logo del cliente' })
  @IsString() @IsOptional()
  logo_url?: string;
}

export class DeployDto {
  @ApiPropertyOptional({ description: 'Nombre del proyecto en Vercel (por defecto: web-{slug})' })
  @IsString() @IsOptional()
  project_name?: string;
}
