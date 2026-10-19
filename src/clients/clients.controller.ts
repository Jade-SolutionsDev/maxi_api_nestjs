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
  Query,
} from '@nestjs/common';
import { ClientAddressesService } from '../client-addresses/client-addresses.service';
import { ClientAddressResponseDto } from '../client-addresses/dto/client-address-response.dto';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { ClientInvitationsService } from './client-invitations.service';
import { ClientsService } from './clients.service';
import {
  ClientInvitationResponseDto,
  InviteClientDto,
} from './dto/invite-client.dto';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientResponseDto } from './dto/client-response.dto';
import { ClientBeneficiariesResponseDto } from './dto/client-beneficiaries-response.dto';
import { ListClientsQueryDto } from './dto/list-clients-query.dto';
import type { PaginatedResponse } from '../common/dto/pagination.dto';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly invitations: ClientInvitationsService,
    private readonly addresses: ClientAddressesService,
  ) {}

  @Get()
  @RequirePermission({ module: 'clients', action: 'list' })
  async findAll(
    @Query() query: ListClientsQueryDto,
  ): Promise<PaginatedResponse<ClientResponseDto>> {
    const result = await this.clientsService.findAll(
      {
        q: query.q,
        isActive: query.isActive,
        includeInvitations: query.includeInvitations,
        ids: query.id
          ? query.id
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : undefined,
      },
      query,
    );

    return {
      // Una fila sin `clerkId` es una invitación pendiente, no un cliente.
      data: result.data.map((client) =>
        ClientResponseDto.fromEntity(client, client.clerkId === null),
      ),
      meta: result.meta,
    };
  }

  @Get('lookup')
  @RequirePermission({ module: 'clients', action: 'list' })
  async findByClerkId(
    @Query('clerkId') clerkId: string,
  ): Promise<ClientResponseDto | null> {
    const client = await this.clientsService.findByClerkId(clerkId);
    return client ? ClientResponseDto.fromEntity(client) : null;
  }

  @Get(':id')
  @RequirePermission({ module: 'clients', action: 'read' })
  async findOne(@Param('id') id: string): Promise<ClientResponseDto> {
    return ClientResponseDto.fromEntity(await this.clientsService.findOne(id));
  }

  /**
   * A quién le manda pedidos este cliente.
   *
   * Mismo permiso que ver la ficha, y no menos: son nombre, carné y teléfono de
   * **terceros** que no son el cliente.
   */
  @Get(':id/beneficiaries')
  @RequirePermission({ module: 'clients', action: 'read' })
  @ApiOperation({
    summary: 'Personas a las que este cliente ha mandado pedidos',
  })
  @ApiOkResponse({ type: ClientBeneficiariesResponseDto })
  async findBeneficiaries(
    @Param('id') id: string,
  ): Promise<ClientBeneficiariesResponseDto> {
    return this.clientsService.findBeneficiaries(id);
  }

  /**
   * La libreta de direcciones de este cliente (MxH-0178).
   *
   * **Solo lectura, y no es la dirección de un pedido.** La libreta la gestiona
   * el cliente desde la tienda, y cada pedido guarda su propia copia congelada
   * al comprar (`snapshotAddress`). Mirar aquí dice dónde vive hoy, no a dónde
   * se entregó algo ya vendido; para eso está el detalle del pedido.
   *
   * Mismo permiso que ver la ficha, y por el mismo motivo que los
   * beneficiarios: son direcciones de casas, con teléfono y a veces carné.
   *
   * El `ParseUUIDPipe` no está de adorno: `GET /clients/:id` responde 500 con
   * un id mal formado porque no lo valida (**MxH-0143**), y esta ruta nueva no
   * repite el fallo.
   */
  @Get(':id/addresses')
  @RequirePermission({ module: 'clients', action: 'read' })
  @ApiOperation({ summary: 'Direcciones guardadas de este cliente' })
  @ApiOkResponse({ type: [ClientAddressResponseDto] })
  async findAddresses(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClientAddressResponseDto[]> {
    // Comprobar que el cliente existe antes de listar: un cliente inventado
    // responde 404, y no una libreta vacía como si la cuenta fuera real.
    await this.clientsService.findOne(id);

    return this.addresses.toResponse(await this.addresses.findAllForClient(id));
  }

  /**
   * Alta de un cliente que compró por otro canal.
   *
   * Va antes que `POST /clients` a propósito: ese espeja una cuenta que YA
   * existe en Clerk y pide su `clerkId`; este crea la cuenta de verdad.
   */
  @Post('invitations')
  @RequirePermission({ module: 'clients', action: 'create' })
  @ApiOperation({ summary: 'Invitar a alguien a tener cuenta en la tienda' })
  @ApiOkResponse({ type: ClientInvitationResponseDto })
  async invite(
    @Body() dto: InviteClientDto,
  ): Promise<ClientInvitationResponseDto> {
    return this.invitations.invite(dto);
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  @RequirePermission({ module: 'clients', action: 'create' })
  @ApiOperation({ summary: 'Retirar una invitación pendiente' })
  async revokeInvitation(@Param('id') id: string): Promise<void> {
    await this.invitations.revocar(id);
  }

  @Post()
  @RequirePermission({ module: 'clients', action: 'create' })
  async create(
    @Body() createClientDto: CreateClientDto,
  ): Promise<ClientResponseDto> {
    return ClientResponseDto.fromEntity(
      await this.clientsService.create(createClientDto),
    );
  }

  @Patch(':id')
  @RequirePermission({ module: 'clients', action: 'update' })
  async update(
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
  ): Promise<ClientResponseDto> {
    return ClientResponseDto.fromEntity(
      await this.clientsService.update(id, updateClientDto),
    );
  }

  @Delete(':id')
  @RequirePermission({ module: 'clients', action: 'delete' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.clientsService.remove(id);
  }
}
