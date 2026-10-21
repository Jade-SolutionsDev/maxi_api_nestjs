import { getDataSourceToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';

/**
 * El grafo de módulos de Nest resuelve.
 *
 * **Por qué esto no existía y hacía falta.** Nest **no propaga los exports de
 * un módulo importado**: si un proveedor pide por el constructor algo que vive
 * en otro módulo, ese módulo tiene que estar en el `imports` del suyo, no en el
 * de un vecino. Cuando falta, la API no arranca —`UnknownDependenciesException`
 * al crear el contexto— y **ninguna prueba lo ve**, porque cada prueba unitaria
 * monta su proveedor a mano con los dobles que necesita. Ya pasó en
 * `MailModule`, al que le faltaba `CmsModule` aunque `OrderPdfModule` ya lo
 * importara: jest en verde, CI en verde, API caída.
 *
 * Esta prueba crea el contexto entero con la fuente de datos sustituida por un
 * doble, así que comprueba **el cableado** sin tocar Postgres. Se comprobó que
 * discrimina: quitándole `MailModule` a `TicketsModule` falla, y dice
 * exactamente qué proveedor se quedó sin resolver.
 *
 * **Lo que NO comprueba, para que nadie se confíe:**
 *
 * - Que las entidades y las migraciones estén bien. La fuente de datos es un
 *   doble; aquí no hay esquema ni consultas.
 * - Que `main.ts` arranque. Los tubos globales, el filtro, el prefijo y las
 *   comprobaciones de configuración viven ahí y esto no los ejecuta.
 * - Que un módulo sobre. Comprueba que no falte nada, no que todo haga falta.
 */
describe('AppModule', () => {
  const fuenteFalsa = () =>
    ({
      // Lo que la fábrica de repositorios de @nestjs/typeorm consulta para
      // decidir qué clase de repositorio devolver.
      entityMetadatas: [],
      options: { type: 'postgres' },
      getRepository: () => ({}),
      getTreeRepository: () => ({}),
      createQueryRunner: () => ({ release: () => undefined }),
      destroy: () => Promise.resolve(),
      isInitialized: true,
    }) as unknown as DataSource;

  it('crea el contexto completo sin que falte ninguna dependencia', async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDataSourceToken())
      .useValue(fuenteFalsa())
      .compile();

    expect(modulo).toBeDefined();
    await modulo.close();
  });
});
