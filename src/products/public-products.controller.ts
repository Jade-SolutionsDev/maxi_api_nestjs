import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ProductResponseDto } from './dto/product-response.dto';
import { PublicProductsQueryDto } from './dto/public-products-query.dto';
import { ProductsService } from './products.service';
import { CategoriesService } from '../categories/categories.service';
import { CategoryResponseDto } from '../categories/dto/category-response.dto';

// Unauthenticated storefront catalog. @Public() bypasses the global AuthGuard;
// no @Roles so RolesGuard passes without a backoffice user. See the other
// public/* controllers (categories, departments).
@ApiTags('storefront')
@Controller('public/products')
@Public()
export class PublicProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly categoryService: CategoriesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List storefront products (in-stock, with calculated price)',
    description:
      'Active products filterable by storage location, category, department, ' +
      'name and price range. Only products with stock > 0 are returned unless ' +
      '`includeOutOfStock=true`. `finalPrice` is the discounted price. ' +
      '`amount`/`available` hold the stock at `locationId` when given, otherwise ' +
      'the total across all storages.',
  })
  @ApiOkResponse({ type: ProductResponseDto, isArray: true })
  async findAll(
    @Query() query: PublicProductsQueryDto,
  ): Promise<ProductResponseDto[]> {
    const rows = await this.productsService.findStorefront(
      {
        q: query.q,
        categoryId: query.categoryId,
        departmentId: query.departmentId,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        featured: query.featured,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
      {
        locationId: query.locationId,
        includeOutOfStock: query.includeOutOfStock ?? false,
        limit: query.limit,
      },
    );
    return rows.map((r) =>
      ProductResponseDto.fromEntity(r.product, r.stock, undefined),
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one storefront product (total stock across storages)',
  })
  @ApiOkResponse({ type: ProductResponseDto })
  async findOne(@Param('id') id: string): Promise<ProductResponseDto> {
    const product = await this.productsService.findOne(id);
    const category = product.categoryId
      ? CategoryResponseDto.fromEntity(
          await this.categoryService.getCategory(product.categoryId),
        )
      : undefined;
    if (!product.isActive) {
      // Inactive products are not part of the storefront catalog.
      throw new NotFoundException(`Product with id "${id}" not found`);
    }
    const amounts = await this.productsService.amountsFor([id]);
    return ProductResponseDto.fromEntity(
      product,
      amounts.get(id) ?? 0,
      category,
    );
  }
}
