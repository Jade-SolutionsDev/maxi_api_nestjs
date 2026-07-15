import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { CreateStockLocationDto } from './dto/create-stock-location.dto';
import { StockLocationResponseDto } from './dto/stock-location-response.dto';
import { UpdateStockLocationDto } from './dto/update-stock-location.dto';
import { StockLocationsService } from './stock-locations.service';

const toBoolean = (value?: string): boolean | undefined => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

// Access is gated per-action by managed permissions; SUPER_ADMIN/ADMIN bypass,
// GROCER keeps its baseline (list/read/update) via DEFAULT_ROLE_PERMISSIONS. The
// service still scopes non-managers to their assigned storages.
@ApiTags('stock-locations')
@ApiBearerAuth()
@Controller('stock-locations')
export class StockLocationsController {
  constructor(private readonly stockLocationsService: StockLocationsService) {}

  @Get()
  @RequirePermission({ module: 'stock-locations', action: 'list' })
  async findAll(
    @Req() request: AuthenticatedUserRequest,
    @Query('q') q?: string,
    @Query('isActive') isActive?: string,
  ): Promise<StockLocationResponseDto[]> {
    return this.stockLocationsService.findAll(request.user, {
      q,
      isActive: toBoolean(isActive),
    });
  }

  @Get(':id')
  @RequirePermission({ module: 'stock-locations', action: 'read' })
  async findOne(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<StockLocationResponseDto> {
    return this.stockLocationsService.findOne(request.user, id);
  }

  @Post()
  @RequirePermission({ module: 'stock-locations', action: 'create' })
  async create(
    @Body() dto: CreateStockLocationDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<StockLocationResponseDto> {
    return this.stockLocationsService.create(request.user, dto);
  }

  @Patch(':id')
  @RequirePermission({ module: 'stock-locations', action: 'update' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStockLocationDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<StockLocationResponseDto> {
    return this.stockLocationsService.update(request.user, id, dto);
  }

  @Delete(':id')
  @RequirePermission({ module: 'stock-locations', action: 'delete' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.stockLocationsService.remove(id);
  }
}
