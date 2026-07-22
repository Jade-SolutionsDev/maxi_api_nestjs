import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import {
  ApiPaginatedResponse,
  paginate,
  PaginatedDto,
} from '../common/dto/paginated.dto';
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
  @ApiPaginatedResponse(CategoryResponseDto)
  async findAll(
    @Query() query: PublicDepartmentsQueryDto,
  ): Promise<PaginatedDto<CategoryResponseDto>> {
    const departments = await this.categoriesService.listPublicDepartments({
      featured: query.featured,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
    const page = paginate(departments, query.page, query.limit);
    const counts = await this.categoriesService.countValidChildren(
      page.items.map((d) => d.id),
    );
    return {
      ...page,
      items: page.items.map((d) => {
        const dto = CategoryResponseDto.fromEntity(d);
        dto.childrenCount = counts.get(d.id) ?? 0;
        return dto;
      }),
    };
  }

  /** Get a single active department by id (404 if missing or inactive). */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<CategoryResponseDto> {
    const department = await this.categoriesService.getPublicDepartment(id);
    const dto = CategoryResponseDto.fromEntity(department);
    dto.childrenCount =
      (await this.categoriesService.countValidChildren([id])).get(id) ?? 0;
    return dto;
  }
}
