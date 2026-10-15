import { StockLocationsService } from './stock-locations.service';
import { StockLocationPickupAddress } from './entities/stock-location-pickup-address.entity';

/**
 * El pedido guarda `pickup_address_id`. Si al editar un almacén se borran y
 * recrean sus puntos de recogida, ese id queda apuntando a una fila que ya no
 * existe: medido el 7-oct-2026 en producción, 3.720 de 3.735 pedidos con punto
 * de recogida estaban así. No se veía porque el pedido lleva también una copia
 * de los datos, y no hay clave ajena que lo impidiera.
 *
 * Estas pruebas miran el id, no el contenido: el contenido ya salía bien
 * cuando el fallo estaba, y por eso duró meses sin que nadie lo notara.
 */
describe('StockLocationsService · los puntos de recogida conservan su id', () => {
  const PUNTO = (id: string, address: string, label?: string, hours?: string) =>
    ({
      id,
      locationId: 'alm-1',
      address,
      label: label ?? null,
      hours: hours ?? null,
    }) as StockLocationPickupAddress;

  const montar = (existentes: StockLocationPickupAddress[]) => {
    const guardados: StockLocationPickupAddress[] = [];
    const borrados: string[] = [];
    const repo = {
      find: jest.fn().mockResolvedValue(existentes),
      create: jest.fn((v: Partial<StockLocationPickupAddress>) => ({
        ...v,
        id: `nuevo-${guardados.length + 1}`,
      })),
      save: jest.fn((filas: StockLocationPickupAddress[]) => {
        guardados.push(...filas);
        return Promise.resolve(filas);
      }),
      delete: jest.fn((ids: string[]) => {
        borrados.push(...ids);
        return Promise.resolve({});
      }),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(repo) };
    const servicio = Object.create(
      StockLocationsService.prototype,
    ) as StockLocationsService;
    const reconciliar = (
      servicio as unknown as {
        reconcilePickupAddresses: (
          m: unknown,
          id: string,
          items: unknown[],
        ) => Promise<void>;
      }
    ).reconcilePickupAddresses.bind(servicio);
    return { reconciliar, manager, guardados, borrados, repo };
  };

  it('editar el horario NO cambia el id: es el caso que destapó el fallo', async () => {
    const { reconciliar, manager, guardados, borrados } = montar([
      PUNTO('id-que-no-debe-cambiar', 'Calle 23 #456'),
    ]);

    await reconciliar(manager, 'alm-1', [
      { address: 'Calle 23 #456', hours: '9:00 am a 3:00 pm' },
    ]);

    expect(guardados).toHaveLength(1);
    expect(guardados[0].id).toBe('id-que-no-debe-cambiar');
    expect(guardados[0].hours).toBe('9:00 am a 3:00 pm');
    expect(borrados).toEqual([]);
  });

  it('un punto nuevo se añade sin tocar el que ya estaba', async () => {
    const { reconciliar, manager, guardados, borrados } = montar([
      PUNTO('id-viejo', 'Calle 23 #456'),
    ]);

    await reconciliar(manager, 'alm-1', [
      { address: 'Calle 23 #456' },
      { address: 'Ave 51 #2202' },
    ]);

    expect(guardados.map((f) => f.id)).toEqual(['id-viejo', 'nuevo-1']);
    expect(borrados).toEqual([]);
  });

  it('el punto que se quita sí se borra', async () => {
    const { reconciliar, manager, borrados } = montar([
      PUNTO('se-queda', 'Calle 23 #456'),
      PUNTO('se-va', 'Ave 51 #2202'),
    ]);

    await reconciliar(manager, 'alm-1', [{ address: 'Calle 23 #456' }]);

    expect(borrados).toEqual(['se-va']);
  });

  it('cambiar la dirección sí crea otra fila: es otro punto', async () => {
    const { reconciliar, manager, guardados, borrados } = montar([
      PUNTO('el-de-antes', 'Calle 23 #456'),
    ]);

    await reconciliar(manager, 'alm-1', [{ address: 'Otra calle #1' }]);

    expect(guardados[0].id).toBe('nuevo-1');
    expect(borrados).toEqual(['el-de-antes']);
  });

  it('los espacios de sobra no cuentan como otra dirección', async () => {
    const { reconciliar, manager, guardados } = montar([
      PUNTO('id-estable', 'Calle 23 #456'),
    ]);

    await reconciliar(manager, 'alm-1', [{ address: '  Calle 23 #456  ' }]);

    expect(guardados[0].id).toBe('id-estable');
  });
});
