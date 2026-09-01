import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AUTH_PROVIDER } from './interfaces/auth-provider.interface';
import { ClerkAuthProvider } from './providers/clerk-auth.provider';
import { MockAuthProvider } from './providers/mock-auth.provider';

/**
 * Quién autentica no puede depender solo de una variable de entorno.
 *
 * `MockAuthProvider` acepta `mock:<clerkId>` y lo devuelve como usuario válido
 * sin verificar nada. Esta prueba fija la última pieza de la cadena que cierra
 * `MxH-0094`: cuando la configuración dice que la simulación está apagada
 * —y en un entorno desplegado siempre lo está, aunque la variable esté puesta—
 * el proveedor que queda montado es el real.
 */
describe('selección del proveedor de autenticación', () => {
  const construir = async (mockEnabled: boolean) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: ClerkAuthProvider, useValue: { nombre: 'clerk' } },
        { provide: MockAuthProvider, useValue: { nombre: 'mock' } },
        {
          provide: ConfigService,
          useValue: { get: (clave: string) => (clave === 'auth.mockEnabled' ? mockEnabled : undefined) },
        },
        {
          provide: AUTH_PROVIDER,
          inject: [ConfigService, MockAuthProvider, ClerkAuthProvider],
          useFactory: (
            configService: ConfigService,
            mock: MockAuthProvider,
            clerk: ClerkAuthProvider,
          ) => (configService.get<boolean>('auth.mockEnabled') ? mock : clerk),
        },
      ],
    }).compile();

    return moduleRef.get(AUTH_PROVIDER);
  };

  it('monta el proveedor real cuando la simulación está apagada', async () => {
    expect(await construir(false)).toEqual({ nombre: 'clerk' });
  });

  it('solo monta el simulado cuando la configuración lo permite', async () => {
    expect(await construir(true)).toEqual({ nombre: 'mock' });
  });
});
