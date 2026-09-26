import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateOrderForClientDto } from './create-order-for-client.dto';

const base = {
  clientId: '11111111-1111-4111-8111-111111111111',
  items: [{ productId: '22222222-2222-4222-8222-222222222222', quantity: 2 }],
};

const errores = (payload: unknown) =>
  validateSync(plainToInstance(CreateOrderForClientDto, payload), {
    whitelist: true,
  });

describe('CreateOrderForClientDto', () => {
  it('acepta lo mínimo: un cliente y una línea', () => {
    expect(errores(base)).toHaveLength(0);
  });

  it('exige al menos una línea', () => {
    expect(errores({ ...base, items: [] }).length).toBeGreaterThan(0);
  });

  it('exige el cliente: no hay pedidos sin cliente', () => {
    const { clientId, ...sinCliente } = base;
    expect(errores(sinCliente).length).toBeGreaterThan(0);
  });

  it('acepta el cobro ya hecho, con su método', () => {
    expect(
      errores({
        ...base,
        cobro: { paymentMethod: 'manual', reference: 'TRF-9912' },
      }),
    ).toHaveLength(0);
  });

  it('rechaza un cobro sin método de pago', () => {
    expect(
      errores({ ...base, cobro: { reference: 'TRF-9912' } }).length,
    ).toBeGreaterThan(0);
  });
});
