import type { QueryRunner } from 'typeorm';
import { DesglosePrecioLinea1790300000000 } from './1790300000000-DesglosePrecioLinea';

describe('DesglosePrecioLinea1790300000000', () => {
  const runner = () =>
    ({
      query: jest.fn().mockResolvedValue(undefined),
    }) as unknown as QueryRunner;

  const sql = (qr: QueryRunner) =>
    (qr.query as jest.Mock).mock.calls.map(([s]) => s as string).join('\n');

  it('añade las dos columnas del desglose', async () => {
    const qr = runner();
    await new DesglosePrecioLinea1790300000000().up(qr);
    expect(sql(qr)).toContain('ADD COLUMN IF NOT EXISTS "list_price"');
    expect(sql(qr)).toContain('ADD COLUMN IF NOT EXISTS "discount"');
  });

  /**
   * De una línea vieja se conoce lo cobrado y nada más. Rellenar
   * `list_price = unit_price` y `discount = 0` afirmaría que no hubo rebaja,
   * y es falso en todas las que sí la tuvieron.
   */
  it('no rellena lo ya existente con nada inventado', async () => {
    const qr = runner();
    await new DesglosePrecioLinea1790300000000().up(qr);
    expect(sql(qr)).not.toMatch(/UPDATE\s+"order_items"/i);
    expect(sql(qr)).not.toMatch(/DEFAULT/i);
  });

  it('se puede deshacer', async () => {
    const qr = runner();
    await new DesglosePrecioLinea1790300000000().down(qr);
    expect(sql(qr)).toContain('DROP COLUMN IF EXISTS "list_price"');
    expect(sql(qr)).toContain('DROP COLUMN IF EXISTS "discount"');
  });
});
