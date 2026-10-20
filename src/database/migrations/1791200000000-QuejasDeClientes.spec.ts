import type { QueryRunner } from 'typeorm';
import { QuejasDeClientes1791200000000 } from './1791200000000-QuejasDeClientes';

describe('QuejasDeClientes1791200000000', () => {
  const runner = () =>
    ({
      query: jest.fn().mockResolvedValue(undefined),
    }) as unknown as QueryRunner;

  const sql = (qr: QueryRunner) =>
    (qr.query as jest.Mock).mock.calls.map(([s]) => s as string).join('\n');

  it('crea las dos tablas con sus índices', async () => {
    const qr = runner();
    await new QuejasDeClientes1791200000000().up(qr);
    const texto = sql(qr);

    expect(texto).toContain('CREATE TABLE "complaints"');
    expect(texto).toContain('CREATE TABLE "complaint_events"');
    expect(texto).toContain('IDX_complaints_client_id');
    expect(texto).toContain('IDX_complaints_order_id');
    expect(texto).toContain('IDX_complaint_events_complaint_id');
  });

  /**
   * Sin ningún motivo no se puede registrar una queja, y el módulo nacería
   * inservible hasta que alguien se acordara de crearlos a mano.
   */
  it('siembra los motivos en el catálogo que ya existe', async () => {
    const qr = runner();
    await new QuejasDeClientes1791200000000().up(qr);
    const texto = sql(qr);

    expect(texto).toContain(`INSERT INTO "nomenclators"`);
    expect(texto).toContain(`'complaint-motive', 'pedido-incompleto'`);
    expect(texto).toContain('Producto en mal estado');
  });

  // El catálogo lo comparte con los motivos de contacto: un `down` que borrara
  // la tabla entera se llevaría por delante los del otro módulo.
  it('al deshacer, solo borra sus propios motivos', async () => {
    const qr = runner();
    await new QuejasDeClientes1791200000000().down(qr);
    const texto = sql(qr);

    expect(texto).toContain(
      `DELETE FROM "nomenclators" WHERE "category" = 'complaint-motive'`,
    );
    expect(texto).not.toContain('DROP TABLE "nomenclators"');
  });

  it('deshace las dos tablas y sus tipos', async () => {
    const qr = runner();
    await new QuejasDeClientes1791200000000().down(qr);
    const texto = sql(qr);

    expect(texto).toContain('DROP TABLE "complaint_events"');
    expect(texto).toContain('DROP TABLE "complaints"');
    expect(texto).toContain('DROP TYPE "public"."complaints_status_enum"');
  });
});
