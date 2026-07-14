import { Municipality } from '../entities/municipality.entity';
import { Province } from '../entities/province.entity';

export class ProvinceResponseDto {
  id: string;
  name: string;
  code: string;

  static fromEntity(province: Province): ProvinceResponseDto {
    const dto = new ProvinceResponseDto();
    dto.id = province.id;
    dto.name = province.name;
    dto.code = province.code;
    return dto;
  }
}

export class MunicipalityResponseDto {
  id: string;
  provinceId: string;
  name: string;
  code: string;

  static fromEntity(municipality: Municipality): MunicipalityResponseDto {
    const dto = new MunicipalityResponseDto();
    dto.id = municipality.id;
    dto.provinceId = municipality.provinceId;
    dto.name = municipality.name;
    dto.code = municipality.code;
    return dto;
  }
}
