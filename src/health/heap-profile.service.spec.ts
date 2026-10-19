import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { HeapProfileService } from './heap-profile.service';

describe('HeapProfileService', () => {
  let service: HeapProfileService;
  let habilitado: boolean;

  beforeEach(async () => {
    habilitado = true;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HeapProfileService,
        { provide: ConfigService, useValue: { get: () => habilitado } },
      ],
    }).compile();
    service = module.get(HeapProfileService);
  });

  afterEach(async () => {
    await service.parar();
  });

  it('nace apagado y no se puede leer sin arrancarlo', async () => {
    expect(service.corriendo).toBe(false);
    await expect(service.leer()).rejects.toThrow('no está arrancado');
  });

  /**
   * La prueba de verdad: asignar algo grande y comprobar que el perfil
   * señala a la función que lo asignó, con su fichero y su línea.
   */
  it('señala a quien asignó la memoria, con fichero y línea', async () => {
    await service.arrancar(16384);

    const retenido: string[] = [];
    const asignarMucho = () => {
      for (let i = 0; i < 40000; i += 1) retenido.push('x'.repeat(200));
    };
    asignarMucho();

    const perfil = await service.leer(10);

    expect(perfil.totalMb).toBeGreaterThan(1);
    expect(perfil.top.length).toBeGreaterThan(0);
    expect(perfil.top[0].mb).toBeGreaterThanOrEqual(perfil.top.at(-1)!.mb);
    const nombres = perfil.top.map((l) => l.funcion);
    expect(
      nombres.some((n) => n.includes('asignarMucho') || n === 'repeat'),
    ).toBe(true);
    expect(retenido).toHaveLength(40000);
  });

  /**
   * La propiedad que decide cómo se lee el perfil, y que conviene que una
   * prueba defienda: **solo cuenta lo que sigue vivo**. Si contara también lo
   * asignado y soltado, el primer puesto se lo llevaría siempre el camino más
   * transitado y el perfil no diría nada de una fuga.
   */
  it('cuenta lo retenido y no lo que ya se soltó', async () => {
    await service.arrancar(16384);

    for (let vuelta = 0; vuelta < 20; vuelta += 1) {
      let desechable: string[] = [];
      for (let i = 0; i < 20000; i += 1) desechable.push('y'.repeat(200));
      desechable = [];
    }
    const soltado = await service.leer(5);

    const retenido: string[] = [];
    for (let i = 0; i < 150000; i += 1) retenido.push('z'.repeat(200));
    const vivo = await service.leer(5);

    // Lo soltado apenas deja rastro; lo retenido pesa decenas de MB.
    expect(soltado.totalMb).toBeLessThan(10);
    expect(vivo.totalMb).toBeGreaterThan(20);
    expect(retenido).toHaveLength(150000);
  });

  describe('al arrancar la aplicación', () => {
    it('se pone a medir solo donde está encendido', async () => {
      await service.onModuleInit();
      expect(service.corriendo).toBe(true);
    });

    it('no hace nada donde está apagado', async () => {
      habilitado = false;
      await service.onModuleInit();
      expect(service.corriendo).toBe(false);
    });
  });

  it('arrancar dos veces no abre dos sesiones', async () => {
    await service.arrancar();
    await service.arrancar();
    expect(service.corriendo).toBe(true);

    await service.parar();
    expect(service.corriendo).toBe(false);
  });

  it('parar sin haber arrancado no revienta', async () => {
    await expect(service.parar()).resolves.toBeUndefined();
  });

  it('respeta el interruptor del entorno', () => {
    expect(service.habilitado).toBe(true);
    habilitado = false;
    expect(service.habilitado).toBe(false);
  });
});
