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
  Max,
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

  /**
   * Días hábiles que se promete tardar, contados desde el pago. Vacío = sin
   * compromiso publicado. Se cuenta de lunes a sábado, sin feriados.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  promiseDays?: number | null;

  /**
   * Subtotal de productos en USD a partir del cual **esta** forma de entrega
   * no se cobra. `null` apaga la promoción. Entra en dólares —así se escribe
   * un precio— y se guarda en céntimos.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  freeDeliveryThreshold?: number | null;

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
  promiseDays: number | null;
  /** Subtotal en USD desde el que esta entrega sale gratis; `null` si no hay. */
  freeDeliveryThreshold: number | null;
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
    dto.promiseDays = option.promiseDays ?? null;
    dto.freeDeliveryThreshold =
      option.freeDeliveryThresholdCents == null
        ? null
        : option.freeDeliveryThresholdCents / 100;
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
