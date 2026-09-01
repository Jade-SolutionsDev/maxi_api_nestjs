import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Una reserva liberada por caducidad deja de ser indistinguible de una
 * cancelada a mano (`MxH-0078` lo pedía: «conviene medirlos por separado»).
 *
 * Solo añade el valor al enum; no reescribe el histórico. Lo ya liberado por
 * caducidad antes de esto quedó como `cancelled` y no hay dato del que
 * deducirlo, igual que pasó con el backfill de ventas.
 */
export class ExpiredReservationStatus1787790000000 implements MigrationInterface {
  name = 'ExpiredReservationStatus1787790000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ typname }] = (await queryRunner.query(`
      SELECT t.typname
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE e.enumlabel = 'reserved'
       GROUP BY t.typname
       LIMIT 1
    `)) as { typname: string }[];

    await queryRunner.query(
      `ALTER TYPE "${typname}" ADD VALUE IF NOT EXISTS 'expired'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL no sabe quitar un valor de un enum sin reconstruir el tipo, y
    // reconstruirlo con filas dentro es más peligroso que dejar el valor vivo.
  }
}
