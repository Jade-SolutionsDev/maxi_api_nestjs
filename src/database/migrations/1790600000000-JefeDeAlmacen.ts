import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La plantilla de almacén pasa a llamarse «Jefe de almacén».
 *
 * MxH-0036 describe al responsable del almacén, no a quien mueve las cajas, y
 * «Almacenero» nombraba lo segundo. Decidido por Jade el 9-oct-2026: **un solo
 * rol de almacén**, y en singular.
 *
 * Solo toca la fila cuyo nombre sigue siendo el sembrado —en cualquiera de sus
 * dos formas históricas—: si alguien ya la renombró a mano, ese nombre manda y
 * no se pisa. `seedBaseRoles` crea estos roles una sola vez y nunca los
 * reafirma, así que el nombre nuevo no se revierte en el próximo arranque.
 *
 * `system_key` se queda en `GROCER`: es la llave con la que el sembrador
 * reconoce la plantilla y tiene índice único. Cambiarla sembraría un rol
 * duplicado en cada base existente, que es exactamente el problema del que
 * viene esta tarjeta.
 *
 * **Lo que esta migración no hace:** borrar el rol que alguien se creó a mano
 * con un nombre parecido. En staging hay uno —«jefe de almacenes·», con un
 * espacio al final y dos usuarios— y se retira desde el panel, a mano, después
 * de mover a su gente. Un rol con usuarios asignados no lo borra una migración
 * en bases que nadie ha mirado.
 */
export class JefeDeAlmacen1790600000000 implements MigrationInterface {
  name = 'JefeDeAlmacen1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "roles" SET "name" = 'Jefe de almacén'
        WHERE "system_key" = 'GROCER'
          AND "name" IN ('Almacenero', 'Almacenero — base')`,
    );
    await queryRunner.query(
      `UPDATE "roles"
          SET "description" = 'Permisos iniciales del rol Jefe de almacén. Ajústalos o retíralos según lo que necesite tu equipo.'
        WHERE "system_key" = 'GROCER'
          AND "description" LIKE 'Permisos iniciales del rol Almacenero.%'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "roles" SET "name" = 'Almacenero'
        WHERE "system_key" = 'GROCER' AND "name" = 'Jefe de almacén'`,
    );
    await queryRunner.query(
      `UPDATE "roles"
          SET "description" = 'Permisos iniciales del rol Almacenero. Ajústalos o retíralos según lo que necesite tu equipo.'
        WHERE "system_key" = 'GROCER'
          AND "description" LIKE 'Permisos iniciales del rol Jefe de almacén.%'`,
    );
  }
}
