import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
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
  async findAll(
    @Query() query: PublicCategoriesQueryDto,
  ): Promise<CategoryResponseDto[]> {
    const categories = await this.categoriesService.listPublicCategories({
      departmentId: query.departmentId,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
    return categories.map(CategoryResponseDto.fromEntity);
  }

  /** Get a single active category by id (404 if missing or inactive). */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.getPublicCategory(id),
    );
  }
}
