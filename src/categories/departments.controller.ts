import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { ClerkUserAuthGuard } from '../auth/guards/clerk-user-auth.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { CategoriesService } from './categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Controller('departments')
@UseGuards(ClerkUserAuthGuard, PermissionGuard)
export class DepartmentsController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @RequirePermission({ module: 'categories', action: 'list' })
  async findAll(
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto[]> {
    const departments = await this.categoriesService.listDepartments(
      request.user,
    );
    return departments.map(CategoryResponseDto.fromEntity);
  }

  @Get(':id')
  @RequirePermission({ module: 'categories', action: 'read' })
  async findOne(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.getDepartment(request.user, id),
    );
  }

  @Post()
  @RequirePermission({ module: 'categories', action: 'create' })
  async create(
    @Body() dto: CreateDepartmentDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.createDepartment(request.user, dto),
    );
  }

  @Patch(':id')
  @RequirePermission({ module: 'categories', action: 'update' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.updateDepartment(request.user, id, dto),
    );
  }

  @Delete(':id')
  @RequirePermission({ module: 'categories', action: 'delete' })
  async remove(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<void> {
    await this.categoriesService.removeDepartment(request.user, id);
  }
}
