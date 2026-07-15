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
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { CategoriesService } from './categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('departments')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @RequirePermission({ module: 'departments', action: 'list' })
  async findAll(@Query('q') q?: string): Promise<CategoryResponseDto[]> {
    const departments = await this.categoriesService.listDepartments(q);
    return departments.map(CategoryResponseDto.fromEntity);
  }

  @Get(':id')
  @RequirePermission({ module: 'departments', action: 'read' })
  async findOne(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.getDepartment(request.user, id),
    );
  }

  @Post()
  @RequirePermission({ module: 'departments', action: 'create' })
  async create(
    @Body() dto: CreateDepartmentDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.createDepartment(request.user, dto),
    );
  }

  @Patch(':id')
  @RequirePermission({ module: 'departments', action: 'update' })
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
  @RequirePermission({ module: 'departments', action: 'delete' })
  async remove(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<void> {
    await this.categoriesService.removeDepartment(request.user, id);
  }
}
