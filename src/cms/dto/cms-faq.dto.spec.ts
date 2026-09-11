import { validate } from 'class-validator';
import { CreateCmsFaqQuestionDto } from './cms-faq.dto';

const validQuestion = () =>
  Object.assign(new CreateCmsFaqQuestionDto(), {
    categoryId: '11111111-1111-4111-8111-111111111111',
    question: '¿Cómo pago?',
    answer: 'Sigue las instrucciones.',
  });

describe('CreateCmsFaqQuestionDto', () => {
  it('accepts an optional complete internal link', async () => {
    const dto = Object.assign(validQuestion(), {
      linkLabel: 'Ver pedidos',
      linkHref: '/pedidos',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a partial link', async () => {
    const dto = Object.assign(validQuestion(), {
      linkLabel: 'Ver pedidos',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects unsafe link protocols', async () => {
    const dto = Object.assign(validQuestion(), {
      linkLabel: 'Abrir',
      linkHref: 'javascript:alert(1)',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
