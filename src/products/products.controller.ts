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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

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

// Global catalog: access is gated per-action by managed permissions
// (@RequirePermission). SUPER_ADMIN/ADMIN bypass; GROCER/KARDIST get their
// baseline via DEFAULT_ROLE_PERMISSIONS plus any assigned managed role.
@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermission({ module: 'products', action: 'list' })
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
    const amounts = await this.productsService.amountsFor(
      products.map((p) => p.id),
    );
    return products.map((p) =>
      ProductResponseDto.fromEntity(p, amounts.get(p.id) ?? 0, undefined),
    );
  }

  @Get(':id')
  @RequirePermission({ module: 'products', action: 'read' })
  async findOne(@Param('id') id: string): Promise<ProductResponseDto> {
    const product = await this.productsService.findOne(id);
    const amounts = await this.productsService.amountsFor([product.id]);
    return ProductResponseDto.fromEntity(
      product,
      amounts.get(product.id) ?? 0,
      undefined,
    );
  }

  @Post()
  @RequirePermission({ module: 'products', action: 'create' })
  async create(@Body() dto: CreateProductDto): Promise<ProductResponseDto> {
    return ProductResponseDto.fromEntity(
      await this.productsService.create(dto),
      undefined,
      undefined,
    );
  }

  @Patch(':id')
  @RequirePermission({ module: 'products', action: 'update' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.fromEntity(
      await this.productsService.update(id, dto),
      undefined,
      undefined,
    );
  }

  @Delete(':id')
  @RequirePermission({ module: 'products', action: 'delete' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.productsService.remove(id);
  }
}
