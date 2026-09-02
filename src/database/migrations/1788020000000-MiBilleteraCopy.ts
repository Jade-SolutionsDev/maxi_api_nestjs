import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El método de Mi Billetera se sembró como «Criptomonedas (Mi Billetera)» y
 * describiéndose sólo como un depósito de USDT. Ya no es eso: se paga desde la
 * app con saldo en USD, CUP o cripto, y el nombre corto es el que usa la marca.
 * El código nuevo lo siembra bien, pero la siembra no reescribe filas que ya
 * existen, así que los entornos levantados siguen con el texto viejo.
 *
 * Guardado por el valor anterior exacto — incluye tanto el original en voseo
 * como el que dejó la migración de textos en cubano — para no pisar nada que
 * alguien haya reescrito a mano.
 */
export class MiBilleteraCopy1788020000000 implements MigrationInterface {
  name = 'MiBilleteraCopy1788020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE payment_methods
          SET label = 'Mi Billetera'
        WHERE code = 'mibilletera'
          AND label = 'Criptomonedas (Mi Billetera)'`,
    );
    await queryRunner.query(
      `UPDATE payment_methods
          SET description = 'Paga desde tu app de Mi Billetera con tu saldo en USD, CUP o cripto.'
        WHERE code = 'mibilletera'
          AND description IN (
            'Transferí USDT desde tu billetera; te damos la dirección de depósito.',
            'Transfiere USDT desde tu billetera; te damos la dirección de depósito.'
          )`,
    );
  }

  /** Contenido, no esquema: revertir sólo repondría el nombre viejo. */
  public async down(): Promise<void> {
    return Promise.resolve();
  }
}
