import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  NOMENCLATOR_CATEGORIES,
  Nomenclator,
} from '../entities/nomenclator.entity';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * Extends the pagination DTO only to whitelist the page/sort params the admin
 * data provider always sends; the endpoint returns the full (small) catalog
 * and the client pages/sorts it.
 */
export class NomenclatorsQueryDto extends PaginationQueryDto {
  /** Catalog to list. */
  @IsIn(NOMENCLATOR_CATEGORIES)
  category: string;
}

export class CreateNomenclatorDto {
  @IsIn(NOMENCLATOR_CATEGORIES)
  category: string;

  @IsString()
  @MaxLength(120)
  label: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateNomenclatorDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class NomenclatorResponseDto {
  id: string;
  category: string;
  code: string;
  label: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(entity: Nomenclator): NomenclatorResponseDto {
    const dto = new NomenclatorResponseDto();
    dto.id = entity.id;
    dto.category = entity.category;
    dto.code = entity.code;
    dto.label = entity.label;
    dto.description = entity.description;
    dto.sortOrder = entity.sortOrder;
    dto.isActive = entity.isActive;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
