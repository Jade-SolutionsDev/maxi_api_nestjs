import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FulfillmentSettingsData } from '../entities/fulfillment-settings.entity';

export class UpdateFulfillmentSettingsDto {
  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  supportMessage?: string;

  /**
   * Días hábiles hasta tener el pedido listo para recoger. Hoy toda la venta
   * es recogida, así que este es el plazo que de verdad se usa.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  pickupPromiseDays?: number | null;
}

export class FulfillmentSettingsResponseDto implements FulfillmentSettingsData {
  pickupEnabled: boolean;
  supportMessage: string;
  pickupPromiseDays?: number | null;
  /**
   * True when pickup is on but not one active storage has a pickup address —
   * the configuration that leaves customers with nothing to choose.
   */
  pickupEnabledWithoutAddresses: boolean;

  /**
   * Municipalities the catalogue treats as sellable and the checkout cannot
   * serve: an active storage covers them, so the shop shows products there,
   * but nothing can reach them — no pickup counter and no delivery option for
   * that zone. Empty while pickup is on with at least one counter.
   */
  municipalitiesWithoutFulfillment: { id: string; name: string }[];
}
