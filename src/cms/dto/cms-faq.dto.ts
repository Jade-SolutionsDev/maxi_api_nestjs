import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { CmsFaqCategory } from '../entities/cms-faq-category.entity';
import { CmsFaqQuestion } from '../entities/cms-faq-question.entity';

const SAFE_FAQ_HREF = /^(\/(?!\/)|https:\/\/)/;

@ValidatorConstraint({ name: 'faqLinkPair', async: false })
class FaqLinkPairConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const value = args.object as {
      linkLabel?: string | null;
      linkHref?: string | null;
    };
    const label = value.linkLabel?.trim() ?? '';
    const href = value.linkHref?.trim() ?? '';

    if (!label && !href) return true;
    return Boolean(
      label &&
        label.length <= 120 &&
        href &&
        href.length <= 500 &&
        SAFE_FAQ_HREF.test(href),
    );
  }

  defaultMessage(): string {
    return 'linkLabel and linkHref must be provided together, and linkHref must be an internal path or HTTPS URL';
  }
}

class CmsFaqCategoryFields {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateCmsFaqCategoryDto extends CmsFaqCategoryFields {}

export class UpdateCmsFaqCategoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class CmsFaqQuestionFields {
  @IsUUID()
  categoryId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  question: string;

  @IsString()
  @IsNotEmpty()
  answer: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  linkLabel?: string | null;

  @Validate(FaqLinkPairConstraint)
  linkHref?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateCmsFaqQuestionDto extends CmsFaqQuestionFields {}

export class UpdateCmsFaqQuestionDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  question?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  answer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  linkLabel?: string | null;

  @Validate(FaqLinkPairConstraint)
  linkHref?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CmsFaqQuestionResponseDto {
  id: string;
  categoryId: string;
  question: string;
  answer: string;
  linkLabel: string | null;
  linkHref: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(entity: CmsFaqQuestion): CmsFaqQuestionResponseDto {
    const dto = new CmsFaqQuestionResponseDto();
    dto.id = entity.id;
    dto.categoryId = entity.categoryId;
    dto.question = entity.question;
    dto.answer = entity.answer;
    dto.linkLabel = entity.linkLabel;
    dto.linkHref = entity.linkHref;
    dto.sortOrder = entity.sortOrder;
    dto.isActive = entity.isActive;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}

export class CmsFaqCategoryResponseDto {
  id: string;
  title: string;
  sortOrder: number;
  isActive: boolean;
  questionCount: number;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(entity: CmsFaqCategory): CmsFaqCategoryResponseDto {
    const dto = new CmsFaqCategoryResponseDto();
    dto.id = entity.id;
    dto.title = entity.title;
    dto.sortOrder = entity.sortOrder;
    dto.isActive = entity.isActive;
    dto.questionCount = entity.questions?.length ?? 0;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}

export class PublicCmsFaqQuestionDto {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
  link: { label: string; href: string } | null;

  static fromEntity(entity: CmsFaqQuestion): PublicCmsFaqQuestionDto {
    const dto = new PublicCmsFaqQuestionDto();
    dto.id = entity.id;
    dto.question = entity.question;
    dto.answer = entity.answer;
    dto.sortOrder = entity.sortOrder;
    dto.link =
      entity.linkLabel && entity.linkHref
        ? { label: entity.linkLabel, href: entity.linkHref }
        : null;
    return dto;
  }
}

export class PublicCmsFaqCategoryDto {
  id: string;
  title: string;
  sortOrder: number;
  questions: PublicCmsFaqQuestionDto[];
}
