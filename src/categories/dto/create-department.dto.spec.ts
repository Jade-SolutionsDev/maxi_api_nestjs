import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDepartmentDto } from './create-department.dto';

const base = {
  name: 'Alimentos',
  imageDesktopUrl: 'https://cdn.maxihabana.com/alimentos.webp',
};

const errores = async (input: Record<string, unknown>) =>
  (await validate(plainToInstance(CreateDepartmentDto, input))).map(
    (e) => e.property,
  );

describe('CreateDepartmentDto', () => {
  // MxH-0154, reportado por QA el 26-ago-2026: el formulario no marca la
  // imagen de móvil como obligatoria, pero la API seguía pidiéndola, así que
  // guardar con una sola imagen respondía 400 («imageMobileUrl should not be
  // empty») y el departamento no se creaba. MxH-0019 arregló lo mismo en
  // categorías el 18-sep y dejó fuera los departamentos.
  it('acepta un departamento con una sola imagen, la de escritorio', async () => {
    expect(await errores(base)).toEqual([]);
  });

  it('sigue exigiendo la imagen de escritorio', async () => {
    const { imageDesktopUrl: _fuera, ...sinEscritorio } = base;
    expect(await errores(sinEscritorio)).toContain('imageDesktopUrl');
  });

  it('acepta las dos imágenes', async () => {
    expect(
      await errores({
        ...base,
        imageMobileUrl: 'https://cdn.maxihabana.com/alimentos-movil.webp',
      }),
    ).toEqual([]);
  });

  it('rechaza una imagen de móvil que no sea texto', async () => {
    expect(await errores({ ...base, imageMobileUrl: 42 })).toContain(
      'imageMobileUrl',
    );
  });

  it('sigue exigiendo el nombre', async () => {
    expect(await errores({ imageDesktopUrl: base.imageDesktopUrl })).toContain(
      'name',
    );
  });
});

describe('CreateDepartmentDto · imágenes que la tienda no puede pintar', () => {
  // MxH-0086: guardar una URL así dejaba el catálogo sin cargar entero. El
  // validador se añadió a categorías y productos y se olvidó aquí.
  it('rechaza un host sin dominio', async () => {
    expect(
      await errores({ ...base, imageDesktopUrl: 'https://x/p.png' }),
    ).toContain('imageDesktopUrl');
  });

  it('rechaza texto que no es una dirección', async () => {
    expect(
      await errores({ ...base, imageDesktopUrl: 'foto-bonita.png' }),
    ).toContain('imageDesktopUrl');
  });

  it('acepta una ruta propia y los dos almacenamientos en uso', async () => {
    expect(await errores({ ...base, imageDesktopUrl: '/img/a.webp' })).toEqual(
      [],
    );
    expect(
      await errores({
        ...base,
        imageMobileUrl: 'https://res.cloudinary.com/demo/a.webp',
      }),
    ).toEqual([]);
  });
});
