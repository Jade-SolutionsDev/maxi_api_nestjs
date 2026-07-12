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
} from '@nestjs/common';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import { CategoriesService } from './categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('categories')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.GROCER, Role.KARDIST)
  async findAll(
    @Query('departmentId') departmentId: string | undefined,
    @Query('q') q: string | undefined,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto[]> {
    const categories = await this.categoriesService.listCategories(
      request.user,
      departmentId,
      q,
    );
    return categories.map(CategoryResponseDto.fromEntity);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.GROCER, Role.KARDIST)
  async findOne(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.getCategory(request.user, id),
    );
  }

  @Post()
  async create(
    @Body() dto: CreateCategoryDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.createCategory(request.user, dto),
    );
  }

  @Patch(':id')
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
  async remove(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<void> {
    await this.categoriesService.removeCategory(request.user, id);
  }
}
