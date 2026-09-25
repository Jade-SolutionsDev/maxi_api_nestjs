import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateCmsFaqCategoryDto,
  CreateCmsFaqQuestionDto,
  UpdateCmsFaqCategoryDto,
  UpdateCmsFaqQuestionDto,
} from './cms-faq.dto';

/**
 * El mensaje de longitud llega tal cual al toast del back-office: si sale el
 * inglés genérico de class-validator, quien edita no sabe qué campo ni cuántos
 * caracteres. Estas pruebas fijan el texto que verá una persona.
 */
describe('límites de longitud de la FAQ', () => {
  const mensajes = async (dto: object) =>
    (await validate(dto)).flatMap((e) => Object.values(e.constraints ?? {}));

  const pregunta = {
    categoryId: '2f4b0f9e-9a4c-4b4e-8a0e-0c5b0d6a1f10',
    answer: 'Respuesta',
  };

  it.each([
    ['crear', CreateCmsFaqQuestionDto],
    ['editar', UpdateCmsFaqQuestionDto],
  ])('explica el límite de 300 de la pregunta al %s', async (_, Dto) => {
    const dto = plainToInstance(Dto, {
      ...pregunta,
      question: 'x'.repeat(301),
    });

    expect(await mensajes(dto)).toContain(
      'La pregunta no puede superar los 300 caracteres',
    );
  });

  it.each([
    ['crear', CreateCmsFaqQuestionDto],
    ['editar', UpdateCmsFaqQuestionDto],
  ])('explica el límite de 120 del texto del enlace al %s', async (_, Dto) => {
    const dto = plainToInstance(Dto, {
      ...pregunta,
      question: 'Pregunta',
      linkLabel: 'x'.repeat(121),
      linkHref: '/contacto',
    });

    expect(await mensajes(dto)).toContain(
      'El texto del enlace no puede superar los 120 caracteres',
    );
  });

  it.each([
    ['crear', CreateCmsFaqCategoryDto],
    ['editar', UpdateCmsFaqCategoryDto],
  ])(
    'explica el límite de 160 del título de categoría al %s',
    async (_, Dto) => {
      const dto = plainToInstance(Dto, { title: 'x'.repeat(161) });

      expect(await mensajes(dto)).toContain(
        'El título no puede superar los 160 caracteres',
      );
    },
  );

  it('acepta una pregunta de exactamente 300 caracteres', async () => {
    const dto = plainToInstance(CreateCmsFaqQuestionDto, {
      ...pregunta,
      question: 'x'.repeat(300),
    });

    expect(await mensajes(dto)).toEqual([]);
  });
});
