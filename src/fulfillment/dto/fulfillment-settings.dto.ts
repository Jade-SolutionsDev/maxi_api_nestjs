import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { FulfillmentSettingsData } from '../entities/fulfillment-settings.entity';

export class UpdateFulfillmentSettingsDto {
  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  supportMessage?: string;
}

export class FulfillmentSettingsResponseDto implements FulfillmentSettingsData {
  pickupEnabled: boolean;
  supportMessage: string;
  /**
   * True when pickup is on but not one active storage has a pickup address —
   * the configuration that leaves customers with nothing to choose.
   */
  pickupEnabledWithoutAddresses: boolean;
}
