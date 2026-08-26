import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GeographyService } from '../geography/geography.service';
import { ProductsService } from '../products/products.service';
import { FulfillmentType } from '../orders/entities/order.entity';
import { StockLocationPickupAddress } from '../stock-locations/entities/stock-location-pickup-address.entity';
import { DeliveryOptionZone } from './entities/delivery-option-zone.entity';
import { DeliveryOption } from './entities/delivery-option.entity';
import { FulfillmentSettings } from './entities/fulfillment-settings.entity';
import { FulfillmentService } from './fulfillment.service';

const option = (overrides: Partial<DeliveryOption> = {}): DeliveryOption =>
  ({
    id: 'opt-1',
    label: 'Mensajería',
    description: null,
    fee: '5.00',
    sortOrder: 0,
    enabled: true,
    deletedAt: null,
    ...overrides,
  }) as DeliveryOption;

const point = (overrides = {}) => ({
  id: 'pick-1',
  locationId: 'loc-1',
  locationName: 'Almacén Centro',
  label: 'Mostrador',
  address: 'Calle 1 #2',
  ...overrides,
});

describe('FulfillmentService', () => {
  let service: FulfillmentService;
  let optionRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let zoneRepo: {
    find: jest.Mock;
    delete: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let settingsRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let pickupPoints: ReturnType<typeof point>[];
  let geography: { getMunicipalityOrThrow: jest.Mock };
  let products: { coveringLocationIds: jest.Mock };

  beforeEach(async () => {
    pickupPoints = [point()];
    optionRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((o: unknown) => Promise.resolve(o)),
      create: jest.fn().mockImplementation((o: unknown) => o),
    };
    zoneRepo = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
      save: jest.fn(),
      create: jest.fn().mockImplementation((z: unknown) => z),
    };
    settingsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((s: unknown) => Promise.resolve(s)),
      create: jest.fn().mockImplementation((s: unknown) => s),
    };
    geography = {
      getMunicipalityOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'mun-1', provinceId: 'prov-1' }),
    };
    products = {
      coveringLocationIds: jest.fn().mockResolvedValue(['loc-1']),
    };

    // Chainable stub for the pickup-points query builder.
    const chain: Record<string, unknown> = {
      getRawMany: () => Promise.resolve(pickupPoints),
    };
    for (const method of [
      'innerJoin',
      'select',
      'addSelect',
      'orderBy',
      'addOrderBy',
    ]) {
      chain[method] = () => chain;
    }
    const pickupRepo = { createQueryBuilder: () => chain };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FulfillmentService,
        { provide: getRepositoryToken(DeliveryOption), useValue: optionRepo },
        { provide: getRepositoryToken(DeliveryOptionZone), useValue: zoneRepo },
        {
          provide: getRepositoryToken(FulfillmentSettings),
          useValue: settingsRepo,
        },
        {
          provide: getRepositoryToken(StockLocationPickupAddress),
          useValue: pickupRepo,
        },
        { provide: GeographyService, useValue: geography },
        { provide: ProductsService, useValue: products },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
      ],
    }).compile();

    service = module.get(FulfillmentService);
  });

  describe('availableForClient', () => {
    it('offers pickup alone when the delivery catalogue is empty', async () => {
      const offer = await service.availableForClient('mun-1');

      expect(offer.deliveryOptions).toEqual([]);
      expect(offer.pickupPoints).toHaveLength(1);
      expect(offer.unavailableMessage).toBeNull();
    });

    it('hides pickup entirely when the switch is off', async () => {
      settingsRepo.findOne.mockResolvedValue({
        data: { pickupEnabled: false, supportMessage: 'Escribinos' },
      });

      const offer = await service.availableForClient('mun-1');

      expect(offer.pickupPoints).toEqual([]);
      expect(offer.unavailableMessage).toBe('Escribinos');
    });

    // The state the business is in at launch, plus a storage with no address.
    it('blocks when nothing at all can be offered', async () => {
      pickupPoints = [];

      const offer = await service.availableForClient('mun-1');

      expect(offer.unavailableMessage).toBeTruthy();
    });

    // Advertising delivery to a place no warehouse serves sends the customer
    // to a checkout that can only fail on availability.
    it('offers no delivery where no active storage serves', async () => {
      optionRepo.find.mockResolvedValue([option()]);
      products.coveringLocationIds.mockResolvedValue([]);

      const offer = await service.availableForClient('mun-1');

      expect(offer.deliveryOptions).toEqual([]);
    });

    it('offers an option with no zones anywhere', async () => {
      optionRepo.find.mockResolvedValue([option()]);

      const offer = await service.availableForClient('mun-1');

      expect(offer.deliveryOptions.map((o) => o.id)).toEqual(['opt-1']);
    });

    it('offers a municipality-scoped option only in that municipality', async () => {
      optionRepo.find.mockResolvedValue([option()]);
      zoneRepo.find.mockResolvedValue([
        { optionId: 'opt-1', provinceId: 'prov-1', municipalityId: 'mun-9' },
      ]);

      expect(
        (await service.availableForClient('mun-1')).deliveryOptions,
      ).toEqual([]);

      geography.getMunicipalityOrThrow.mockResolvedValue({
        id: 'mun-9',
        provinceId: 'prov-1',
      });
      expect(
        (await service.availableForClient('mun-9')).deliveryOptions,
      ).toHaveLength(1);
    });

    it('treats a province-wide zone as covering its municipalities', async () => {
      optionRepo.find.mockResolvedValue([option()]);
      zoneRepo.find.mockResolvedValue([
        { optionId: 'opt-1', provinceId: 'prov-1', municipalityId: null },
      ]);

      expect(
        (await service.availableForClient('mun-1')).deliveryOptions,
      ).toHaveLength(1);
    });

    it('shows only unrestricted options when the place is unknown', async () => {
      optionRepo.find.mockResolvedValue([option(), option({ id: 'opt-2' })]);
      zoneRepo.find.mockResolvedValue([
        { optionId: 'opt-2', provinceId: 'prov-1', municipalityId: 'mun-9' },
      ]);

      const offer = await service.availableForClient();

      expect(offer.deliveryOptions.map((o) => o.id)).toEqual(['opt-1']);
      expect(geography.getMunicipalityOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('resolveChoice', () => {
    it('returns the pickup point and its storage', async () => {
      const choice = await service.resolveChoice({
        fulfillmentType: FulfillmentType.PICKUP,
        pickupAddressId: 'pick-1',
        municipalityId: 'mun-1',
      });

      expect(choice).toMatchObject({
        type: 'pickup',
        fee: '0.00',
        pickupLocationId: 'loc-1',
        pickupAddressId: 'pick-1',
      });
      expect(choice.pickupAddressSnapshot).toMatchObject({
        address: 'Calle 1 #2',
      });
    });

    it('refuses a pickup point that is not on offer', async () => {
      await expect(
        service.resolveChoice({
          fulfillmentType: FulfillmentType.PICKUP,
          pickupAddressId: 'somebody-elses',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses pickup when the switch is off', async () => {
      settingsRepo.findOne.mockResolvedValue({
        data: { pickupEnabled: false, supportMessage: 'Escribinos' },
      });
      optionRepo.find.mockResolvedValue([option()]);

      await expect(
        service.resolveChoice({
          fulfillmentType: FulfillmentType.PICKUP,
          pickupAddressId: 'pick-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('carries the option fee and label onto the order', async () => {
      optionRepo.find.mockResolvedValue([option()]);

      const choice = await service.resolveChoice({
        fulfillmentType: FulfillmentType.DELIVERY,
        deliveryOptionId: 'opt-1',
        municipalityId: 'mun-1',
      });

      expect(choice).toMatchObject({
        type: 'delivery',
        fee: '5.00',
        deliveryOptionId: 'opt-1',
        deliveryOptionLabel: 'Mensajería',
      });
    });

    it('refuses delivery with no option chosen when several are on offer', async () => {
      optionRepo.find.mockResolvedValue([option(), option({ id: 'opt-2' })]);

      await expect(
        service.resolveChoice({
          fulfillmentType: FulfillmentType.DELIVERY,
          municipalityId: 'mun-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    // Nothing to choose between: an omitted id is not a mistake.
    it('takes the only delivery option when just one is on offer', async () => {
      optionRepo.find.mockResolvedValue([option()]);

      const choice = await service.resolveChoice({
        fulfillmentType: FulfillmentType.DELIVERY,
        municipalityId: 'mun-1',
      });

      expect(choice.deliveryOptionId).toBe('opt-1');
    });

    it('takes the only pickup point when just one is on offer', async () => {
      const choice = await service.resolveChoice({
        fulfillmentType: FulfillmentType.PICKUP,
        municipalityId: 'mun-1',
      });

      expect(choice.pickupAddressId).toBe('pick-1');
    });

    it('still refuses an unknown pickup point when several exist', async () => {
      pickupPoints = [point(), point({ id: 'pick-2', label: 'Trastienda' })];

      await expect(
        service.resolveChoice({
          fulfillmentType: FulfillmentType.PICKUP,
          pickupAddressId: 'ghost',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('defaults to pickup when that is all there is', async () => {
      const choice = await service.resolveChoice({
        pickupAddressId: 'pick-1',
        municipalityId: 'mun-1',
      });

      expect(choice.type).toBe('pickup');
    });

    it('refuses everything when the shop can fulfil nothing', async () => {
      pickupPoints = [];

      await expect(service.resolveChoice({})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
