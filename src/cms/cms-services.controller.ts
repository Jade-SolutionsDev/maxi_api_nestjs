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
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { CmsService } from './cms.service';
import {
  CmsServiceResponseDto,
  CreateCmsServiceDto,
  UpdateCmsServiceDto,
} from './dto/cms-service.dto';

@ApiTags('cms')
@ApiBearerAuth()
@Controller('cms/services')
export class CmsServicesController {
  constructor(private readonly cmsService: CmsService) {}

  @Get()
  @RequirePermission({ module: 'cms-services', action: 'list' })
  async findAll(): Promise<CmsServiceResponseDto[]> {
    const services = await this.cmsService.listServicesAdmin();
    return services.map(CmsServiceResponseDto.fromEntity);
  }

  @Get(':id')
  @RequirePermission({ module: 'cms-services', action: 'read' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CmsServiceResponseDto> {
    return CmsServiceResponseDto.fromEntity(
      await this.cmsService.getService(id),
    );
  }

  @Post()
  @RequirePermission({ module: 'cms-services', action: 'create' })
  async create(
    @Body() dto: CreateCmsServiceDto,
  ): Promise<CmsServiceResponseDto> {
    return CmsServiceResponseDto.fromEntity(
      await this.cmsService.createService(dto),
    );
  }

  @Patch(':id')
  @RequirePermission({ module: 'cms-services', action: 'update' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsServiceDto,
  ): Promise<CmsServiceResponseDto> {
    return CmsServiceResponseDto.fromEntity(
      await this.cmsService.updateService(id, dto),
    );
  }

  @Delete(':id')
  @RequirePermission({ module: 'cms-services', action: 'delete' })
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.cmsService.removeService(id);
  }
}
