import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TAXONOMY_CACHE } from '../common/constants/cache-control';
import { Public } from '../common/decorators/public.decorator';
import { CategoriesService } from './categories.service';
import {
  PublicCatalogCategoryDto,
  PublicCatalogDepartmentDto,
} from './dto/public-catalog.dto';

// Unauthenticated storefront catalog tree. See PublicDepartmentsController.
@ApiTags('storefront')
@Controller('public/catalog')
@Public()
export class PublicCatalogController {
  constructor(private readonly categoriesService: CategoriesService) {}

  /**
   * The whole valid catalog as a department -> categories tree. Each category
   * carries its in-stock product count and each department the total across
   * its categories. Unpaginated (the taxonomy is small) and location-agnostic;
   * intended to back an always-on catalog nav, so cache it on the client.
   */
  @Get()
  @Header('Cache-Control', TAXONOMY_CACHE)
  @ApiOkResponse({ type: PublicCatalogDepartmentDto, isArray: true })
  async findAll(): Promise<PublicCatalogDepartmentDto[]> {
    const tree = await this.categoriesService.getPublicCatalog();
    return tree.map((node) =>
      PublicCatalogDepartmentDto.from(
        node.department,
        node.productsCount,
        node.categories.map((c) =>
          PublicCatalogCategoryDto.from(c.category, c.productsCount),
        ),
      ),
    );
  }
}
