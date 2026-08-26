import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Las fechas pasan a llevar zona.
 *
 * Estaban como `timestamp without time zone` y la base guarda UTC, así que al
 * leerlas el driver las interpretaba **en la zona del proceso**: arrancada en
 * `America/Havana`, la aplicación devolvía cada fecha cuatro horas adelantada y
 * la administración las mostraba así (MxH-0014, MxH-0017, MxH-0021).
 *
 * Fijar `TZ=UTC` al arrancar arregla la aplicación y deja fuera todo lo demás
 * —pruebas, scripts, tareas programadas—, que entran por otra puerta. Con
 * `timestamptz` el instante viaja con su zona y da igual dónde corra el
 * proceso, que es la única versión de esto que no hay que recordar.
 *
 * Lo guardado se reinterpreta como UTC, que es como se escribió.
 */
export class TimestampsWithZone1787770000000 implements MigrationInterface {
  name = 'TimestampsWithZone1787770000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE columna record;
      BEGIN
        FOR columna IN
          SELECT table_name, column_name
            FROM information_schema.columns
           WHERE table_schema = 'public'
             AND data_type = 'timestamp without time zone'
             AND table_name <> 'migrations'
        LOOP
          EXECUTE format(
            'ALTER TABLE %I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE ''UTC''',
            columna.table_name, columna.column_name, columna.column_name
          );
        END LOOP;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE columna record;
      BEGIN
        FOR columna IN
          SELECT table_name, column_name
            FROM information_schema.columns
           WHERE table_schema = 'public'
             AND data_type = 'timestamp with time zone'
        LOOP
          EXECUTE format(
            'ALTER TABLE %I ALTER COLUMN %I TYPE timestamp USING %I AT TIME ZONE ''UTC''',
            columna.table_name, columna.column_name, columna.column_name
          );
        END LOOP;
      END $$;
    `);
  }
}
