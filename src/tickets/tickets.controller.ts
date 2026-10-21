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
import {
  AddTicketCommentDto,
  ChangeTicketStatusDto,
  CloseTicketDto,
  CreateTicketDto,
  ReopenTicketDto,
  TicketResponseDto,
  TicketsQueryDto,
  UpdateTicketDto,
} from './dto/ticket.dto';
import { TicketStatus } from './entities/ticket.entity';
import { TicketsService } from './tickets.service';

/**
 * Las incidencias internas de la tienda (MxH-0065).
 *
 * Abrir, consultar y gestionar van con `tickets:create|list|read|update`.
 * **Cerrar tiene ruta y permiso propios** (`close`), y reabrir uno cerrado
 * también: deshacer un visto bueno es tan serio como darlo.
 *
 * Marcar «resuelto» no pide `close` a propósito — lo hace quien arregló, y el
 * sentido de tener cuatro estados es que su palabra no sea la última.
 */
@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  @RequirePermission({ module: 'tickets', action: 'list' })
  @ApiOperation({
    summary: 'Listado de tickets, lo último primero',
    description:
      'Filtra por estado, prioridad, categoría, persona asignada, quién lo ' +
      'abrió y rango de fechas. `q` busca en el título y en la descripción, ' +
      'sin tildes.',
  })
  findAll(
    @Query() query: TicketsQueryDto,
  ): Promise<PaginatedResponse<TicketResponseDto>> {
    return this.ticketsService.findAll(query);
  }

  @Get(':id')
  @RequirePermission({ module: 'tickets', action: 'read' })
  @ApiOperation({ summary: 'Un ticket con su historial completo' })
  @ApiOkResponse({ type: TicketResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<TicketResponseDto> {
    return this.ticketsService.findOne(id);
  }

  @Post()
  @RequirePermission({ module: 'tickets', action: 'create' })
  @ApiOperation({
    summary: 'Abrir un ticket',
    description:
      'La categoría sale del nomenclador «ticket-category», que edita el ' +
      'administrador. Las imágenes son direcciones devueltas por ' +
      '`POST /uploads/image?prefix=tickets`.',
  })
  @ApiCreatedResponse({ type: TicketResponseDto })
  create(
    @Body() dto: CreateTicketDto,
    @Req() req: AuthenticatedUserRequest,
  ): Promise<TicketResponseDto> {
    return this.ticketsService.create(dto, req.user.id);
  }

  @Patch(':id')
  @RequirePermission({ module: 'tickets', action: 'update' })
  @ApiOperation({
    summary: 'Corregir el ticket, cambiar su prioridad o asignarlo',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
    @Req() req: AuthenticatedUserRequest,
  ): Promise<TicketResponseDto> {
    return this.ticketsService.update(id, dto, req.user.id);
  }

  @Post(':id/status')
  @RequirePermission({ module: 'tickets', action: 'update' })
  @ApiOperation({
    summary: 'Mover el ticket entre abierto, en curso y resuelto',
    description:
      'Pasar a «resuelto» exige decir qué se hizo. Para cerrarlo está ' +
      '`POST /tickets/:id/close`, que pide otro permiso.',
  })
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeTicketStatusDto,
    @Req() req: AuthenticatedUserRequest,
  ): Promise<TicketResponseDto> {
    return this.ticketsService.changeStatus(id, dto, req.user.id, false);
  }

  @Post(':id/close')
  @RequirePermission({ module: 'tickets', action: 'close' })
  @ApiOperation({
    summary: 'Cerrar el ticket: confirmar que lo resuelto está resuelto',
    description:
      'No borra ni reescribe lo que escribió quien lo arregló: le pone fecha ' +
      'al visto bueno. Solo se puede cerrar un ticket que esté «resuelto». El ' +
      'cuerpo puede ir vacío: el estado lo decide la ruta.',
  })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseTicketDto,
    @Req() req: AuthenticatedUserRequest,
  ): Promise<TicketResponseDto> {
    return this.ticketsService.changeStatus(
      id,
      { ...dto, status: TicketStatus.CERRADO },
      req.user.id,
      true,
    );
  }

  @Post(':id/reopen')
  @RequirePermission({ module: 'tickets', action: 'close' })
  @ApiOperation({
    summary: 'Reabrir un ticket cerrado',
    description:
      'Pide el mismo permiso que cerrar —deshacer un visto bueno es tan ' +
      'serio como darlo— y exige decir por qué. Vuelve a «en curso» y borra ' +
      'la resolución anterior, que ya no describe la verdad.',
  })
  reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReopenTicketDto,
    @Req() req: AuthenticatedUserRequest,
  ): Promise<TicketResponseDto> {
    return this.ticketsService.changeStatus(
      id,
      { ...dto, status: TicketStatus.EN_CURSO },
      req.user.id,
      true,
    );
  }

  @Post(':id/comments')
  @RequirePermission({ module: 'tickets', action: 'create' })
  @ApiOperation({
    summary: 'Comentar el ticket',
    description:
      'Va con `create` y no con `update`: quien puede abrir una incidencia ' +
      'puede contar lo que sabe de la que abrió otro, sin poder editarla.',
  })
  addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTicketCommentDto,
    @Req() req: AuthenticatedUserRequest,
  ): Promise<TicketResponseDto> {
    return this.ticketsService.addComment(id, dto.note, req.user.id);
  }
}
