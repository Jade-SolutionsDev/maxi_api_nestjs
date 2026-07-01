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
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { ClerkUserAuthGuard } from '../auth/guards/clerk-user-auth.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@Controller('products')
@UseGuards(ClerkUserAuthGuard, PermissionGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermission({ module: 'products', action: 'list' })
  async findAll(
    @Query('categoryId') categoryId: string | undefined,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<ProductResponseDto[]> {
    const products = await this.productsService.findAll(
      request.user,
      categoryId,
    );
    return products.map(ProductResponseDto.fromEntity);
  }

  @Get(':id')
  @RequirePermission({ module: 'products', action: 'read' })
  async findOne(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.fromEntity(
      await this.productsService.findOne(request.user, id),
    );
  }

  @Post()
  @RequirePermission({ module: 'products', action: 'create' })
  async create(
    @Body() dto: CreateProductDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.fromEntity(
      await this.productsService.create(request.user, dto),
    );
  }

  @Patch(':id')
  @RequirePermission({ module: 'products', action: 'update' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.fromEntity(
      await this.productsService.update(request.user, id, dto),
    );
  }

  @Delete(':id')
  @RequirePermission({ module: 'products', action: 'delete' })
  async remove(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<void> {
    await this.productsService.remove(request.user, id);
  }
}
