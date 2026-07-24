import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
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
  AggregatedInventoryDto,
  InventoryHistoryEventDto,
  InventoryResponseDto,
  OperationResponseDto,
  ProductStockLocationDto,
} from './dto/inventory-response.dto';
import { InventoryService } from './inventory.service';

// Query params arrive as strings; coerce the numeric stock filters.
const toNumber = (value?: string): number | undefined => {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
};

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.GROCER)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // Admin cross-storage list, aggregated by product. Managers + kardist; not
  // grocer-scoped (grocers use the per-storage Productos tab). Individual @Query
  // params (no DTO) so the frontend's page/limit/sortBy don't trip whitelisting.
  @Get('aggregate')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.KARDIST)
  async aggregate(
    @Query('departmentId') departmentId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('atLocationId') atLocationId?: string,
    @Query('minStock') minStock?: string,
    @Query('maxStock') maxStock?: string,
  ): Promise<AggregatedInventoryDto[]> {
    return this.inventoryService.aggregateByProduct({
      departmentId,
      categoryId,
      atLocationId,
      minStock: toNumber(minStock),
      maxStock: toNumber(maxStock),
    });
  }

  // Change timeline for one product across all storages (manual ops + order
  // movements). Managers + kardist.
  @Get('product/:productId/history')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.KARDIST)
  async productHistory(
    @Param('productId') productId: string,
  ): Promise<InventoryHistoryEventDto[]> {
    return this.inventoryService.history({ productId });
  }

  // Change timeline for one storage (grocer-scoped via assertCanManage).
  @Get('location/:locationId/history')
  async locationHistory(
    @Param('locationId') locationId: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<InventoryHistoryEventDto[]> {
    return this.inventoryService.locationHistory(request.user, locationId);
  }

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

  // Per-storage stock of one product across all storages (product detail
  // breakdown). Read-only catalog info, so KARDIST is allowed too and it is not
  // grocer-scoped.
  @Get('product/:productId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.GROCER, Role.KARDIST)
  async stockByProduct(
    @Param('productId') productId: string,
  ): Promise<ProductStockLocationDto[]> {
    return this.inventoryService.stockByProduct(productId);
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
