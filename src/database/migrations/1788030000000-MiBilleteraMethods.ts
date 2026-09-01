import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mi Billetera pasa a ofrecerse de dos formas —saldo de la app y criptomonedas—
 * y el cliente elige al pagar. La fila que ya existe pasa a ser la de cripto y
 * hay que decirlo por su nombre: antes se llamaba sólo «Mi Billetera», que ya
 * no distingue nada. La fila nueva («mibilletera-wallet») la crea sola la
 * siembra al arrancar, desactivada, hasta que un administrador la habilite.
 *
 * Guardado por los valores anteriores exactos para no pisar un texto reescrito
 * a mano. Repetirla no hace nada.
 */
export class MiBilleteraMethods1788030000000 implements MigrationInterface {
  name = 'MiBilleteraMethods1788030000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE payment_methods
          SET label = 'Mi Billetera — Criptomonedas',
              icon = 'Bitcoin'
        WHERE code = 'mibilletera'
          AND label IN ('Mi Billetera', 'Criptomonedas (Mi Billetera)')`,
    );
    await queryRunner.query(
      `UPDATE payment_methods
          SET description = 'Envía USDT a la dirección que te damos; te confirmamos al recibirlo.'
        WHERE code = 'mibilletera'
          AND description IN (
            'Paga desde tu app de Mi Billetera con tu saldo en USD, CUP o cripto.',
            'Transfiere USDT desde tu billetera; te damos la dirección de depósito.',
            'Transferí USDT desde tu billetera; te damos la dirección de depósito.'
          )`,
    );
  }

  /** Contenido, no esquema: revertir sólo repondría el nombre viejo. */
  public async down(): Promise<void> {
    return Promise.resolve();
  }
}
