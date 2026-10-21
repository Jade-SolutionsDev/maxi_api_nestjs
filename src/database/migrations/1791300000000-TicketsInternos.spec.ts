import type { QueryRunner } from 'typeorm';
import { TicketsInternos1791300000000 } from './1791300000000-TicketsInternos';

describe('TicketsInternos1791300000000', () => {
  const runner = () =>
    ({
      query: jest.fn().mockResolvedValue(undefined),
    }) as unknown as QueryRunner;

  const sql = (qr: QueryRunner) =>
    (qr.query as jest.Mock).mock.calls.map(([s]) => s as string).join('\n');

  it('crea las dos tablas con sus índices', async () => {
    const qr = runner();
    await new TicketsInternos1791300000000().up(qr);
    const texto = sql(qr);

    expect(texto).toContain('CREATE TABLE "tickets"');
    expect(texto).toContain('CREATE TABLE "ticket_events"');
    expect(texto).toContain('IDX_tickets_status');
    expect(texto).toContain('IDX_tickets_priority');
    expect(texto).toContain('IDX_tickets_assigned_user_id');
    expect(texto).toContain('IDX_ticket_events_ticket_id');
  });

  it('los cuatro estados y las tres prioridades, como el enumerado', async () => {
    const qr = runner();
    await new TicketsInternos1791300000000().up(qr);
    const texto = sql(qr);

    expect(texto).toContain(
      `ENUM('abierto', 'en_curso', 'resuelto', 'cerrado')`,
    );
    expect(texto).toContain(`ENUM('baja', 'media', 'alta')`);
    expect(texto).toContain(`DEFAULT 'media'`);
    expect(texto).toContain(`DEFAULT 'abierto'`);
  });

  it('las imágenes nacen como lista vacía, no como nulo', async () => {
    // Un `null` ahí obligaría a todo el código de lectura a defenderse.
    const qr = runner();
    await new TicketsInternos1791300000000().up(qr);
    expect(sql(qr)).toContain(`"images" jsonb NOT NULL DEFAULT '[]'::jsonb`);
  });

  /**
   * Sin ninguna categoría no se puede abrir un ticket, y el módulo nacería
   * inservible hasta que alguien se acordara de crearlas a mano.
   */
  it('siembra las categorías en el catálogo que ya existe', async () => {
    const qr = runner();
    await new TicketsInternos1791300000000().up(qr);
    const texto = sql(qr);

    expect(texto).toContain(`INSERT INTO "nomenclators"`);
    expect(texto).toContain(`'ticket-category', 'sistema-o-panel'`);
    expect(texto).toContain('Almacén e inventario');
  });

  // El catálogo lo comparte con los motivos de contacto y de queja: un `down`
  // que borrara la tabla entera se llevaría por delante los de los otros.
  it('al deshacer, solo borra sus propias categorías', async () => {
    const qr = runner();
    await new TicketsInternos1791300000000().down(qr);
    const texto = sql(qr);

    expect(texto).toContain(
      `DELETE FROM "nomenclators" WHERE "category" = 'ticket-category'`,
    );
    expect(texto).not.toContain('DROP TABLE "nomenclators"');
  });
});
