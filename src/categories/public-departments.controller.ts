import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { CategoriesService } from './categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { PublicDepartmentsQueryDto } from './dto/public-taxonomy-query.dto';
import { ApiTags } from '@nestjs/swagger';

// Unauthenticated storefront catalog. @Public() bypasses the global AuthGuard;
// no @Roles so RolesGuard passes without a backoffice user. Returns active only.
@ApiTags('storefront')
@Controller('public/departments')
@Public()
export class PublicDepartmentsController {
  constructor(private readonly categoriesService: CategoriesService) {}

  /**
   * List storefront departments. Only valid departments are returned — active
   * departments that have at least one active child category with in-stock
   * products. Pass `featured=true` to restrict to featured departments.
   */
  @Get()
  async findAll(
    @Query() query: PublicDepartmentsQueryDto,
  ): Promise<CategoryResponseDto[]> {
    const departments = await this.categoriesService.listPublicDepartments({
      featured: query.featured,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
    return departments.map(CategoryResponseDto.fromEntity);
  }

  /** Get a single active department by id (404 if missing or inactive). */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.getPublicDepartment(id),
    );
  }
}
