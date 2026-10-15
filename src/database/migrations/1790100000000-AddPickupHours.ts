import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El horario del mostrador, junto a su dirección.
 *
 * MxH-0160: el horario de recogida no existía en ninguna parte del sistema.
 * Vivía dentro del texto libre de la ficha de un producto —«Hora de recogida:
 * 9:00 am a 3:00 pm de Lunes a Viernes», en la balita de gas— y por tanto no se
 * podía enseñar en el checkout, ni en el pedido, ni en los correos. Tres
 * clientes lo preguntaron por correo en septiembre.
 *
 * Texto libre y no horas numéricas a propósito: un mostrador cubano dice «9:00
 * am a 3:00 pm de lunes a viernes, y los sábados hasta mediodía», y partirlo en
 * columnas por día obliga a decidir hoy cosas que nadie ha preguntado. Cuando
 * haga falta cerrar por feriados o abrir dos turnos, se modela entonces.
 */
export class AddPickupHours1790100000000 implements MigrationInterface {
  name = 'AddPickupHours1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stock_location_pickup_addresses" ADD COLUMN IF NOT EXISTS "hours" character varying(160)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stock_location_pickup_addresses" DROP COLUMN IF EXISTS "hours"`,
    );
  }
}
