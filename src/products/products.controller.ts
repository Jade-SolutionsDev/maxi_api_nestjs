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
import { CreateProductDto } from './dto/create-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

// Query params arrive as strings; coerce the numeric/boolean filters.
const toNumber = (value?: string): number | undefined => {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
};
const toBoolean = (value?: string): boolean | undefined => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

// Global catalog: reads are open to every backoffice role; writes are limited to
// SUPER_ADMIN/ADMIN/KARDIST (method-level @Roles overrides the class default).
@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.KARDIST)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.GROCER, Role.KARDIST)
  async findAll(
    @Query('q') q?: string,
    @Query('departmentId') departmentId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('featured') featured?: string,
    @Query('isActive') isActive?: string,
  ): Promise<ProductResponseDto[]> {
    const products = await this.productsService.findAll({
      q,
      departmentId,
      categoryId,
      minPrice: toNumber(minPrice),
      maxPrice: toNumber(maxPrice),
      featured: toBoolean(featured),
      isActive: toBoolean(isActive),
    });
    return products.map(ProductResponseDto.fromEntity);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.GROCER, Role.KARDIST)
  async findOne(@Param('id') id: string): Promise<ProductResponseDto> {
    return ProductResponseDto.fromEntity(
      await this.productsService.findOne(id),
    );
  }

  @Post()
  async create(@Body() dto: CreateProductDto): Promise<ProductResponseDto> {
    return ProductResponseDto.fromEntity(
      await this.productsService.create(dto),
    );
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.fromEntity(
      await this.productsService.update(id, dto),
    );
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await this.productsService.remove(id);
  }
}
