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
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import { CmsService } from './cms.service';
import {
  CmsBannerResponseDto,
  CreateCmsBannerDto,
  UpdateCmsBannerDto,
} from './dto/cms-banner.dto';

@ApiTags('cms')
@ApiBearerAuth()
@Controller('cms/banners')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class CmsBannersController {
  constructor(private readonly cmsService: CmsService) {}

  @Get()
  async findAll(): Promise<CmsBannerResponseDto[]> {
    const banners = await this.cmsService.listBannersAdmin();
    return banners.map(CmsBannerResponseDto.fromEntity);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CmsBannerResponseDto> {
    return CmsBannerResponseDto.fromEntity(await this.cmsService.getBanner(id));
  }

  @Post()
  async create(@Body() dto: CreateCmsBannerDto): Promise<CmsBannerResponseDto> {
    return CmsBannerResponseDto.fromEntity(
      await this.cmsService.createBanner(dto),
    );
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsBannerDto,
  ): Promise<CmsBannerResponseDto> {
    return CmsBannerResponseDto.fromEntity(
      await this.cmsService.updateBanner(id, dto),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.cmsService.removeBanner(id);
  }
}
