import type { QueryRunner } from 'typeorm';
import { BaseRolesSinSufijo1790200000000 } from './1790200000000-BaseRolesSinSufijo';

describe('BaseRolesSinSufijo1790200000000', () => {
  const runner = () =>
    ({
      query: jest.fn().mockResolvedValue(undefined),
    }) as unknown as QueryRunner;

  const sentencias = (qr: QueryRunner) =>
    (qr.query as jest.Mock).mock.calls.map(([sql]) => sql as string).join('\n');

  it('quita el sufijo a los tres roles semilla', async () => {
    const qr = runner();
    await new BaseRolesSinSufijo1790200000000().up(qr);
    const sql = sentencias(qr);
    expect(sql).toContain(`SET "name" = 'Almacenero'`);
    expect(sql).toContain(`SET "name" = 'Kardista'`);
    expect(sql).toContain(`SET "name" = 'Responsable de la web'`);
  });

  // Si un administrador ya renombró el rol, ese nombre manda: la condición
  // del WHERE es lo que lo protege, así que se comprueba explícitamente.
  it('solo toca las filas cuyo nombre sigue siendo el sembrado', async () => {
    const qr = runner();
    await new BaseRolesSinSufijo1790200000000().up(qr);
    for (const sql of (qr.query as jest.Mock).mock.calls.map(
      ([s]) => s as string,
    )) {
      expect(sql).toMatch(
        /WHERE "system_key" = '\w+' AND "name" = '[^']+— base'/,
      );
    }
  });

  it('se puede deshacer', async () => {
    const qr = runner();
    await new BaseRolesSinSufijo1790200000000().down(qr);
    const sql = sentencias(qr);
    expect(sql).toContain(`SET "name" = 'Almacenero — base'`);
    expect(sql).toContain(`SET "name" = 'Kardista — base'`);
    expect(sql).toContain(`SET "name" = 'Responsable de la web — base'`);
  });
});
