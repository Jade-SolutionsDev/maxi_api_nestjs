import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { TAXONOMY_CACHE } from '../common/constants/cache-control';
import { Public } from '../common/decorators/public.decorator';
import {
  ApiPaginatedResponse,
  paginate,
  PaginatedDto,
} from '../common/dto/paginated.dto';
import { CategoriesService } from './categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { PublicCategoriesQueryDto } from './dto/public-taxonomy-query.dto';
import { ApiTags } from '@nestjs/swagger';

// Unauthenticated storefront catalog. See PublicDepartmentsController.
@ApiTags('storefront')
@Controller('public/categories')
@Public()
export class PublicCategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  /**
   * List storefront categories. Only valid categories are returned — active
   * categories that have at least one active product with positive stock. Pass
   * `departmentId` to list the categories of a single department.
   */
  @Get()
  @Header('Cache-Control', TAXONOMY_CACHE)
  @ApiPaginatedResponse(CategoryResponseDto)
  async findAll(
    @Query() query: PublicCategoriesQueryDto,
  ): Promise<PaginatedDto<CategoryResponseDto>> {
    const categories = await this.categoriesService.listPublicCategories({
      departmentId: query.departmentId,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      municipalityId: query.municipalityId,
    });
    const page = paginate(categories, query.page, query.limit);
    const counts = await this.categoriesService.countValidProducts(
      page.items.map((c) => c.id),
      query.municipalityId,
    );
    return {
      ...page,
      items: page.items.map((c) => {
        const dto = CategoryResponseDto.fromEntity(c);
        dto.productsCount = counts.get(c.id) ?? 0;
        return dto;
      }),
    };
  }

  /** Get a single active category by id (404 if missing or inactive). */
  @Get(':id')
  @Header('Cache-Control', TAXONOMY_CACHE)
  async findOne(@Param('id') id: string): Promise<CategoryResponseDto> {
    const category = await this.categoriesService.getPublicCategory(id);
    const dto = CategoryResponseDto.fromEntity(category);
    dto.productsCount =
      (await this.categoriesService.countValidProducts([id])).get(id) ?? 0;
    return dto;
  }
}
