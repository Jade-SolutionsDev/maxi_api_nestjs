import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MemoryWatchService } from './memory-watch.service';

const MB = 1024 * 1024;

describe('MemoryWatchService', () => {
  let service: MemoryWatchService;
  let intervalo: number;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  const conMontonDe = (usadoMb: number, limiteMb = 4096) => {
    jest.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed: usadoMb * MB,
      heapTotal: usadoMb * MB,
      rss: (usadoMb + 200) * MB,
      external: 10 * MB,
      arrayBuffers: 1 * MB,
    });
    jest
      .spyOn(jest.requireActual('node:v8'), 'getHeapStatistics')
      .mockReturnValue({ heap_size_limit: limiteMb * MB });
  };

  const montar = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryWatchService,
        {
          provide: ConfigService,
          useValue: { get: () => intervalo },
        },
      ],
    }).compile();
    service = module.get(MemoryWatchService);
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    intervalo = 60_000;
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    await montar();
    // Nest deja su propia línea al instanciar el proveedor; lo que se mide
    // aquí es lo que escribe el servicio, no el arranque del módulo.
    log.mockClear();
  });

  afterEach(() => {
    service.onApplicationShutdown();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('mide al arrancar, para que la curva empiece en un suelo conocido', () => {
    service.onModuleInit();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/heap_usado_mb=\d+/);
    expect(log.mock.calls[0][0]).toMatch(/uso_pct=\d+/);
  });

  it('sigue midiendo cada intervalo', () => {
    service.onModuleInit();
    jest.advanceTimersByTime(180_000);

    expect(log).toHaveBeenCalledTimes(4);
  });

  it('con el intervalo en 0 no mide nada', () => {
    intervalo = 0;
    service.onModuleInit();
    jest.advanceTimersByTime(600_000);

    expect(log).not.toHaveBeenCalled();
  });

  it('deja de medir cuando la aplicación se apaga', () => {
    service.onModuleInit();
    service.onApplicationShutdown();
    jest.advanceTimersByTime(600_000);

    expect(log).toHaveBeenCalledTimes(1);
  });

  it('avisa a partir del 75% del techo', () => {
    conMontonDe(3200);
    service.medir();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('estado=alto'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('uso_pct=78'));
  });

  it('a partir del 90% es un error: lo siguiente es la muerte del proceso', () => {
    conMontonDe(3800);
    service.medir();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('estado=critico'),
    );
  });

  it('mide contra el techo real del proceso, no contra una constante', () => {
    conMontonDe(1024, 2048);
    const muestra = service.medir();

    expect(muestra.heapLimiteMb).toBe(2048);
    expect(muestra.usoPct).toBe(50);
  });
});
