import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { ClerkUserAuthGuard } from '../auth/guards/clerk-user-auth.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { CategoriesService } from './categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('categories')
@UseGuards(ClerkUserAuthGuard, PermissionGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @RequirePermission({ module: 'categories', action: 'list' })
  async findAll(
    @Query('departmentId') departmentId: string | undefined,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto[]> {
    const categories = await this.categoriesService.listCategories(
      request.user,
      departmentId,
    );
    return categories.map(CategoryResponseDto.fromEntity);
  }

  @Get(':id')
  @RequirePermission({ module: 'categories', action: 'read' })
  async findOne(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.getCategory(request.user, id),
    );
  }

  @Post()
  @RequirePermission({ module: 'categories', action: 'create' })
  async create(
    @Body() dto: CreateCategoryDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.createCategory(request.user, dto),
    );
  }

  @Patch(':id')
  @RequirePermission({ module: 'categories', action: 'update' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.updateCategory(request.user, id, dto),
    );
  }

  @Delete(':id')
  @RequirePermission({ module: 'categories', action: 'delete' })
  async remove(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<void> {
    await this.categoriesService.removeCategory(request.user, id);
  }
}
