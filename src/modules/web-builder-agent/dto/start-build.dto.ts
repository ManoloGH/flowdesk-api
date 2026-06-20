import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray, IsObject } from 'class-validator';

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

export class StartHeroVideoDto {
  @ApiPropertyOptional({ description: 'URL de foto de referencia (del local, producto, etc.)' })
  @IsString() @IsOptional()
  photo_url?: string;

  @ApiProperty({ description: 'Descripción de la escena que quiere ver en el video' })
  @IsString() @IsNotEmpty()
  prompt: string;
}

export class StartFromBriefDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  nombre: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  slogan?: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  color_primario: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  color_secundario?: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  tipografia_titular?: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  tono: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  frase_impacto: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  subtitulo: string;

  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true })
  puntos_clave: string[];

  @ApiProperty() @IsString() @IsNotEmpty()
  diferenciador: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  prueba_social?: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  whatsapp: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  mensaje_whatsapp?: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  logo_url?: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  sector?: string;

  @ApiPropertyOptional({ description: 'URL del video hero generado con IA (o subido manualmente)' })
  @IsString() @IsOptional()
  hero_video_url?: string;

  @ApiPropertyOptional({ description: 'URLs reales de redes sociales', example: { instagram: 'https://instagram.com/handle', tiktok: '', facebook: '' } })
  @IsObject() @IsOptional()
  redes_sociales?: {
    instagram?: string;
    facebook?: string;
    tiktok?: string;
    youtube?: string;
    linkedin?: string;
    twitter?: string;
  };
}

export class StartFromInstagramDto {
  @ApiProperty({ description: 'Handle de Instagram sin @' })
  @IsString() @IsNotEmpty()
  handle: string;

  @ApiPropertyOptional({ description: 'WhatsApp para el CTA (con código de país, ej: 5215512345678)' })
  @IsString() @IsOptional()
  whatsapp?: string;

  @ApiPropertyOptional({ description: 'Email de contacto para el formulario' })
  @IsString() @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: 'Datos del perfil en texto libre (si el scraping automático falla)' })
  @IsString() @IsOptional()
  datos_manuales?: string;
}
