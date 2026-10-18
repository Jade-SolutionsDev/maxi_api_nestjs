import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { CmsPopupsService } from './cms-popups.service';
import {
  CmsPopupResponseDto,
  CreateCmsPopupDto,
  UpdateCmsPopupDto,
} from './dto/cms-popup.dto';

/**
 * El aviso emergente de la tienda, desde la administración. `MxH-0037`.
 *
 * Va con los permisos de `cms-pages` a propósito, en vez de estrenar un módulo
 * propio: es contenido del sitio web, y quien ya publica páginas —hoy el rol
 * «Responsable de la web»— puede publicar esto sin que nadie tenga que
 * acordarse de concederle un permiso nuevo. Estrenar módulo habría dejado la
 * pantalla a oscuras para todos menos el superadministrador, que es justo lo
 * que le pasó a la de Cobros (`MxH-0063`).
 */
@ApiTags('cms')
@ApiBearerAuth()
@Controller('cms/popups')
export class CmsPopupsController {
  constructor(private readonly popups: CmsPopupsService) {}

  @Get()
  @RequirePermission({ module: 'cms-pages', action: 'list' })
  @ApiOperation({ summary: 'Todos los avisos, publicados o no' })
  list(): Promise<CmsPopupResponseDto[]> {
    return this.popups.list();
  }

  @Get(':id')
  @RequirePermission({ module: 'cms-pages', action: 'read' })
  @ApiOperation({ summary: 'Un aviso, para editarlo o previsualizarlo' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CmsPopupResponseDto> {
    return this.popups.findOne(id);
  }

  @Post()
  @RequirePermission({ module: 'cms-pages', action: 'create' })
  @ApiOperation({
    summary: 'Crear un aviso',
    description: 'Nace como borrador: publicar es un paso aparte.',
  })
  create(
    @Body() dto: CreateCmsPopupDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CmsPopupResponseDto> {
    return this.popups.create(dto, request.user.id);
  }

  @Patch(':id')
  @RequirePermission({ module: 'cms-pages', action: 'update' })
  @ApiOperation({ summary: 'Editar un aviso' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsPopupDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CmsPopupResponseDto> {
    return this.popups.update(id, dto, request.user.id);
  }

  @Post(':id/publish')
  @RequirePermission({ module: 'cms-pages', action: 'publish' })
  @ApiOperation({
    summary: 'Publicarlo',
    description:
      'Falla con 409 si ya hay otro aviso publicado cuyas fechas se solapen: ' +
      'solo puede verse uno a la vez.',
  })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CmsPopupResponseDto> {
    return this.popups.publish(id, request.user.id);
  }

  @Post(':id/unpublish')
  @RequirePermission({ module: 'cms-pages', action: 'publish' })
  @ApiOperation({ summary: 'Retirarlo de la tienda sin borrarlo' })
  unpublish(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CmsPopupResponseDto> {
    return this.popups.unpublish(id, request.user.id);
  }

  @Delete(':id')
  @RequirePermission({ module: 'cms-pages', action: 'delete' })
  @HttpCode(204)
  @ApiOperation({ summary: 'Borrarlo' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.popups.remove(id);
  }
}
