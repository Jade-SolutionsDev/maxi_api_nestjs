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
  CmsStaffMemberResponseDto,
  CreateCmsStaffMemberDto,
  UpdateCmsStaffMemberDto,
} from './dto/cms-staff-member.dto';

@ApiTags('cms')
@ApiBearerAuth()
@Controller('cms/staff')
export class CmsStaffController {
  constructor(private readonly cmsService: CmsService) {}

  @Get()
  @RequirePermission({ module: 'cms-staff', action: 'list' })
  async findAll(): Promise<CmsStaffMemberResponseDto[]> {
    const staff = await this.cmsService.listStaffAdmin();
    return staff.map(CmsStaffMemberResponseDto.fromEntity);
  }

  @Get(':id')
  @RequirePermission({ module: 'cms-staff', action: 'read' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CmsStaffMemberResponseDto> {
    return CmsStaffMemberResponseDto.fromEntity(
      await this.cmsService.getStaffMember(id),
    );
  }

  @Post()
  @RequirePermission({ module: 'cms-staff', action: 'create' })
  async create(
    @Body() dto: CreateCmsStaffMemberDto,
  ): Promise<CmsStaffMemberResponseDto> {
    return CmsStaffMemberResponseDto.fromEntity(
      await this.cmsService.createStaffMember(dto),
    );
  }

  @Patch(':id')
  @RequirePermission({ module: 'cms-staff', action: 'update' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsStaffMemberDto,
  ): Promise<CmsStaffMemberResponseDto> {
    return CmsStaffMemberResponseDto.fromEntity(
      await this.cmsService.updateStaffMember(id, dto),
    );
  }

  @Delete(':id')
  @RequirePermission({ module: 'cms-staff', action: 'delete' })
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.cmsService.removeStaffMember(id);
  }
}
