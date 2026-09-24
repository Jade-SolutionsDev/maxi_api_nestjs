import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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
      data: result.data.map(ClientResponseDto.fromEntity),
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
