import type { QueryRunner } from 'typeorm';
import { CashPaymentContent1789800000000 } from './1789800000000-CashPaymentContent';

describe('CashPaymentContent1789800000000', () => {
  const runner = () =>
    ({
      query: jest.fn().mockResolvedValue(undefined),
    }) as unknown as QueryRunner;

  it('actualiza sólo la respuesta exacta de efectivo y el bloque 5.1', async () => {
    const queryRunner = runner();

    await new CashPaymentContent1789800000000().up(queryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(2);
    const [faqSql, termsSql] = (queryRunner.query as jest.Mock).mock.calls.map(
      ([sql]) => sql as string,
    );

    expect(faqSql).toContain(`question = '¿Puedo pagar en efectivo?'`);
    expect(faqSql).toContain('AND answer = $1');
    expect(faqSql).toContain(`SET answer = $2`);
    expect(termsSql).toContain(`slug = 'terminos-y-condiciones'`);
    expect(termsSql).toContain('position($1 in content) > 0');
    expect(termsSql).toContain('replace(content, $1, $2)');

    const [, faqParams] = (queryRunner.query as jest.Mock).mock.calls[0];
    const [, termsParams] = (queryRunner.query as jest.Mock).mock.calls[1];
    expect(faqParams[1]).toContain('no caduca automáticamente');
    expect(faqParams[1]).toContain('lo cancele de forma explícita');
    expect(termsParams[1]).toContain('**Pago en efectivo en el local:**');
    expect(termsParams[1]).toContain('permanece pendiente');
    expect(termsParams[1]).toContain('30 minutos');
  });

  it('revierte con los mismos guardas exactos', async () => {
    const queryRunner = runner();

    await new CashPaymentContent1789800000000().down(queryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(2);
    for (const [, params] of (queryRunner.query as jest.Mock).mock.calls) {
      expect(params).toHaveLength(2);
    }
  });
});
