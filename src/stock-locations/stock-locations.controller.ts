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
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import { CreateStockLocationDto } from './dto/create-stock-location.dto';
import { StockLocationResponseDto } from './dto/stock-location-response.dto';
import { UpdateStockLocationDto } from './dto/update-stock-location.dto';
import { StockLocationsService } from './stock-locations.service';

const toBoolean = (value?: string): boolean | undefined => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

@Controller('stock-locations')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class StockLocationsController {
  constructor(private readonly stockLocationsService: StockLocationsService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.GROCER)
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
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.GROCER)
  async findOne(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<StockLocationResponseDto> {
    return this.stockLocationsService.findOne(request.user, id);
  }

  @Post()
  async create(
    @Body() dto: CreateStockLocationDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<StockLocationResponseDto> {
    return this.stockLocationsService.create(request.user, dto);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.GROCER)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStockLocationDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<StockLocationResponseDto> {
    return this.stockLocationsService.update(request.user, id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await this.stockLocationsService.remove(id);
  }
}
