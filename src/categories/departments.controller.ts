import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import { CategoriesService } from './categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Controller('departments')
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.GROCER)
export class DepartmentsController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  async findAll(
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto[]> {
    const departments = await this.categoriesService.listDepartments(
      request.user,
    );
    return departments.map(CategoryResponseDto.fromEntity);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.getDepartment(request.user, id),
    );
  }

  @Post()
  async create(
    @Body() dto: CreateDepartmentDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<CategoryResponseDto> {
    return CategoryResponseDto.fromEntity(
      await this.categoriesService.createDepartment(request.user, dto),
    );
  }

  @Patch(':id')
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
  async remove(
    @Param('id') id: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<void> {
    await this.categoriesService.removeDepartment(request.user, id);
  }
}
