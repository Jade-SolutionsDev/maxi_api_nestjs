import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { GeographyService } from '../geography/geography.service';
import { ProductsService } from '../products/products.service';
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
    'Por el momento no podemos procesar pedidos en línea. Escríbenos y coordinamos tu compra.',
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
  /** Días hábiles prometidos: de la opción elegida, o de los ajustes si es recogida. */
  promiseDays: number | null;
}

/**
 * What the shop can actually do for a customer, and whether a given checkout
 * choice is one of them. Delivery is a catalogue an admin curates; pickup is a
 * switch plus whatever addresses the storages carry. When neither yields
 * anything, checkout is blocked rather than producing an order nobody can fill.
 */
/** Dólares escritos → céntimos guardados. `null` apaga la promoción. */
const aCentimos = (dolares?: number | null): number | null =>
  dolares == null ? null : Math.round(dolares * 100);

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
    private readonly productsService: ProductsService,
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
    const hayRecogida = data.pickupEnabled && points.length > 0;
    return {
      ...data,
      pickupEnabledWithoutAddresses: data.pickupEnabled && points.length === 0,
      // Con recogida en pie no hace falta la consulta: cualquier municipio
      // cubierto alcanza algún mostrador (MxH-0101).
      municipalitiesWithoutFulfillment: hayRecogida
        ? []
        : await this.municipalitiesWithoutFulfillment(),
    };
  }

  /**
   * Municipios que el catálogo da por vendibles y a los que no se puede hacer
   * llegar nada: un almacén activo los cubre —así que la tienda les enseña
   * productos con precio y les deja llenar el carrito— y en el checkout no hay
   * ni recogida ni una opción de entrega que alcance esa zona.
   *
   * Cubrir no es poder despachar, y nada avisaba de la diferencia: se veía
   * en el último paso de la compra y lo contaba el cliente, no el panel
   * (MxH-0101, P-046). Solo se llama cuando la recogida no está en pie, que
   * es cuando la diferencia puede existir.
   */
  async municipalitiesWithoutFulfillment(): Promise<
    { id: string; name: string }[]
  > {
    return this.settingsRepository.manager.query(
      `SELECT DISTINCT m.id, m.name
         FROM municipalities m
         JOIN stock_location_coverage c
           ON c.municipality_id = m.id
           OR (c.coverage_type = 'province' AND c.province_id = m.province_id)
         JOIN stock_locations sl
           ON sl.id = c.location_id
          AND sl.is_active = true
          AND sl.deleted_at IS NULL
        WHERE NOT EXISTS (
          SELECT 1
            FROM delivery_options o
            LEFT JOIN delivery_option_zones z ON z.option_id = o.id
           WHERE o.enabled = true
             AND o.deleted_at IS NULL
             AND (z.id IS NULL
                  OR z.municipality_id = m.id
                  OR (z.municipality_id IS NULL AND z.province_id = m.province_id))
        )
        ORDER BY m.name`,
    );
  }

  /**
   * El envío que de verdad se cobra por esta opción con este subtotal
   * (MxH-0043). Cero si la compra alcanza el umbral de **esa** forma de
   * entrega; su tarifa, si no.
   *
   * Se compara en **céntimos enteros**: con dólares en coma flotante, una
   * compra de 20,01 contra un umbral de 20,01 puede salir falsa por el
   * redondeo del binario —`9.51 + 10.50` da `20.009999999999998`—, y eso es un
   * cliente que paga el envío con la cuenta dándole justo.
   *
   * El subtotal es el de productos, con sus rebajas aplicadas: el envío no
   * cuenta para ganarse el envío.
   */
  async feeConPromocion(
    optionId: string | null | undefined,
    subtotal: number,
    fee: string,
  ): Promise<string> {
    if (!optionId) return fee;
    const option = await this.optionRepository.findOne({
      where: { id: optionId },
    });
    const umbral = option?.freeDeliveryThresholdCents;
    if (!umbral) return fee;
    return Math.round(subtotal * 100) >= umbral ? '0.00' : fee;
  }

  async updateSettings(
    dto: UpdateFulfillmentSettingsDto,
  ): Promise<FulfillmentSettingsResponseDto> {
    const current = await this.getSettings();
    const row = await this.settingsRepository.findOne({ where: {} });

    // Solo se pisa lo que de verdad viene en la petición. Sin este filtro, un
    // campo declarado en el DTO pero no enviado llega como `undefined`, pisa
    // el valor guardado y desaparece del jsonb: guardar el mensaje de soporte
    // borraba el ajuste de recogida, que volvía a su valor por defecto sin
    // que nadie lo notara.
    const cambios = Object.fromEntries(
      Object.entries(dto).filter(([, valor]) => valor !== undefined),
    );
    const data: FulfillmentSettingsData = { ...current, ...cambios };

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
        promiseDays: dto.promiseDays ?? null,
        freeDeliveryThresholdCents: aCentimos(dto.freeDeliveryThreshold),
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
    if (dto.promiseDays !== undefined) {
      option.promiseDays = dto.promiseDays ?? null;
    }
    if (dto.freeDeliveryThreshold !== undefined) {
      option.freeDeliveryThresholdCents = aCentimos(dto.freeDeliveryThreshold);
    }
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

  // Pickup counters of active storages, unfiltered. Kept apart so the
  // near-first lookup below can ask the same question twice.
  private pickupPointsQuery() {
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
      .addSelect('pickup.hours', 'hours')
      .orderBy('location.name')
      .addOrderBy('pickup.label');
  }

  /**
   * Pickup points of active storages. Scoped to the storages covering the
   * customer's municipality when one is known — a customer buying in Matanzas
   * has no business seeing Guantánamo's counter. Without a municipality the
   * full list stays available so checkout never dead-ends.
   *
   * MxH-0101: that scoping used to return nothing when the covering storages
   * had no counter of their own, and the customer — who had just been shown
   * the product in the catalogue, priced and in stock — hit a checkout with no
   * way through. Collecting is the customer travelling, not the shop
   * delivering, so a counter outside the delivery area is a worse offer than a
   * near one but a far better one than none. The order already knows how to
   * finish it: it reserves in the covering storages and flags the transfer to
   * the chosen counter (`orders.service`, `resolveAllowedLocationIds`).
   */
  private async pickupPoints(
    municipalityId?: string,
  ): Promise<StorefrontPickupPointDto[]> {
    if (municipalityId) {
      const serving = await this.productsService.coveringLocationIds({
        municipalityId,
      });
      // Nothing serves the place: there is no stock to collect either.
      if (serving.length === 0) return [];

      const cercanos = await this.pickupPointsQuery()
        .andWhere('pickup.location_id IN (:...serving)', { serving })
        .getRawMany<StorefrontPickupPointDto>();
      if (cercanos.length > 0) return cercanos;
    }

    return this.pickupPointsQuery().getRawMany<StorefrontPickupPointDto>();
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

    // Offering delivery somewhere no active storage serves advertises what the
    // shop cannot do: the customer picks it and only finds out at checkout,
    // when availability there is zero.
    const serving = await this.productsService.coveringLocationIds({
      municipalityId,
    });
    if (serving.length === 0) return [];

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
      settings.pickupEnabled
        ? this.pickupPoints(municipalityId)
        : Promise.resolve([]),
    ]);

    const nothingToOffer = options.length === 0 && points.length === 0;
    return {
      deliveryOptions: options.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
        fee: Number(option.fee),
        promiseDays: option.promiseDays ?? null,
        freeDeliveryThreshold:
          option.freeDeliveryThresholdCents == null
            ? null
            : option.freeDeliveryThresholdCents / 100,
      })),
      pickupPoints: points,
      pickupEnabled: settings.pickupEnabled,
      pickupPromiseDays: settings.pickupPromiseDays ?? null,
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
      const ajustes = await this.getSettings();
      return {
        type,
        fee: '0.00',
        promiseDays: ajustes.pickupPromiseDays ?? null,
        deliveryOptionId: null,
        deliveryOptionLabel: null,
        pickupLocationId: point.locationId,
        pickupAddressId: point.id,
        // El horario se congela con la dirección, por lo mismo que ella: el
        // pedido guarda lo que se le dijo al cliente al comprar. Si el mostrador
        // cambia de horario, los pedidos nuevos llevan el nuevo.
        pickupAddressSnapshot: {
          locationName: point.locationName,
          label: point.label,
          address: point.address,
          hours: point.hours ?? null,
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
      promiseDays: option.promiseDays ?? null,
    };
  }
}
