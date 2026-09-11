import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CreateCmsFaqCategoryDto,
  CreateCmsFaqQuestionDto,
  PublicCmsFaqCategoryDto,
  PublicCmsFaqQuestionDto,
  UpdateCmsFaqCategoryDto,
  UpdateCmsFaqQuestionDto,
} from './dto/cms-faq.dto';
import { CmsFaqCategory } from './entities/cms-faq-category.entity';
import { CmsFaqQuestion } from './entities/cms-faq-question.entity';
import {
  CMS_REVALIDATE_TAGS,
  RevalidationService,
} from '../revalidation/revalidation.service';

const byOrder = <T extends { sortOrder: number; createdAt: Date }>(
  a: T,
  b: T,
) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime();

const text = (value: string): string => value.trim();
const optionalText = (value?: string | null): string | null =>
  value?.trim() || null;

@Injectable()
export class CmsFaqService {
  constructor(
    @InjectRepository(CmsFaqCategory)
    private readonly categoryRepository: Repository<CmsFaqCategory>,
    @InjectRepository(CmsFaqQuestion)
    private readonly questionRepository: Repository<CmsFaqQuestion>,
    private readonly revalidationService: RevalidationService,
  ) {}

  async listCategoriesAdmin(): Promise<CmsFaqCategory[]> {
    return this.categoryRepository.find({
      relations: { questions: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async getCategory(id: string): Promise<CmsFaqCategory> {
    const category = await this.categoryRepository.findOne({
      where: { id },
      relations: { questions: true },
    });
    if (!category) {
      throw new NotFoundException(`FAQ category with id "${id}" not found`);
    }
    return category;
  }

  async createCategory(dto: CreateCmsFaqCategoryDto): Promise<CmsFaqCategory> {
    const category = this.categoryRepository.create({
      title: text(dto.title),
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });
    const saved = await this.categoryRepository.save(category);
    this.revalidate();
    return saved;
  }

  async updateCategory(
    id: string,
    dto: UpdateCmsFaqCategoryDto,
  ): Promise<CmsFaqCategory> {
    const category = await this.getCategory(id);
    if (dto.title !== undefined) category.title = text(dto.title);
    if (dto.sortOrder !== undefined) category.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) category.isActive = dto.isActive;
    const saved = await this.categoryRepository.save(category);
    this.revalidate();
    return saved;
  }

  async removeCategory(id: string): Promise<void> {
    await this.getCategory(id);
    await this.questionRepository.softDelete({ categoryId: id });
    await this.categoryRepository.softDelete(id);
    this.revalidate();
  }

  async listQuestionsAdmin(categoryId?: string): Promise<CmsFaqQuestion[]> {
    if (categoryId) await this.getCategory(categoryId);
    return this.questionRepository.find({
      where: categoryId ? { categoryId } : {},
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async getQuestion(id: string): Promise<CmsFaqQuestion> {
    const question = await this.questionRepository.findOne({ where: { id } });
    if (!question) {
      throw new NotFoundException(`FAQ question with id "${id}" not found`);
    }
    return question;
  }

  async createQuestion(dto: CreateCmsFaqQuestionDto): Promise<CmsFaqQuestion> {
    await this.getCategory(dto.categoryId);
    const question = this.questionRepository.create({
      categoryId: dto.categoryId,
      question: text(dto.question),
      answer: text(dto.answer),
      linkLabel: optionalText(dto.linkLabel),
      linkHref: optionalText(dto.linkHref),
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });
    const saved = await this.questionRepository.save(question);
    this.revalidate();
    return saved;
  }

  async updateQuestion(
    id: string,
    dto: UpdateCmsFaqQuestionDto,
  ): Promise<CmsFaqQuestion> {
    const question = await this.getQuestion(id);
    if (dto.categoryId !== undefined) {
      await this.getCategory(dto.categoryId);
      question.categoryId = dto.categoryId;
    }
    if (dto.question !== undefined) question.question = text(dto.question);
    if (dto.answer !== undefined) question.answer = text(dto.answer);
    if (dto.linkLabel !== undefined || dto.linkHref !== undefined) {
      question.linkLabel = optionalText(dto.linkLabel);
      question.linkHref = optionalText(dto.linkHref);
    }
    if (dto.sortOrder !== undefined) question.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) question.isActive = dto.isActive;
    const saved = await this.questionRepository.save(question);
    this.revalidate();
    return saved;
  }

  async removeQuestion(id: string): Promise<void> {
    await this.getQuestion(id);
    await this.questionRepository.softDelete(id);
    this.revalidate();
  }

  async listPublic(): Promise<PublicCmsFaqCategoryDto[]> {
    const categories = await this.categoryRepository.find({
      where: { isActive: true },
      relations: { questions: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    return categories
      .map((category) => ({
        id: category.id,
        title: category.title,
        sortOrder: category.sortOrder,
        questions: category.questions
          .filter((question) => question.isActive)
          .sort(byOrder)
          .map(PublicCmsFaqQuestionDto.fromEntity),
      }))
      .filter((category) => category.questions.length > 0);
  }

  private revalidate(): void {
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
  }
}
