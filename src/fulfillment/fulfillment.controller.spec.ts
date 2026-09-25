import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FulfillmentController } from './fulfillment.controller';
import { FulfillmentService } from './fulfillment.service';
import { StorefrontFulfillmentDto } from './dto/storefront-fulfillment.dto';

// Mismo cálculo que ve el cliente (availableForClient), pero servido al panel
// para que el empleado elija por él. Ver fulfillment.controller.ts para el
// porqué de esta ruta pese a existir ya storefront-fulfillment.controller.ts.
describe('FulfillmentController', () => {
  let controller: FulfillmentController;
  let fulfillmentService: { availableForClient: jest.Mock };

  beforeEach(async () => {
    fulfillmentService = {
      availableForClient: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FulfillmentController],
      providers: [
        { provide: FulfillmentService, useValue: fulfillmentService },
      ],
    }).compile();

    controller = module.get(FulfillmentController);
  });

  it('delega en el servicio con el municipio recibido, sin reimplementar el cálculo', async () => {
    const offer: StorefrontFulfillmentDto = {
      deliveryOptions: [],
      pickupPoints: [],
      pickupEnabled: true,
      pickupPromiseDays: 2,
      unavailableMessage: null,
    };
    fulfillmentService.availableForClient.mockResolvedValue(offer);

    const result = await controller.find('mun-1');

    expect(fulfillmentService.availableForClient).toHaveBeenCalledWith('mun-1');
    expect(fulfillmentService.availableForClient).toHaveBeenCalledTimes(1);
    expect(result).toBe(offer);
  });

  it('sin municipio, responde 400 sin llegar a llamar al servicio', () => {
    expect(() => controller.find(undefined)).toThrow(BadRequestException);
    expect(fulfillmentService.availableForClient).not.toHaveBeenCalled();
  });
});
