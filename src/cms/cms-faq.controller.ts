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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import { CmsFaqService } from './cms-faq.service';
import {
  CmsFaqCategoryResponseDto,
  CmsFaqQuestionResponseDto,
  CreateCmsFaqCategoryDto,
  CreateCmsFaqQuestionDto,
  UpdateCmsFaqCategoryDto,
  UpdateCmsFaqQuestionDto,
} from './dto/cms-faq.dto';

@ApiTags('cms')
@ApiBearerAuth()
@Controller('cms/faq')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class CmsFaqController {
  constructor(private readonly faqService: CmsFaqService) {}

  @Get('categories')
  async categories(): Promise<CmsFaqCategoryResponseDto[]> {
    return (await this.faqService.listCategoriesAdmin()).map(
      CmsFaqCategoryResponseDto.fromEntity,
    );
  }

  @Get('categories/:id')
  async category(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CmsFaqCategoryResponseDto> {
    return CmsFaqCategoryResponseDto.fromEntity(
      await this.faqService.getCategory(id),
    );
  }

  @Post('categories')
  async createCategory(
    @Body() dto: CreateCmsFaqCategoryDto,
  ): Promise<CmsFaqCategoryResponseDto> {
    return CmsFaqCategoryResponseDto.fromEntity(
      await this.faqService.createCategory(dto),
    );
  }

  @Patch('categories/:id')
  async updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsFaqCategoryDto,
  ): Promise<CmsFaqCategoryResponseDto> {
    return CmsFaqCategoryResponseDto.fromEntity(
      await this.faqService.updateCategory(id, dto),
    );
  }

  @Delete('categories/:id')
  @HttpCode(204)
  async removeCategory(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.faqService.removeCategory(id);
  }

  @Get('questions')
  async questions(
    @Query('categoryId', new ParseUUIDPipe({ optional: true }))
    categoryId?: string,
  ): Promise<CmsFaqQuestionResponseDto[]> {
    return (await this.faqService.listQuestionsAdmin(categoryId)).map(
      CmsFaqQuestionResponseDto.fromEntity,
    );
  }

  @Get('questions/:id')
  async question(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CmsFaqQuestionResponseDto> {
    return CmsFaqQuestionResponseDto.fromEntity(
      await this.faqService.getQuestion(id),
    );
  }

  @Post('questions')
  async createQuestion(
    @Body() dto: CreateCmsFaqQuestionDto,
  ): Promise<CmsFaqQuestionResponseDto> {
    return CmsFaqQuestionResponseDto.fromEntity(
      await this.faqService.createQuestion(dto),
    );
  }

  @Patch('questions/:id')
  async updateQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsFaqQuestionDto,
  ): Promise<CmsFaqQuestionResponseDto> {
    return CmsFaqQuestionResponseDto.fromEntity(
      await this.faqService.updateQuestion(id, dto),
    );
  }

  @Delete('questions/:id')
  @HttpCode(204)
  async removeQuestion(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.faqService.removeQuestion(id);
  }
}
