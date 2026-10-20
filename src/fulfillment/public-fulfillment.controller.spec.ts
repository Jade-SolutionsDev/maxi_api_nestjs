import { PublicFulfillmentController } from './public-fulfillment.controller';
import { FulfillmentService } from './fulfillment.service';
import {
  MotivoSinEntrega,
  StorefrontFulfillmentDto,
} from './dto/storefront-fulfillment.dto';

/**
 * P-046. Este endpoint existe para decir antes del checkout lo que hoy se dice
 * dentro de él. Lo que importa de cada prueba es que `fulfillable` responda a
 * si de verdad hay por dónde, y que no se escape un mostrador ni una dirección
 * a una ruta sin sesión.
 */
describe('PublicFulfillmentController', () => {
  const oferta = (
    parcial: Partial<StorefrontFulfillmentDto>,
  ): StorefrontFulfillmentDto => ({
    deliveryOptions: [],
    pickupPoints: [],
    pickupEnabled: true,
    pickupPromiseDays: null,
    unavailableMessage: null,
    unavailableReason: null,
    ...parcial,
  });

  const montar = (dto: StorefrontFulfillmentDto) => {
    const service = {
      availableForClient: jest.fn().mockResolvedValue(dto),
    } as unknown as FulfillmentService;
    return {
      controlador: new PublicFulfillmentController(service),
      service,
    };
  };

  const PUNTO = {
    id: 'pick-1',
    locationId: 'loc-1',
    locationName: 'Almacén Centro',
    label: 'Mostrador',
    address: 'Calle 1 #2',
    hours: null,
  };

  it('con un mostrador en pie, se puede despachar', async () => {
    const { controlador } = montar(oferta({ pickupPoints: [PUNTO] }));

    await expect(controlador.availability('mun-1')).resolves.toEqual({
      fulfillable: true,
      unavailableMessage: null,
      unavailableReason: null,
    });
  });

  it('con una opción de entrega, también', async () => {
    const { controlador } = montar(
      oferta({
        deliveryOptions: [
          { id: 'opt-1', label: 'Mensajería', description: null, fee: 5 },
        ] as StorefrontFulfillmentDto['deliveryOptions'],
      }),
    );

    const res = await controlador.availability('mun-1');

    expect(res.fulfillable).toBe(true);
  });

  it('sin mostrador ni entrega, no se puede, y se dice con qué palabras', async () => {
    const { controlador } = montar(
      oferta({
        unavailableMessage: 'Escríbenos y lo coordinamos.',
        unavailableReason: MotivoSinEntrega.SIN_CONFIGURAR,
      }),
    );

    await expect(controlador.availability('mun-1')).resolves.toEqual({
      fulfillable: false,
      unavailableMessage: 'Escríbenos y lo coordinamos.',
      unavailableReason: MotivoSinEntrega.SIN_CONFIGURAR,
    });
  });

  /**
   * MxH-0093: la tienda avisa en el carrito, antes del checkout, y necesita
   * saber cuál de los dos casos es para decir si cambiar de zona sirve de algo.
   */
  it('deja pasar el motivo, no solo el mensaje', async () => {
    const { controlador } = montar(
      oferta({
        unavailableMessage: 'Escríbenos y lo coordinamos.',
        unavailableReason: MotivoSinEntrega.FUERA_DE_ZONA,
      }),
    );

    const res = await controlador.availability('mun-1');

    expect(res.unavailableReason).toBe(MotivoSinEntrega.FUERA_DE_ZONA);
  });

  it('un mostrador con la recogida apagada no cuenta como vía', async () => {
    const { controlador } = montar(
      oferta({
        pickupPoints: [PUNTO],
        pickupEnabled: false,
        unavailableMessage: 'Escríbenos',
      }),
    );

    const res = await controlador.availability('mun-1');

    expect(res.fulfillable).toBe(false);
  });

  it('no deja escapar mostradores ni direcciones a una ruta sin sesión', async () => {
    const { controlador } = montar(oferta({ pickupPoints: [PUNTO] }));

    const res = await controlador.availability('mun-1');

    expect(Object.keys(res).sort()).toEqual([
      'fulfillable',
      'unavailableMessage',
      'unavailableReason',
    ]);
    expect(JSON.stringify(res)).not.toContain('Calle 1 #2');
  });

  it('sin municipio pregunta igual: el carrito puede no tener zona todavía', async () => {
    const { controlador, service } = montar(oferta({ pickupPoints: [PUNTO] }));

    await controlador.availability(undefined);

    expect(service.availableForClient).toHaveBeenCalledWith(undefined);
  });
});
