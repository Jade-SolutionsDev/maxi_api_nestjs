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
  CmsServiceResponseDto,
  CreateCmsServiceDto,
  UpdateCmsServiceDto,
} from './dto/cms-service.dto';

@ApiTags('cms')
@ApiBearerAuth()
@Controller('cms/services')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class CmsServicesController {
  constructor(private readonly cmsService: CmsService) {}

  @Get()
  async findAll(): Promise<CmsServiceResponseDto[]> {
    const services = await this.cmsService.listServicesAdmin();
    return services.map(CmsServiceResponseDto.fromEntity);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CmsServiceResponseDto> {
    return CmsServiceResponseDto.fromEntity(
      await this.cmsService.getService(id),
    );
  }

  @Post()
  async create(
    @Body() dto: CreateCmsServiceDto,
  ): Promise<CmsServiceResponseDto> {
    return CmsServiceResponseDto.fromEntity(
      await this.cmsService.createService(dto),
    );
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsServiceDto,
  ): Promise<CmsServiceResponseDto> {
    return CmsServiceResponseDto.fromEntity(
      await this.cmsService.updateService(id, dto),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.cmsService.removeService(id);
  }
}
