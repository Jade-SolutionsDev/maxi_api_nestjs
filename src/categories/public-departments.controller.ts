import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { CategoriesService } from './categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { PublicDepartmentsQueryDto } from './dto/public-taxonomy-query.dto';

// Unauthenticated storefront catalog. @Public() bypasses the global AuthGuard;
// no @Roles so RolesGuard passes without a backoffice user. Returns active only.
@Controller('public/departments')
@Public()
export class PublicDepartmentsController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  async findAll(
    @Query() query: PublicDepartmentsQueryDto,
  ): Promise<CategoryResponseDto[]> {
    const departments = await this.categoriesService.listPublicDepartments({
      featured: query.featured,
      hasActiveCategories: query.hasActiveCategories,
    });
    return departments.map(CategoryResponseDto.fromEntity);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.getPublicDepartment(id),
    );
  }
}
