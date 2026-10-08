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
  hours: '9:00 am a 3:00 pm, de lunes a viernes',
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
  let settingsRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    manager: { query: jest.Mock };
  };
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
      manager: { query: jest.fn().mockResolvedValue([]) },
    };
    geography = {
      getMunicipalityOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'mun-1', provinceId: 'prov-1' }),
    };
    products = {
      coveringLocationIds: jest.fn().mockResolvedValue(['loc-1']),
    };

    // Chainable stub for the pickup-points query builder. `andWhere` is not a
    // no-op: it applies the storage filter the service asks for, so a test that
    // claims a counter was filtered out is actually measuring the filter.
    const nuevaCadena = () => {
      let serving: string[] | null = null;
      const chain: Record<string, unknown> = {
        getRawMany: () =>
          Promise.resolve(
            serving === null
              ? pickupPoints
              : pickupPoints.filter((p) => serving?.includes(p.locationId)),
          ),
        andWhere: (_sql: string, params?: { serving?: string[] }) => {
          if (params?.serving) serving = params.serving;
          return chain;
        },
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
      return chain;
    };
    const pickupRepo = { createQueryBuilder: () => nuevaCadena() };

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

    it('hides every pickup point when no storage covers the municipality', async () => {
      products.coveringLocationIds.mockResolvedValue([]);

      const offer = await service.availableForClient('mun-1');

      expect(offer.pickupPoints).toEqual([]);
      expect(products.coveringLocationIds).toHaveBeenCalledWith({
        municipalityId: 'mun-1',
      });
    });

    /**
     * MxH-0101. El catálogo enseña el producto porque un almacén con cobertura
     * tiene stock; si ese almacén no tiene mostrador, el checkout se quedaba
     * sin una sola vía y mandaba a escribir por privado. El pedido sí sabe
     * resolverlo: reserva en los almacenes con cobertura y marca el traslado
     * al mostrador elegido (orders.service, resolveAllowedLocationIds).
     */
    it('ofrece los demás mostradores cuando el almacén que cubre la zona no tiene ninguno', async () => {
      pickupPoints = [point({ id: 'pick-2', locationId: 'loc-2' })];
      products.coveringLocationIds.mockResolvedValue(['loc-1']);

      const offer = await service.availableForClient('mun-1');

      expect(offer.pickupPoints).toHaveLength(1);
      expect(offer.pickupPoints[0].locationId).toBe('loc-2');
      expect(offer.unavailableMessage).toBeNull();
    });

    it('prefiere el mostrador de la zona cuando lo hay, y no enseña los lejanos', async () => {
      pickupPoints = [point(), point({ id: 'pick-2', locationId: 'loc-2' })];
      products.coveringLocationIds.mockResolvedValue(['loc-1']);

      const offer = await service.availableForClient('mun-1');

      expect(offer.pickupPoints.map((p) => p.locationId)).toEqual(['loc-1']);
    });

    it('keeps the full pickup list when the customer has no municipality', async () => {
      const offer = await service.availableForClient(undefined);

      expect(offer.pickupPoints).toHaveLength(1);
    });

    it('hides pickup entirely when the switch is off', async () => {
      settingsRepo.findOne.mockResolvedValue({
        data: { pickupEnabled: false, supportMessage: 'Escríbenos' },
      });

      const offer = await service.availableForClient('mun-1');

      expect(offer.pickupPoints).toEqual([]);
      expect(offer.unavailableMessage).toBe('Escríbenos');
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

  describe('ajustes', () => {
    it('guardar un ajuste no borra los demás', async () => {
      // Guardar solo el mensaje llegó a borrar la clave de recogida del
      // jsonb: el campo del DTO no enviado pisaba el valor guardado.
      settingsRepo.findOne.mockResolvedValue({
        id: 's1',
        data: { pickupEnabled: false, supportMessage: 'antiguo' },
      });

      await service.updateSettings({ supportMessage: 'nuevo' });

      const guardado = settingsRepo.save.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(guardado.data).toMatchObject({
        pickupEnabled: false,
        supportMessage: 'nuevo',
      });
    });

    it('guarda el plazo de recogida', async () => {
      settingsRepo.findOne.mockResolvedValue({
        id: 's1',
        data: { pickupEnabled: true, supportMessage: 'hola' },
      });

      await service.updateSettings({ pickupPromiseDays: 3 });

      const guardado = settingsRepo.save.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(guardado.data.pickupPromiseDays).toBe(3);
      expect(guardado.data.supportMessage).toBe('hola');
    });

    it('la oferta pública lleva el plazo de recogida', async () => {
      settingsRepo.findOne.mockResolvedValue({
        id: 's1',
        data: {
          pickupEnabled: true,
          supportMessage: 'hola',
          pickupPromiseDays: 2,
        },
      });

      const oferta = await service.availableForClient();

      expect(oferta.pickupPromiseDays).toBe(2);
    });
  });

  /**
   * P-046: cubrir un municipio no es poder despachar en él. El catálogo enseña
   * productos donde hay cobertura y stock; el checkout exige además una vía.
   * Nada avisaba de la diferencia hasta que la contaba un cliente.
   */
  describe('municipios sin forma de despacho', () => {
    it('no los busca siquiera cuando la recogida está en pie', async () => {
      const respuesta = await service.getSettingsResponse();

      expect(respuesta.municipalitiesWithoutFulfillment).toEqual([]);
      // La consulta cuesta y sobra: con un mostrador en pie, cualquier
      // municipio cubierto lo alcanza (MxH-0101).
      expect(settingsRepo.manager.query).not.toHaveBeenCalled();
    });

    it('los enseña cuando la recogida está apagada', async () => {
      settingsRepo.findOne.mockResolvedValue({
        data: { pickupEnabled: false, supportMessage: 'Escríbenos' },
      });
      settingsRepo.manager.query.mockResolvedValue([
        { id: 'mun-1', name: 'Contramaestre' },
      ]);

      const respuesta = await service.getSettingsResponse();

      expect(respuesta.municipalitiesWithoutFulfillment).toEqual([
        { id: 'mun-1', name: 'Contramaestre' },
      ]);
    });

    it('también cuando la recogida está activada pero no hay un solo mostrador', async () => {
      pickupPoints = [];
      settingsRepo.manager.query.mockResolvedValue([
        { id: 'mun-1', name: 'Contramaestre' },
      ]);

      const respuesta = await service.getSettingsResponse();

      expect(respuesta.pickupEnabledWithoutAddresses).toBe(true);
      expect(respuesta.municipalitiesWithoutFulfillment).toHaveLength(1);
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

    /**
     * MxH-0160. El horario se congela con la dirección por lo mismo que ella: el
     * pedido guarda lo que se le dijo al cliente al comprar, y de ahí lo leen la
     * ficha del pedido y los correos sin volver a preguntar.
     */
    it('congela el horario del mostrador junto a su dirección', async () => {
      const choice = await service.resolveChoice({
        fulfillmentType: FulfillmentType.PICKUP,
        pickupAddressId: 'pick-1',
        municipalityId: 'mun-1',
      });

      expect(choice.pickupAddressSnapshot).toMatchObject({
        hours: '9:00 am a 3:00 pm, de lunes a viernes',
      });
    });

    it('un mostrador sin horario deja el campo en nulo, no en undefined', async () => {
      pickupPoints = [point({ hours: null })];

      const choice = await service.resolveChoice({
        fulfillmentType: FulfillmentType.PICKUP,
        pickupAddressId: 'pick-1',
        municipalityId: 'mun-1',
      });

      expect(choice.pickupAddressSnapshot).toMatchObject({ hours: null });
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
        data: { pickupEnabled: false, supportMessage: 'Escríbenos' },
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
