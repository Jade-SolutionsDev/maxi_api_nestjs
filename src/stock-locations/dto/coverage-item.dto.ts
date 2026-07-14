import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { CoverageType } from '../entities/stock-location-coverage.entity';

export class CoverageItemDto {
  @IsEnum(CoverageType)
  coverageType: CoverageType;

  @IsUUID()
  provinceId: string;

  // Required when coverageType === 'municipality'; validated in the service
  // (must belong to provinceId).
  @IsOptional()
  @IsUUID()
  municipalityId?: string;
}
