import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import { CreateOperationDto } from './dto/create-operation.dto';
import {
  InventoryResponseDto,
  OperationResponseDto,
} from './dto/inventory-response.dto';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.GROCER)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // Current stock at a storage (one row per product). Used by the Productos tab.
  @Get()
  async list(
    @Query('locationId') locationId: string | undefined,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<InventoryResponseDto[]> {
    if (!locationId) {
      throw new BadRequestException('locationId is required');
    }
    return this.inventoryService.listInventory(request.user, locationId);
  }

  // Operation history (audit) for a storage.
  @Get('operations')
  async listOperations(
    @Query('locationId') locationId: string | undefined,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<OperationResponseDto[]> {
    if (!locationId) {
      throw new BadRequestException('locationId is required');
    }
    return this.inventoryService.listOperations(request.user, locationId);
  }

  // Create an In / Out / Transfer operation (atomic, multi-product).
  @Post('operations')
  async createOperation(
    @Body() dto: CreateOperationDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<OperationResponseDto> {
    return this.inventoryService.createOperation(request.user, dto);
  }
}
