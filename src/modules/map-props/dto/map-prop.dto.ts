import { IsString, IsNotEmpty, IsOptional, IsInt, IsBoolean, IsIn, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

const PROP_TYPES = ['desk', 'door', 'shelf', 'board', 'coffee', 'plant', 'locker', 'screen', 'custom'];
const ACTION_TYPES = ['navigate_to', 'open_tool', 'start_meeting', 'open_url', 'trigger_event'];

export class CreateMapPropDto {
  @ApiProperty({ example: 'Estante de Archivos' })
  @IsString() @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: PROP_TYPES })
  @IsIn(PROP_TYPES)
  prop_type: string;

  @ApiProperty() @IsInt() x: number;
  @ApiProperty() @IsInt() y: number;

  @ApiPropertyOptional({ default: 32 }) @IsInt() @IsOptional() width?: number;
  @ApiPropertyOptional({ default: 32 }) @IsInt() @IsOptional() height?: number;

  @ApiPropertyOptional({ description: 'URL de imagen PNG subida por el cliente' })
  @IsString() @IsOptional() icon_url?: string;

  @ApiPropertyOptional({ description: 'Nombre del ícono prediseñado de FlowDesk' })
  @IsString() @IsOptional() icon_default?: string;

  @ApiProperty({ enum: ACTION_TYPES, example: 'open_tool' })
  @IsIn(ACTION_TYPES)
  action_type: string;

  @ApiProperty({ example: 'knowledge_base' })
  @IsString() @IsNotEmpty()
  action_target: string;

  @ApiPropertyOptional({ example: 'Abre la base de conocimiento' })
  @IsString() @IsOptional() tooltip?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional() room_id?: string;
}

export class UpdateMapPropDto extends PartialType(CreateMapPropDto) {
  @ApiPropertyOptional() @IsBoolean() @IsOptional() is_active?: boolean;
}

export class UpdateCampusConfigDto {
  @ApiPropertyOptional({ enum: ['template', 'upload', 'grid'], default: 'template' })
  @IsIn(['template', 'upload', 'grid']) @IsOptional() map_source?: string;

  @ApiPropertyOptional({ enum: ['corporate', 'startup', 'real_estate', 'construction'] })
  @IsString() @IsOptional() map_template?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() map_json_url?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() tileset_url?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() background_color?: string;
  @ApiPropertyOptional() @IsInt() @IsOptional() grid_size?: number;
}
