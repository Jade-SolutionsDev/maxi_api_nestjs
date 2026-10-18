import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LocationSource } from '../entities/client-address.entity';
import { CreateClientAddressDto } from './create-client-address.dto';

const base = {
  street: 'Ave 51 #11025',
  municipalityId: '00000000-0000-4000-8000-000000000000',
};

/** Las propiedades que fallan, incluidas las de dentro del objeto anidado. */
const errores = async (input: Record<string, unknown>): Promise<string[]> => {
  const fallos = await validate(plainToInstance(CreateClientAddressDto, input));
  return fallos.flatMap((e) => [
    e.property,
    ...(e.children ?? []).map((hijo) => `${e.property}.${hijo.property}`),
  ]);
};

const punto = {
  latitude: 23.102847,
  longitude: -82.409263,
  source: LocationSource.DEVICE,
};

// MxH-0071. El punto en el mapa va como objeto y no como tres campos sueltos,
// y estas pruebas son la razón: la forma del contrato es lo que hace imposible
// media coordenada, sin una sola comprobación cruzada entre campos.
describe('CreateClientAddressDto · el punto en el mapa', () => {
  it('acepta una dirección sin punto: la ubicación es opcional', async () => {
    expect(await errores(base)).toEqual([]);
  });

  it('acepta un punto completo', async () => {
    expect(await errores({ ...base, location: punto })).toEqual([]);
  });

  it('acepta `location: null`, que es cómo se borra el punto', async () => {
    expect(await errores({ ...base, location: null })).toEqual([]);
  });

  describe('el par incompleto se rechaza', () => {
    it('rechaza la latitud sola', async () => {
      const errs = await errores({
        ...base,
        location: { latitude: 23.102847, source: LocationSource.MANUAL },
      });

      expect(errs).toContain('location.longitude');
    });

    it('rechaza la longitud sola', async () => {
      const errs = await errores({
        ...base,
        location: { longitude: -82.409263, source: LocationSource.MANUAL },
      });

      expect(errs).toContain('location.latitude');
    });

    it('rechaza un punto sin decir de dónde salió', async () => {
      const { source: _fuera, ...sinProcedencia } = punto;

      expect(await errores({ ...base, location: sinProcedencia })).toContain(
        'location.source',
      );
    });

    it('rechaza una procedencia que no es ninguna de las dos', async () => {
      const errs = await errores({
        ...base,
        location: { ...punto, source: 'adivinada' },
      });

      expect(errs).toContain('location.source');
    });
  });

  describe('el rango', () => {
    it.each([
      ['latitud por encima de 90', { ...punto, latitude: 90.000001 }],
      ['latitud por debajo de -90', { ...punto, latitude: -90.1 }],
    ])('rechaza la %s', async (_nombre, location) => {
      expect(await errores({ ...base, location })).toContain(
        'location.latitude',
      );
    });

    it.each([
      ['longitud por encima de 180', { ...punto, longitude: 180.5 }],
      ['longitud por debajo de -180', { ...punto, longitude: -181 }],
    ])('rechaza la %s', async (_nombre, location) => {
      expect(await errores({ ...base, location })).toContain(
        'location.longitude',
      );
    });

    it.each([
      ['el polo sur', { latitude: -90, longitude: 0 }],
      ['el polo norte', { latitude: 90, longitude: 0 }],
      ['el antimeridiano', { latitude: 0, longitude: 180 }],
      ['su otro extremo', { latitude: 0, longitude: -180 }],
      ['el punto cero', { latitude: 0, longitude: 0 }],
    ])('acepta %s: el límite entra', async (_nombre, coords) => {
      const location = { ...coords, source: LocationSource.MANUAL };

      expect(await errores({ ...base, location })).toEqual([]);
    });

    it('rechaza una coordenada que llega como texto', async () => {
      // El formulario manda JSON, no un formulario codificado, así que una
      // cadena aquí es un error de quien integra y no un número por convertir.
      const errs = await errores({
        ...base,
        location: { ...punto, latitude: '23.102847' },
      });

      expect(errs).toContain('location.latitude');
    });
  });
});
