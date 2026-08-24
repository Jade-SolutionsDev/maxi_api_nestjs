import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ClerkClientAuthGuard } from '../auth/guards/clerk-client-auth.guard';
import type { AuthenticatedClientRequest } from '../auth/types/authenticated-request';
import { Public } from '../common/decorators/public.decorator';
import { ClientAddressesService } from './client-addresses.service';
import { ClientAddressResponseDto } from './dto/client-address-response.dto';
import { CreateClientAddressDto } from './dto/create-client-address.dto';
import { UpdateClientAddressDto } from './dto/update-client-address.dto';

// Saved addresses of the authenticated storefront customer. @Public() bypasses
// the global backoffice AuthGuard; ClerkClientAuthGuard authenticates the
// customer and attaches request.client — same pattern as the cart and orders.
//
// Every route is scoped by request.client.id, and an address belonging to
// somebody else answers 404, never 403.
@ApiTags('storefront')
@ApiBearerAuth()
@Controller('storefront/addresses')
@Public()
@UseGuards(ClerkClientAuthGuard)
export class ClientAddressesController {
  constructor(private readonly addressesService: ClientAddressesService) {}

  @Get()
  @ApiOperation({
    summary: "List the customer's saved addresses",
    description:
      'The default address comes first, then the newest. `municipalityName` ' +
      'and `provinceName` are resolved from the geography catalog, so the ' +
      'storefront never needs a second round-trip to print an address.',
  })
  @ApiOkResponse({ type: [ClientAddressResponseDto] })
  async findAll(
    @Req() req: AuthenticatedClientRequest,
  ): Promise<ClientAddressResponseDto[]> {
    return this.addressesService.toResponse(
      await this.addressesService.findAllForClient(req.client.id),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one saved address' })
  @ApiOkResponse({ type: ClientAddressResponseDto })
  @ApiNotFoundResponse({ description: 'No such address for this customer.' })
  async findOne(
    @Req() req: AuthenticatedClientRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClientAddressResponseDto> {
    return this.addressesService.toResponseOne(
      await this.addressesService.findOneForClient(req.client.id, id),
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Save a new address',
    description:
      'The first address a customer saves becomes the default one regardless ' +
      'of `isDefault`.',
  })
  @ApiCreatedResponse({ type: ClientAddressResponseDto })
  @ApiConflictResponse({
    description: 'The per-customer address cap was reached.',
  })
  async create(
    @Req() req: AuthenticatedClientRequest,
    @Body() dto: CreateClientAddressDto,
  ): Promise<ClientAddressResponseDto> {
    return this.addressesService.toResponseOne(
      await this.addressesService.create(req.client.id, dto),
    );
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a saved address',
    description:
      'Does not change which address is the default one — use ' +
      '`PATCH /storefront/addresses/{id}/default` for that. Orders already ' +
      'placed keep their own copy of the address and are unaffected.',
  })
  @ApiOkResponse({ type: ClientAddressResponseDto })
  @ApiNotFoundResponse({ description: 'No such address for this customer.' })
  async update(
    @Req() req: AuthenticatedClientRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientAddressDto,
  ): Promise<ClientAddressResponseDto> {
    return this.addressesService.toResponseOne(
      await this.addressesService.update(req.client.id, id, dto),
    );
  }

  @Patch(':id/default')
  @ApiOperation({ summary: 'Make this the default address' })
  @ApiOkResponse({ type: ClientAddressResponseDto })
  @ApiNotFoundResponse({ description: 'No such address for this customer.' })
  async setDefault(
    @Req() req: AuthenticatedClientRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClientAddressResponseDto> {
    return this.addressesService.toResponseOne(
      await this.addressesService.setDefault(req.client.id, id),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a saved address',
    description:
      'Soft delete. If it was the default one, the newest surviving address ' +
      'takes over.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'No such address for this customer.' })
  async remove(
    @Req() req: AuthenticatedClientRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.addressesService.remove(req.client.id, id);
  }
}
