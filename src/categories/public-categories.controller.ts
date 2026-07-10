import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { CategoriesService } from './categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { PublicCategoriesQueryDto } from './dto/public-taxonomy-query.dto';

// Unauthenticated storefront catalog. See PublicDepartmentsController.
@Controller('public/categories')
@Public()
export class PublicCategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  async findAll(
    @Query() query: PublicCategoriesQueryDto,
  ): Promise<CategoryResponseDto[]> {
    const categories = await this.categoriesService.listPublicCategories({
      departmentId: query.departmentId,
      active: query.active,
    });
    return categories.map(CategoryResponseDto.fromEntity);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.getPublicCategory(id),
    );
  }
}
