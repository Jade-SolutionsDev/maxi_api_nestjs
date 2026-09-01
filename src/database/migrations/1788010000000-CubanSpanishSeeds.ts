import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Los textos sembrados salieron en voseo rioplatense («pagá», «transferí»,
 * «con vos», «escribinos») y el cliente es cubano: se tutea. El código ya se
 * corrigió, pero una siembra sólo escribe la fila la primera vez, así que los
 * entornos que ya estaban levantados siguen mostrando el texto viejo — y estos
 * campos no se editan desde el back-office.
 *
 * Cada UPDATE exige el texto viejo EXACTO: si alguien ya lo reescribió a mano,
 * su versión queda intacta. Repetirla no hace nada.
 */
export class CubanSpanishSeeds1788010000000 implements MigrationInterface {
  name = 'CubanSpanishSeeds1788010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE payment_methods
          SET description = 'Paga con tarjeta de crédito o débito en la pasarela segura de Tropipay.'
        WHERE code = 'tropipay'
          AND description = 'Pagá con tarjeta de crédito o débito en la pasarela segura de Tropipay.'`,
    );
    await queryRunner.query(
      `UPDATE payment_methods
          SET description = 'Transfiere USDT desde tu billetera; te damos la dirección de depósito.'
        WHERE code = 'mibilletera'
          AND description = 'Transferí USDT desde tu billetera; te damos la dirección de depósito.'`,
    );
    await queryRunner.query(
      `UPDATE payment_methods
          SET description = 'Coordinamos el pago contigo y lo confirmamos manualmente.'
        WHERE code = 'manual'
          AND description = 'Coordinamos el pago con vos y lo confirmamos manualmente.'`,
    );
    await queryRunner.query(
      `UPDATE fulfillment_settings
          SET data = jsonb_set(
                data,
                '{supportMessage}',
                '"Por el momento no podemos procesar pedidos en línea. Escríbenos y coordinamos tu compra."'::jsonb
              )
        WHERE data->>'supportMessage' = 'Por el momento no podemos procesar pedidos en línea. Escribinos y coordinamos tu compra.'`,
    );
  }

  /**
   * Sin vuelta atrás: revertir sería reponer el voseo. La migración es
   * puramente de contenido y no cambia el esquema, así que no revertirla no
   * deja nada inconsistente.
   */
  public async down(): Promise<void> {
    return Promise.resolve();
  }
}
