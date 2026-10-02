import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { User } from '../users/entities/user.entity';
import { CmsService } from './cms.service';
import {
  CmsBannerResponseDto,
  CreateCmsBannerDto,
  UpdateCmsBannerDto,
} from './dto/cms-banner.dto';

@ApiTags('cms')
@ApiBearerAuth()
@Controller('cms/banners')
export class CmsBannersController {
  constructor(private readonly cmsService: CmsService) {}

  @Get()
  @RequirePermission({ module: 'cms-banners', action: 'list' })
  async findAll(): Promise<CmsBannerResponseDto[]> {
    const banners = await this.cmsService.listBannersAdmin();
    return banners.map(CmsBannerResponseDto.fromView);
  }

  @Get(':id')
  @RequirePermission({ module: 'cms-banners', action: 'read' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CmsBannerResponseDto> {
    return CmsBannerResponseDto.fromView(await this.cmsService.getBanner(id));
  }

  @Post()
  @RequirePermission({ module: 'cms-banners', action: 'create' })
  async create(
    @Body() dto: CreateCmsBannerDto,
    @CurrentUser() actor: User,
  ): Promise<CmsBannerResponseDto> {
    return CmsBannerResponseDto.fromView(
      await this.cmsService.createBanner(dto, actor),
    );
  }

  @Patch(':id')
  @RequirePermission({ module: 'cms-banners', action: 'update' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsBannerDto,
    @CurrentUser() actor: User,
  ): Promise<CmsBannerResponseDto> {
    return CmsBannerResponseDto.fromView(
      await this.cmsService.updateBanner(id, dto, actor),
    );
  }

  @Delete(':id')
  @RequirePermission({ module: 'cms-banners', action: 'delete' })
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: User,
  ): Promise<void> {
    await this.cmsService.removeBanner(id, actor);
  }
}
