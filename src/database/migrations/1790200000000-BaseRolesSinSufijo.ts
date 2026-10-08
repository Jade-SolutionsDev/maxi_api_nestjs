import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quitar el sufijo «— base» del nombre de los roles semilla.
 *
 * Ese sufijo era la única forma de distinguirlos de los roles creados a mano,
 * porque `system_key` no salía en la respuesta de la API. QA lo encontró
 * confuso —«el término base tal vez pueda sonar confuso», MxH-0103— y tenía
 * razón: clasificar no es tarea del nombre. Ahora el panel recibe `systemKey`
 * y lo enseña como una etiqueta «Base» en la columna «Tipo», así que el
 * sufijo sobra y además quedaría repetido.
 *
 * Solo toca las filas cuyo nombre sigue siendo el sembrado: si alguien ya lo
 * renombró a mano, ese nombre manda y no se pisa. El sembrador crea estos
 * roles una única vez y nunca los reafirma (`seedBaseRoles`), así que el
 * nombre nuevo no se revierte en el próximo arranque.
 */
export class BaseRolesSinSufijo1790200000000 implements MigrationInterface {
  name = 'BaseRolesSinSufijo1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "roles" SET "name" = 'Almacenero'
        WHERE "system_key" = 'GROCER' AND "name" = 'Almacenero — base'`,
    );
    await queryRunner.query(
      `UPDATE "roles" SET "name" = 'Kardista'
        WHERE "system_key" = 'KARDIST' AND "name" = 'Kardista — base'`,
    );
    await queryRunner.query(
      `UPDATE "roles" SET "name" = 'Responsable de la web'
        WHERE "system_key" = 'WEB_MANAGER' AND "name" = 'Responsable de la web — base'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "roles" SET "name" = 'Almacenero — base'
        WHERE "system_key" = 'GROCER' AND "name" = 'Almacenero'`,
    );
    await queryRunner.query(
      `UPDATE "roles" SET "name" = 'Kardista — base'
        WHERE "system_key" = 'KARDIST' AND "name" = 'Kardista'`,
    );
    await queryRunner.query(
      `UPDATE "roles" SET "name" = 'Responsable de la web — base'
        WHERE "system_key" = 'WEB_MANAGER' AND "name" = 'Responsable de la web'`,
    );
  }
}
