import { StockLocation } from '../entities/stock-location.entity';
import {
  CoverageType,
  StockLocationCoverage,
} from '../entities/stock-location-coverage.entity';
import { StockLocationGrocer } from '../entities/stock-location-grocer.entity';

export class CoverageResponseItem {
  coverageType: CoverageType;
  provinceId: string;
  municipalityId: string | null;
}

export class StockLocationResponseDto {
  id: string;
  name: string;
  isActive: boolean;
  coverage: CoverageResponseItem[];
  grocerIds: string[];
  createdAt: Date;
  updatedAt: Date;

  static build(
    location: StockLocation,
    coverage: StockLocationCoverage[],
    grocers: StockLocationGrocer[],
  ): StockLocationResponseDto {
    const dto = new StockLocationResponseDto();
    dto.id = location.id;
    dto.name = location.name;
    dto.isActive = location.isActive;
    dto.coverage = coverage.map((c) => ({
      coverageType: c.coverageType,
      provinceId: c.provinceId,
      municipalityId: c.municipalityId,
    }));
    dto.grocerIds = grocers.map((g) => g.grocerId);
    dto.createdAt = location.createdAt;
    dto.updatedAt = location.updatedAt;
    return dto;
  }
}
