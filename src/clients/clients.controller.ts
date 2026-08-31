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
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientResponseDto } from './dto/client-response.dto';
import { ListClientsQueryDto } from './dto/list-clients-query.dto';
import type { PaginatedResponse } from '../common/dto/pagination.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
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
  async findByClerkId(
    @Query('clerkId') clerkId: string,
  ): Promise<ClientResponseDto | null> {
    const client = await this.clientsService.findByClerkId(clerkId);
    return client ? ClientResponseDto.fromEntity(client) : null;
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ClientResponseDto> {
    return ClientResponseDto.fromEntity(await this.clientsService.findOne(id));
  }

  @Post()
  async create(
    @Body() createClientDto: CreateClientDto,
  ): Promise<ClientResponseDto> {
    return ClientResponseDto.fromEntity(
      await this.clientsService.create(createClientDto),
    );
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
  ): Promise<ClientResponseDto> {
    return ClientResponseDto.fromEntity(
      await this.clientsService.update(id, updateClientDto),
    );
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await this.clientsService.remove(id);
  }
}
