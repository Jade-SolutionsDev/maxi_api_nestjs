import { Category } from '../entities/category.entity';

export class CategoryResponseDto {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(category: Category): CategoryResponseDto {
    const dto = new CategoryResponseDto();
    dto.id = category.id;
    dto.parentId = category.parentId;
    dto.name = category.name;
    dto.slug = category.slug;
    dto.description = category.description;
    dto.sortOrder = category.sortOrder;
    dto.isActive = category.isActive;
    dto.createdAt = category.createdAt;
    dto.updatedAt = category.updatedAt;
    return dto;
  }
}
