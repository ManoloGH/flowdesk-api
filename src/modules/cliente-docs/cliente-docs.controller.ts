import { Controller, Post, Get, Param, Body, Res, Query } from '@nestjs/common';
import type { Response } from 'express';
import { ClienteDocsService } from './cliente-docs.service';
import { CreateClienteDocDto } from './dto/create-cliente-doc.dto';
import { Public } from '../auth/decorators/public.decorator';

@Controller('cliente-docs')
export class ClienteDocsController {
  constructor(private readonly service: ClienteDocsService) {}

  @Public()
  @Post()
  create(@Body() dto: CreateClienteDocDto) {
    return this.service.create(dto);
  }

  @Public()
  @Get(':id')
  async viewHtml(@Param('id') id: string, @Res() res: Response) {
    const doc = await this.service.findOne(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(doc.html);
  }

  @Get()
  findAll(@Query('tipo') tipo?: string) {
    return this.service.findAll(tipo);
  }
}
