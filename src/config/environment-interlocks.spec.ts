import { isLocalEnv } from './configuration';

/**
 * Tres interruptores peligrosos, una sola regla.
 *
 * `MOCK_AUTH_ENABLED`, `ALLOW_UNVERIFIED_WEBHOOKS` y `THROTTLE_DISABLED`
 * apagan defensas para poder trabajar en local. Los tres dependen de
 * `isLocalEnv()`, de modo que un `.env` copiado a un entorno desplegado —el
 * error más fácil de cometer con prisa— no baste para abrir nada.
 *
 * Esta prueba vigila la pieza común: el día que `isLocalEnv` acepte un entorno
 * desplegado, caen los tres a la vez y aquí se ve.
 */
describe('interlocks de entorno', () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it('reconoce local y pruebas', () => {
    for (const env of ['development', 'test']) {
      process.env.NODE_ENV = env;
      expect(isLocalEnv()).toBe(true);
    }
  });

  it('nunca reconoce un entorno desplegado', () => {
    for (const env of ['staging', 'production', 'preview', 'qa']) {
      process.env.NODE_ENV = env;
      expect(isLocalEnv()).toBe(false);
    }
  });

  it('sin NODE_ENV asume desarrollo, que es donde se trabaja sin configurar nada', () => {
    delete process.env.NODE_ENV;
    expect(isLocalEnv()).toBe(true);
  });
});
