import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCategoryDto } from './create-category.dto';

const base = {
  departmentId: '11111111-1111-4111-8111-111111111111',
  name: 'Bebidas',
  imageDesktopUrl: 'https://cdn.maxihabana.com/bebidas.webp',
};

const errores = async (input: Record<string, unknown>) =>
  (await validate(plainToInstance(CreateCategoryDto, input))).map(
    (e) => e.property,
  );

describe('CreateCategoryDto', () => {
  // MxH-0019, reportado por QA el 7-sep-2026: el formulario dejó de exigir la
  // imagen de móvil pero la API seguía pidiéndola, así que guardar con una sola
  // imagen respondía 400 y la categoría no se creaba.
  it('acepta una categoría con una sola imagen, la de escritorio', async () => {
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
        imageMobileUrl: 'https://cdn.maxihabana.com/bebidas-movil.webp',
      }),
    ).toEqual([]);
  });

  it('rechaza una imagen de móvil que no sea texto', async () => {
    expect(await errores({ ...base, imageMobileUrl: 42 })).toContain(
      'imageMobileUrl',
    );
  });

  it('sigue exigiendo departamento y nombre', async () => {
    const fallos = await errores({ imageDesktopUrl: base.imageDesktopUrl });
    expect(fallos).toContain('departmentId');
    expect(fallos).toContain('name');
  });
});
