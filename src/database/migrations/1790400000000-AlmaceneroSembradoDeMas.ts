import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recortar la plantilla del Almacenero allí donde se sembró de más.
 *
 * Hasta el 18-sep-2026 la plantilla nacía pudiendo crear, editar y borrar
 * productos, modificar almacenes y mover pedidos. MxH-0036 define lo
 * contrario: opera almacenes e inventario, y el catálogo solo lo consulta.
 * El código se arregló ese día, pero el sembrador **no reafirma un rol que ya
 * existe**, así que toda base creada antes se quedó con los permisos viejos
 * —staging los tiene: 20 en lugar de 12— y los criterios de aceptación de la
 * tarjeta («no puede crear productos», «no puede modificar almacenes»)
 * fallarían con el rol tal y como está.
 *
 * **Solo toca el rol si nadie lo ha tocado.** No basta mirar `updated_at`:
 * conceder o retirar permisos escribe en `role_permissions`, no en la fila del
 * rol. Así que la comprobación es el propio conjunto de permisos: si es
 * exactamente el que sembraba la versión vieja, se recorta; si alguien ha
 * añadido o quitado algo —aunque sea uno—, la configuración es una decisión de
 * alguien y manda sobre esta migración.
 */

/** Lo que sembraba la versión vieja, en orden. */
const CONJUNTO_VIEJO = [
  'categories:list',
  'categories:read',
  'departments:list',
  'departments:read',
  'inventory:create-operation',
  'inventory:history',
  'inventory:list',
  'inventory:read',
  'orders:list',
  'orders:read',
  'orders:update-status',
  'orders:update-status-direct',
  'products:create',
  'products:delete',
  'products:list',
  'products:read',
  'products:update',
  'stock-locations:list',
  'stock-locations:read',
  'stock-locations:update',
];

/** Lo que MxH-0036 autoriza, y lo que siembra el código de hoy. */
const CONJUNTO_NUEVO = [
  'categories:list',
  'categories:read',
  'departments:list',
  'departments:read',
  'inventory:create-operation',
  'inventory:history',
  'inventory:list',
  'inventory:read',
  'products:list',
  'products:read',
  'stock-locations:list',
  'stock-locations:read',
];

/** La diferencia: lo que sobra respecto a la tarjeta. */
const DE_MAS = CONJUNTO_VIEJO.filter((p) => !CONJUNTO_NUEVO.includes(p));

type FilaRol = { id: string };
type FilaPermiso = { clave: string };

export class AlmaceneroSembradoDeMas1790400000000 implements MigrationInterface {
  name = 'AlmaceneroSembradoDeMas1790400000000';

  /** El rol semilla y su conjunto de permisos actual, o `null` si no existe. */
  private async plantilla(
    queryRunner: QueryRunner,
  ): Promise<{ id: string; conjunto: string[] } | null> {
    const roles = (await queryRunner.query(
      `SELECT "id" FROM "roles" WHERE "system_key" = 'GROCER' LIMIT 1`,
    )) as FilaRol[];
    if (roles.length === 0) return null;

    const permisos = (await queryRunner.query(
      `SELECT p."module" || ':' || p."action" AS clave
         FROM "role_permissions" rp
         JOIN "permissions" p ON p."id" = rp."permission_id"
        WHERE rp."role_id" = $1`,
      [roles[0].id],
    )) as FilaPermiso[];
    return { id: roles[0].id, conjunto: permisos.map((p) => p.clave) };
  }

  /**
   * Compara dos conjuntos sin fiarse del orden de la base: con una colación
   * como `en_US.UTF-8` el guion de `stock-locations` o de
   * `update-status-direct` no ordena como uno espera, así que se ordenan los
   * dos lados aquí con la misma regla.
   */
  private mismoConjunto(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const ordenado = (xs: string[]) => [...xs].sort();
    const x = ordenado(a);
    const y = ordenado(b);
    return x.every((v, i) => v === y[i]);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const plantilla = await this.plantilla(queryRunner);
    if (!plantilla) return;
    if (!this.mismoConjunto(plantilla.conjunto, CONJUNTO_VIEJO)) return;

    await queryRunner.query(
      `DELETE FROM "role_permissions"
        WHERE "role_id" = $1
          AND "permission_id" IN (
            SELECT "id" FROM "permissions"
             WHERE "module" || ':' || "action" = ANY($2::text[])
          )`,
      [plantilla.id, DE_MAS],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const plantilla = await this.plantilla(queryRunner);
    if (!plantilla) return;
    if (!this.mismoConjunto(plantilla.conjunto, CONJUNTO_NUEVO)) return;

    await queryRunner.query(
      `INSERT INTO "role_permissions" ("role_id", "permission_id")
        SELECT $1, "id" FROM "permissions"
         WHERE "module" || ':' || "action" = ANY($2::text[])
        ON CONFLICT DO NOTHING`,
      [plantilla.id, DE_MAS],
    );
  }
}
