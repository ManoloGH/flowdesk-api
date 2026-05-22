import { IsString, IsOptional, IsEnum, IsInt, IsUrl, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SpaceType {
  OFFICE = 'OFFICE',
  MEETING_ROOM = 'MEETING_ROOM',
  RECEPTION = 'RECEPTION',
  WAREHOUSE = 'WAREHOUSE',
  EXTERIOR = 'EXTERIOR',
  OTHER = 'OTHER',
}

export enum CameraType {
  MJPEG = 'MJPEG',
  SNAPSHOT = 'SNAPSHOT',
  RTSP = 'RTSP',
  CLOUD = 'CLOUD',
}

export class CreateSpaceDto {
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional({ enum: SpaceType }) @IsOptional() @IsEnum(SpaceType) type?: SpaceType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) floor?: number;
}

export class UpdateSpaceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ enum: SpaceType }) @IsOptional() @IsEnum(SpaceType) type?: SpaceType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) floor?: number;
}

export class CreateCameraDto {
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional({ enum: CameraType }) @IsOptional() @IsEnum(CameraType) type?: CameraType;
  @ApiPropertyOptional() @IsOptional() @IsString() stream_url?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() snapshot_url?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() rtsp_url?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cloud_embed_url?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) refresh_interval_secs?: number;
}

export class UpdateCameraDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ enum: CameraType }) @IsOptional() @IsEnum(CameraType) type?: CameraType;
  @ApiPropertyOptional() @IsOptional() @IsString() stream_url?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() snapshot_url?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() rtsp_url?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cloud_embed_url?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) refresh_interval_secs?: number;
}
