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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import {
  CreateNomenclatorDto,
  NomenclatorResponseDto,
  NomenclatorsQueryDto,
  UpdateNomenclatorDto,
} from './dto/nomenclator.dto';
import { NomenclatorsService } from './nomenclators.service';

// Managing option catalogs is an admin task: plain role gate, no per-module
// permissions (same posture as cms/clients).
@ApiTags('nomenclators')
@ApiBearerAuth()
@Controller('nomenclators')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class NomenclatorsController {
  constructor(private readonly nomenclatorsService: NomenclatorsService) {}

  @Get()
  @ApiOperation({ summary: 'List a category (inactive included)' })
  async findAll(
    @Query() query: NomenclatorsQueryDto,
  ): Promise<NomenclatorResponseDto[]> {
    const rows = await this.nomenclatorsService.listAdmin(query.category);
    return rows.map(NomenclatorResponseDto.fromEntity);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NomenclatorResponseDto> {
    return NomenclatorResponseDto.fromEntity(
      await this.nomenclatorsService.getOne(id),
    );
  }

  @Post()
  async create(
    @Body() dto: CreateNomenclatorDto,
  ): Promise<NomenclatorResponseDto> {
    return NomenclatorResponseDto.fromEntity(
      await this.nomenclatorsService.create(dto),
    );
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNomenclatorDto,
  ): Promise<NomenclatorResponseDto> {
    return NomenclatorResponseDto.fromEntity(
      await this.nomenclatorsService.update(id, dto),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.nomenclatorsService.remove(id);
  }
}
