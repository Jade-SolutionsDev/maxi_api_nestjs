import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { PaginatedResponse } from '../common/dto/pagination.dto';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { ComplaintsService } from './complaints.service';
import {
  AddComplaintNoteDto,
  ChangeComplaintStatusDto,
  ComplaintResponseDto,
  ComplaintsQueryDto,
  CreateComplaintDto,
  UpdateComplaintDto,
} from './dto/complaint.dto';
import { ComplaintStatus } from './entities/complaint.entity';

/**
 * Las quejas que recibe el Call Center.
 *
 * Registrar, consultar y gestionar van con `complaints:create|list|read|
 * update`. **Darla por resuelta tiene ruta y permiso propios** (`close`), para
 * que se pueda conceder a quien supervisa sin dárselo a quien atiende el
 * teléfono (MxH-0064).
 */
@ApiTags('complaints')
@ApiBearerAuth()
@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly complaintsService: ComplaintsService) {}

  @Get()
  @RequirePermission({ module: 'complaints', action: 'list' })
  @ApiOperation({
    summary: 'Listado de quejas, lo último primero',
    description:
      'Filtra por estado, motivo, cliente, pedido, quién la atiende y rango ' +
      'de fechas. `clientId` da las quejas anteriores de un cliente y ' +
      '`orderId` las de un pedido.',
  })
  findAll(
    @Query() query: ComplaintsQueryDto,
  ): Promise<PaginatedResponse<ComplaintResponseDto>> {
    return this.complaintsService.findAll(query);
  }

  @Get(':id')
  @RequirePermission({ module: 'complaints', action: 'read' })
  @ApiOperation({ summary: 'Una queja con su historial completo' })
  @ApiOkResponse({ type: ComplaintResponseDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ComplaintResponseDto> {
    return this.complaintsService.findOne(id);
  }

  @Post()
  @RequirePermission({ module: 'complaints', action: 'create' })
  @ApiOperation({
    summary: 'Registrar una queja',
    description:
      'El motivo sale del nomenclador «complaint-motive», que edita el ' +
      'administrador. El pedido es opcional, y si viene tiene que ser del ' +
      'mismo cliente.',
  })
  @ApiCreatedResponse({ type: ComplaintResponseDto })
  create(
    @Body() dto: CreateComplaintDto,
    @Req() req: AuthenticatedUserRequest,
  ): Promise<ComplaintResponseDto> {
    return this.complaintsService.create(dto, req.user.id);
  }

  @Patch(':id')
  @RequirePermission({ module: 'complaints', action: 'update' })
  @ApiOperation({ summary: 'Corregir el motivo o la descripción, o asignarla' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateComplaintDto,
    @Req() req: AuthenticatedUserRequest,
  ): Promise<ComplaintResponseDto> {
    return this.complaintsService.update(id, dto, req.user.id);
  }

  @Post(':id/status')
  @RequirePermission({ module: 'complaints', action: 'update' })
  @ApiOperation({
    summary: 'Mover la queja entre abierta y en gestión',
    description:
      'Para darla por resuelta está `POST /complaints/:id/resolve`, que pide ' +
      'otro permiso.',
  })
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeComplaintStatusDto,
    @Req() req: AuthenticatedUserRequest,
  ): Promise<ComplaintResponseDto> {
    return this.complaintsService.changeStatus(id, dto, req.user.id, false);
  }

  @Post(':id/resolve')
  @RequirePermission({ module: 'complaints', action: 'close' })
  @ApiOperation({
    summary: 'Dar la queja por resuelta',
    description:
      'Pide decir cómo se resolvió: queda en la queja y en su historial, y ' +
      'es lo que lee quien atienda la próxima llamada del mismo cliente.',
  })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeComplaintStatusDto,
    @Req() req: AuthenticatedUserRequest,
  ): Promise<ComplaintResponseDto> {
    return this.complaintsService.changeStatus(
      id,
      { ...dto, status: ComplaintStatus.RESUELTA },
      req.user.id,
      true,
    );
  }

  @Post(':id/notes')
  @RequirePermission({ module: 'complaints', action: 'update' })
  @ApiOperation({ summary: 'Añadir una nota al historial' })
  addNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddComplaintNoteDto,
    @Req() req: AuthenticatedUserRequest,
  ): Promise<ComplaintResponseDto> {
    return this.complaintsService.addNote(id, dto.note, req.user.id);
  }
}
