import { Controller, Get, Post, Body, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IntegrationsService } from './integrations.service';
import { IsArray, IsString, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class WishlistItemDto {
  @IsString() provider: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() notes?: string;
}

class RegisterWishlistDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => WishlistItemDto)
  items: WishlistItemDto[];
}

@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('catalog')
  getCatalog() {
    return this.integrations.getCatalog();
  }

  @Get('status')
  getStatus(@Request() req: any) {
    return this.integrations.getStatus(req.tenant_id);
  }

  @Post('wishlist')
  registerWishlist(@Request() req: any, @Body() dto: RegisterWishlistDto) {
    return this.integrations.registerWishlist(req.tenant_id, dto.items);
  }
}
