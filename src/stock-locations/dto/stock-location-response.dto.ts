import { StockLocation } from '../entities/stock-location.entity';
import {
  CoverageType,
  StockLocationCoverage,
} from '../entities/stock-location-coverage.entity';
import { StockLocationGrocer } from '../entities/stock-location-grocer.entity';
import { StockLocationPickupAddress } from '../entities/stock-location-pickup-address.entity';

export class CoverageResponseItem {
  coverageType: CoverageType;
  provinceId: string;
  municipalityId: string | null;
}

export class PickupAddressResponseItem {
  id: string;
  label: string | null;
  address: string;
}

export class StockLocationResponseDto {
  id: string;
  name: string;
  isActive: boolean;
  coverage: CoverageResponseItem[];
  grocerIds: string[];
  pickupAddresses: PickupAddressResponseItem[];
  createdAt: Date;
  updatedAt: Date;

  static build(
    location: StockLocation,
    coverage: StockLocationCoverage[],
    grocers: StockLocationGrocer[],
    pickupAddresses: StockLocationPickupAddress[] = [],
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
    dto.pickupAddresses = pickupAddresses.map((a) => ({
      id: a.id,
      label: a.label,
      address: a.address,
    }));
    dto.createdAt = location.createdAt;
    dto.updatedAt = location.updatedAt;
    return dto;
  }
}
