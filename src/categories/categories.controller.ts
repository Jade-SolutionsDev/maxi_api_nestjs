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
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @RequirePermission({ module: 'categories', action: 'list' })
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
    const ids = categories.map((c) => c.id);
    // Dos cuentas distintas y las dos hacen falta: los asociados son los que
    // bloquean el borrado, y los disponibles los que deciden si el cliente ve
    // la categoría en la tienda.
    const [asociados, disponibles] = await Promise.all([
      this.categoriesService.countProducts(ids),
      this.categoriesService.countValidProducts(ids),
    ]);
    return categories.map((c) =>
      CategoryResponseDto.fromEntity(c, {
        productos: asociados.get(c.id) ?? 0,
        disponibles: disponibles.get(c.id) ?? 0,
      }),
    );
  }

  @Get(':id')
  @RequirePermission({ module: 'categories', action: 'read' })
  async findOne(@Param('id') id: string): Promise<CategoryResponseDto> {
    const category = await this.categoriesService.getCategory(id);
    const [asociados, disponibles] = await Promise.all([
      this.categoriesService.countProducts([id]),
      this.categoriesService.countValidProducts([id]),
    ]);
    return CategoryResponseDto.fromEntity(category, {
      productos: asociados.get(id) ?? 0,
      disponibles: disponibles.get(id) ?? 0,
    });
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
