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
  CmsStaffMemberResponseDto,
  CreateCmsStaffMemberDto,
  UpdateCmsStaffMemberDto,
} from './dto/cms-staff-member.dto';

@ApiTags('cms')
@ApiBearerAuth()
@Controller('cms/staff')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class CmsStaffController {
  constructor(private readonly cmsService: CmsService) {}

  @Get()
  async findAll(): Promise<CmsStaffMemberResponseDto[]> {
    const staff = await this.cmsService.listStaffAdmin();
    return staff.map(CmsStaffMemberResponseDto.fromEntity);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CmsStaffMemberResponseDto> {
    return CmsStaffMemberResponseDto.fromEntity(
      await this.cmsService.getStaffMember(id),
    );
  }

  @Post()
  async create(
    @Body() dto: CreateCmsStaffMemberDto,
  ): Promise<CmsStaffMemberResponseDto> {
    return CmsStaffMemberResponseDto.fromEntity(
      await this.cmsService.createStaffMember(dto),
    );
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsStaffMemberDto,
  ): Promise<CmsStaffMemberResponseDto> {
    return CmsStaffMemberResponseDto.fromEntity(
      await this.cmsService.updateStaffMember(id, dto),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.cmsService.removeStaffMember(id);
  }
}
