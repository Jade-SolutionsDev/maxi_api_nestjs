import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DeliveryOption } from '../entities/delivery-option.entity';
import { DeliveryOptionZone } from '../entities/delivery-option-zone.entity';

/** One province, or one municipality within it. Mirrors CoverageItemDto. */
export class DeliveryZoneItemDto {
  @IsUUID()
  provinceId: string;

  /** Null/absent = the whole province. */
  @IsOptional()
  @IsUUID()
  municipalityId?: string;
}

export class CreateDeliveryOptionDto {
  @IsString()
  @MaxLength(100)
  label: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fee?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Empty or absent = offered everywhere. Replaced wholesale on update. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryZoneItemDto)
  zones?: DeliveryZoneItemDto[];
}

export class UpdateDeliveryOptionDto extends CreateDeliveryOptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare label: string;
}

export class DeliveryOptionResponseDto {
  id: string;
  label: string;
  description: string | null;
  fee: number;
  sortOrder: number;
  enabled: boolean;
  zones: DeliveryZoneItemDto[];
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(
    option: DeliveryOption,
    zones: DeliveryOptionZone[],
  ): DeliveryOptionResponseDto {
    const dto = new DeliveryOptionResponseDto();
    dto.id = option.id;
    dto.label = option.label;
    dto.description = option.description;
    dto.fee = Number(option.fee);
    dto.sortOrder = option.sortOrder;
    dto.enabled = option.enabled;
    dto.zones = zones.map((zone) => ({
      provinceId: zone.provinceId,
      municipalityId: zone.municipalityId ?? undefined,
    }));
    dto.createdAt = option.createdAt;
    dto.updatedAt = option.updatedAt;
    return dto;
  }
}
