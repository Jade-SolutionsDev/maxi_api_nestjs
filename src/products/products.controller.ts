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
import { CreateProductDto } from './dto/create-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@Controller('products')
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.GROCER)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
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
  async findOne(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.fromEntity(
      await this.productsService.findOne(request.user, id),
    );
  }

  @Post()
  async create(
    @Body() dto: CreateProductDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.fromEntity(
      await this.productsService.create(request.user, dto),
    );
  }

  @Patch(':id')
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
  async remove(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<void> {
    await this.productsService.remove(request.user, id);
  }
}
