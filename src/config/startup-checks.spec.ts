import { comprobarConfiguracion } from './startup-checks';

/**
 * Lo que se protege aquí no es la configuración: es el despliegue. Un olvido
 * en el panel de variables tiene que doler al arrancar y no cuando un cliente
 * intenta pagar.
 */
describe('comprobación de configuración al arrancar', () => {
  const original = { ...process.env };

  const configuracionCompleta = () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://x';
    process.env.CLERK_SECRET_KEY = 'sk';
    process.env.CLERK_BACKOFFICE_SECRET_KEY = 'sk';
    process.env.CLERK_WEBHOOK_SECRET = 'whsec';
    process.env.CLERK_BACKOFFICE_WEBHOOK_SECRET = 'whsec';
    process.env.CRON_SECRET = 'cron';
    process.env.STOREFRONT_REVALIDATE_SECRET = 'rev';
  };

  afterEach(() => {
    process.env = { ...original };
  });

  it('no dice nada cuando está todo puesto', () => {
    configuracionCompleta();
    expect(() => comprobarConfiguracion()).not.toThrow();
  });

  it('se niega a arrancar si falta algo imprescindible, y dice cuál y por qué', () => {
    configuracionCompleta();
    delete process.env.CLERK_SECRET_KEY;

    expect(() => comprobarConfiguracion()).toThrow(/CLERK_SECRET_KEY/);
    expect(() => comprobarConfiguracion()).toThrow(/respaldo de desarrollo/);
  });

  it('las nombra todas de una vez, no de una en una', () => {
    configuracionCompleta();
    delete process.env.CRON_SECRET;
    delete process.env.DATABASE_URL;

    try {
      comprobarConfiguracion();
      throw new Error('debería haber fallado');
    } catch (error) {
      const mensaje = (error as Error).message;
      expect(mensaje).toContain('CRON_SECRET');
      expect(mensaje).toContain('DATABASE_URL');
      expect(mensaje).toContain('Faltan 2 variables');
    }
  });

  it('una sola ausencia se cuenta en singular', () => {
    configuracionCompleta();
    delete process.env.CRON_SECRET;
    expect(() => comprobarConfiguracion()).toThrow(/Falta 1 variable imprescindible/);
  });

  it('en local no comprueba nada: ahí se trabaja a medio configurar', () => {
    process.env.NODE_ENV = 'development';
    for (const clave of Object.keys(process.env)) {
      if (clave.startsWith('CLERK_') || clave === 'DATABASE_URL') {
        delete process.env[clave];
      }
    }
    expect(() => comprobarConfiguracion()).not.toThrow();
  });

  it('lo que solo apaga una función no impide arrancar', () => {
    configuracionCompleta();
    delete process.env.RESEND_API_KEY;
    expect(() => comprobarConfiguracion()).not.toThrow();
  });
});
