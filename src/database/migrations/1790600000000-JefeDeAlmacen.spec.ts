import type { QueryRunner } from 'typeorm';
import { JefeDeAlmacen1790600000000 } from './1790600000000-JefeDeAlmacen';

describe('JefeDeAlmacen1790600000000', () => {
  const runner = () =>
    ({
      query: jest.fn().mockResolvedValue(undefined),
    }) as unknown as QueryRunner;

  const sql = (qr: QueryRunner) =>
    (qr.query as jest.Mock).mock.calls.map(([s]) => s as string).join('\n');

  it('renombra la plantilla a «Jefe de almacén»', async () => {
    const qr = runner();
    await new JefeDeAlmacen1790600000000().up(qr);
    expect(sql(qr)).toContain(`SET "name" = 'Jefe de almacén'`);
    expect(sql(qr)).toContain(`"system_key" = 'GROCER'`);
  });

  /**
   * El resguardo que hace esto seguro: si alguien ya le puso otro nombre desde
   * el panel, su nombre manda. Se aceptan las dos formas sembradas porque hubo
   * una época con el sufijo «— base».
   */
  it('solo toca el nombre si sigue siendo el sembrado', async () => {
    const qr = runner();
    await new JefeDeAlmacen1790600000000().up(qr);
    expect(sql(qr)).toContain(`'Almacenero', 'Almacenero — base'`);
  });

  /**
   * `system_key` es la llave con la que el sembrador reconoce la plantilla, y
   * tiene índice único. Si se cambiara, cada base existente sembraría un rol
   * duplicado — que es el problema del que viene MxH-0036.
   */
  it('no toca system_key', async () => {
    const qr = runner();
    const m = new JefeDeAlmacen1790600000000();
    await m.up(qr);
    await m.down(qr);
    expect(sql(qr)).not.toMatch(/SET\s+"system_key"/i);
  });

  /** Un rol con usuarios no lo borra una migración. */
  it('no borra roles ni asignaciones', async () => {
    const qr = runner();
    const m = new JefeDeAlmacen1790600000000();
    await m.up(qr);
    await m.down(qr);
    expect(sql(qr)).not.toMatch(/DELETE/i);
    expect(sql(qr)).not.toMatch(/user_roles/i);
  });

  it('se puede deshacer', async () => {
    const qr = runner();
    await new JefeDeAlmacen1790600000000().down(qr);
    expect(sql(qr)).toContain(`SET "name" = 'Almacenero'`);
  });
});
