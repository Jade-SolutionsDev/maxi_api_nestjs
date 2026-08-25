import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { GeographyService } from '../geography/geography.service';
import { StockLocationPickupAddress } from '../stock-locations/entities/stock-location-pickup-address.entity';
import { FulfillmentType } from '../orders/entities/order.entity';
import {
  DeliveryOptionResponseDto,
  CreateDeliveryOptionDto,
  UpdateDeliveryOptionDto,
} from './dto/delivery-option.dto';
import {
  FulfillmentSettingsResponseDto,
  UpdateFulfillmentSettingsDto,
} from './dto/fulfillment-settings.dto';
import {
  StorefrontFulfillmentDto,
  StorefrontPickupPointDto,
} from './dto/storefront-fulfillment.dto';
import { DeliveryOptionZone } from './entities/delivery-option-zone.entity';
import { DeliveryOption } from './entities/delivery-option.entity';
import {
  FulfillmentSettings,
  FulfillmentSettingsData,
} from './entities/fulfillment-settings.entity';

export const DEFAULT_FULFILLMENT_SETTINGS: FulfillmentSettingsData = {
  pickupEnabled: true,
  supportMessage:
    'Por el momento no podemos procesar pedidos en línea. Escribinos y coordinamos tu compra.',
};

/** The fulfillment decision of one checkout, already validated. */
export interface FulfillmentChoice {
  type: FulfillmentType;
  fee: string;
  deliveryOptionId: string | null;
  deliveryOptionLabel: string | null;
  pickupLocationId: string | null;
  pickupAddressId: string | null;
  pickupAddressSnapshot: Record<string, unknown> | null;
}

/**
 * What the shop can actually do for a customer, and whether a given checkout
 * choice is one of them. Delivery is a catalogue an admin curates; pickup is a
 * switch plus whatever addresses the storages carry. When neither yields
 * anything, checkout is blocked rather than producing an order nobody can fill.
 */
@Injectable()
export class FulfillmentService {
  constructor(
    @InjectRepository(DeliveryOption)
    private readonly optionRepository: Repository<DeliveryOption>,
    @InjectRepository(DeliveryOptionZone)
    private readonly zoneRepository: Repository<DeliveryOptionZone>,
    @InjectRepository(FulfillmentSettings)
    private readonly settingsRepository: Repository<FulfillmentSettings>,
    @InjectRepository(StockLocationPickupAddress)
    private readonly pickupRepository: Repository<StockLocationPickupAddress>,
    private readonly geographyService: GeographyService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------- Settings ----------------

  async getSettings(): Promise<FulfillmentSettingsData> {
    const row = await this.settingsRepository.findOne({ where: {} });
    return { ...DEFAULT_FULFILLMENT_SETTINGS, ...(row?.data ?? {}) };
  }

  async getSettingsResponse(): Promise<FulfillmentSettingsResponseDto> {
    const data = await this.getSettings();
    const points = await this.pickupPoints();
    return {
      ...data,
      pickupEnabledWithoutAddresses: data.pickupEnabled && points.length === 0,
    };
  }

  async updateSettings(
    dto: UpdateFulfillmentSettingsDto,
  ): Promise<FulfillmentSettingsResponseDto> {
    const current = await this.getSettings();
    const row = await this.settingsRepository.findOne({ where: {} });
    const data: FulfillmentSettingsData = { ...current, ...dto };

    if (row) {
      row.data = data;
      await this.settingsRepository.save(row);
    } else {
      await this.settingsRepository.save(
        this.settingsRepository.create({ data }),
      );
    }
    return this.getSettingsResponse();
  }

  // ---------------- Delivery options (admin) ----------------

  async findAllOptions(): Promise<DeliveryOptionResponseDto[]> {
    const options = await this.optionRepository.find({
      order: { sortOrder: 'ASC', label: 'ASC' },
    });
    const zones = await this.zonesFor(options.map((option) => option.id));
    return options.map((option) =>
      DeliveryOptionResponseDto.fromEntity(option, zones.get(option.id) ?? []),
    );
  }

  async findOneOption(id: string): Promise<DeliveryOptionResponseDto> {
    const option = await this.optionRepository.findOne({ where: { id } });
    if (!option) {
      throw new NotFoundException(`Delivery option with id "${id}" not found`);
    }
    const zones = await this.zoneRepository.find({ where: { optionId: id } });
    return DeliveryOptionResponseDto.fromEntity(option, zones);
  }

  async createOption(
    dto: CreateDeliveryOptionDto,
  ): Promise<DeliveryOptionResponseDto> {
    const option = await this.optionRepository.save(
      this.optionRepository.create({
        label: dto.label,
        description: dto.description ?? null,
        fee: (dto.fee ?? 0).toFixed(2),
        sortOrder: dto.sortOrder ?? 0,
        enabled: dto.enabled ?? false,
      }),
    );
    await this.replaceZones(option.id, dto.zones);
    return this.findOneOption(option.id);
  }

  async updateOption(
    id: string,
    dto: UpdateDeliveryOptionDto,
  ): Promise<DeliveryOptionResponseDto> {
    const option = await this.optionRepository.findOne({ where: { id } });
    if (!option) {
      throw new NotFoundException(`Delivery option with id "${id}" not found`);
    }
    if (dto.label !== undefined) option.label = dto.label;
    if (dto.description !== undefined) option.description = dto.description;
    if (dto.fee !== undefined) option.fee = dto.fee.toFixed(2);
    if (dto.sortOrder !== undefined) option.sortOrder = dto.sortOrder;
    if (dto.enabled !== undefined) option.enabled = dto.enabled;
    await this.optionRepository.save(option);

    if (dto.zones !== undefined) await this.replaceZones(id, dto.zones);
    return this.findOneOption(id);
  }

  async removeOption(id: string): Promise<void> {
    const option = await this.optionRepository.findOne({ where: { id } });
    if (!option) {
      throw new NotFoundException(`Delivery option with id "${id}" not found`);
    }
    // Zones go with it; orders keep their own label snapshot.
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(DeliveryOptionZone).delete({ optionId: id });
      await manager.getRepository(DeliveryOption).softDelete(id);
    });
  }

  private async replaceZones(
    optionId: string,
    zones?: { provinceId: string; municipalityId?: string }[],
  ): Promise<void> {
    await this.zoneRepository.delete({ optionId });
    if (!zones?.length) return;

    await this.zoneRepository.save(
      zones.map((zone) =>
        this.zoneRepository.create({
          optionId,
          provinceId: zone.provinceId,
          municipalityId: zone.municipalityId ?? null,
        }),
      ),
    );
  }

  private async zonesFor(
    optionIds: string[],
  ): Promise<Map<string, DeliveryOptionZone[]>> {
    if (optionIds.length === 0) return new Map();

    const zones = await this.zoneRepository.find({
      where: { optionId: In(optionIds) },
    });
    const byOption = new Map<string, DeliveryOptionZone[]>();
    for (const zone of zones) {
      const list = byOption.get(zone.optionId) ?? [];
      list.push(zone);
      byOption.set(zone.optionId, list);
    }
    return byOption;
  }

  // ---------------- Storefront ----------------

  /** Pickup points of active storages, newest storage name attached. */
  private async pickupPoints(): Promise<StorefrontPickupPointDto[]> {
    return this.pickupRepository
      .createQueryBuilder('pickup')
      .innerJoin(
        'stock_locations',
        'location',
        'location.id = pickup.location_id AND location.is_active = true AND location.deleted_at IS NULL',
      )
      .select('pickup.id', 'id')
      .addSelect('pickup.location_id', 'locationId')
      .addSelect('location.name', 'locationName')
      .addSelect('pickup.label', 'label')
      .addSelect('pickup.address', 'address')
      .orderBy('location.name')
      .addOrderBy('pickup.label')
      .getRawMany<StorefrontPickupPointDto>();
  }

  /**
   * Delivery options offered where the customer is. An option with no zones is
   * offered everywhere; otherwise its zones must name the municipality, or the
   * province the municipality belongs to.
   */
  private async optionsForMunicipality(
    municipalityId?: string,
  ): Promise<DeliveryOption[]> {
    const enabled = await this.optionRepository.find({
      where: { enabled: true, deletedAt: IsNull() },
      order: { sortOrder: 'ASC', label: 'ASC' },
    });
    if (enabled.length === 0) return [];

    const zones = await this.zonesFor(enabled.map((option) => option.id));
    if (!municipalityId) {
      // No place to judge against: only the unrestricted ones are safe to show.
      return enabled.filter((option) => !zones.get(option.id)?.length);
    }

    const municipality =
      await this.geographyService.getMunicipalityOrThrow(municipalityId);
    return enabled.filter((option) => {
      const optionZones = zones.get(option.id) ?? [];
      if (optionZones.length === 0) return true;
      return optionZones.some(
        (zone) =>
          zone.municipalityId === municipalityId ||
          (zone.municipalityId === null &&
            zone.provinceId === municipality.provinceId),
      );
    });
  }

  async availableForClient(
    municipalityId?: string,
  ): Promise<StorefrontFulfillmentDto> {
    const settings = await this.getSettings();
    const [options, points] = await Promise.all([
      this.optionsForMunicipality(municipalityId),
      settings.pickupEnabled ? this.pickupPoints() : Promise.resolve([]),
    ]);

    const nothingToOffer = options.length === 0 && points.length === 0;
    return {
      deliveryOptions: options.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
        fee: Number(option.fee),
      })),
      pickupPoints: points,
      pickupEnabled: settings.pickupEnabled,
      unavailableMessage: nothingToOffer ? settings.supportMessage : null,
    };
  }

  /**
   * Validates one checkout's fulfillment choice against what is actually on
   * offer. Everything the order needs to remember comes back as a snapshot —
   * the option can be renamed or deleted later without rewriting history.
   */
  async resolveChoice(input: {
    fulfillmentType?: FulfillmentType;
    deliveryOptionId?: string;
    pickupAddressId?: string;
    municipalityId?: string;
  }): Promise<FulfillmentChoice> {
    const offer = await this.availableForClient(input.municipalityId);
    if (offer.unavailableMessage) {
      throw new BadRequestException(offer.unavailableMessage);
    }

    const type =
      input.fulfillmentType ??
      (offer.deliveryOptions.length > 0
        ? FulfillmentType.DELIVERY
        : FulfillmentType.PICKUP);

    if (type === FulfillmentType.PICKUP) {
      if (!offer.pickupEnabled) {
        throw new BadRequestException('Pickup is not available');
      }
      // With a single point there is nothing to choose, so an omitted id is
      // not an error — same rule as the payment method.
      const point = input.pickupAddressId
        ? offer.pickupPoints.find(
            (candidate) => candidate.id === input.pickupAddressId,
          )
        : offer.pickupPoints.length === 1
          ? offer.pickupPoints[0]
          : undefined;
      if (!point) {
        throw new BadRequestException(
          'Choose one of the available pickup points',
        );
      }
      return {
        type,
        fee: '0.00',
        deliveryOptionId: null,
        deliveryOptionLabel: null,
        pickupLocationId: point.locationId,
        pickupAddressId: point.id,
        pickupAddressSnapshot: {
          locationName: point.locationName,
          label: point.label,
          address: point.address,
        },
      };
    }

    const option = input.deliveryOptionId
      ? offer.deliveryOptions.find(
          (candidate) => candidate.id === input.deliveryOptionId,
        )
      : offer.deliveryOptions.length === 1
        ? offer.deliveryOptions[0]
        : undefined;
    if (!option) {
      throw new BadRequestException(
        'Choose one of the available delivery options',
      );
    }
    return {
      type,
      fee: option.fee.toFixed(2),
      deliveryOptionId: option.id,
      deliveryOptionLabel: option.label,
      pickupLocationId: null,
      pickupAddressId: null,
      pickupAddressSnapshot: null,
    };
  }
}
