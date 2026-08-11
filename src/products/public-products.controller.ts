import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import {
  ApiPaginatedResponse,
  paginate,
  PaginatedDto,
} from '../common/dto/paginated.dto';
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
      'Active products filterable by storage location, delivery area ' +
      '(`municipalityId`/`provinceId`), category, department, name and price ' +
      'range. Only products with available stock > 0 are returned unless ' +
      '`includeOutOfStock=true`. `finalPrice` is the discounted price. ' +
      '`amount`/`available` hold the sellable stock (net of pending-order ' +
      'reservations): at `locationId` when given, else summed across the ' +
      'storages covering the selected municipality/province, else across all ' +
      'storages. Paginated: pass `page` + `limit` (omit `limit` to get ' +
      'everything on one page).',
  })
  @ApiPaginatedResponse(ProductResponseDto)
  async findAll(
    @Query() query: PublicProductsQueryDto,
  ): Promise<PaginatedDto<ProductResponseDto>> {
    const rows = await this.productsService.findStorefront(
      {
        q: query.q,
        categoryId: query.categoryId,
        departmentId: query.departmentId,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        priceField: 'finalPrice',
        featured: query.featured,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
      {
        locationId: query.locationId,
        provinceId: query.provinceId,
        municipalityId: query.municipalityId,
        includeOutOfStock: query.includeOutOfStock ?? false,
      },
    );
    const page = paginate(rows, query.page, query.limit);
    return {
      ...page,
      items: page.items.map((r) =>
        ProductResponseDto.fromEntity(r.product, r.stock, undefined),
      ),
    };
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Get one storefront product (available stock across storages, net of reservations)',
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
    const available = await this.productsService.availableFor([id]);
    return ProductResponseDto.fromEntity(
      product,
      available.get(id) ?? 0,
      category,
    );
  }
}
