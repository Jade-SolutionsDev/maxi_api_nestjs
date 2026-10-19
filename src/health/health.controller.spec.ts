import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { MemoryWatchService } from './memory-watch.service';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: MemoryWatchService,
          useValue: { medir: jest.fn().mockReturnValue({ usoPct: 12 }) },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('getHealth', () => {
    it('should return status ok and a timestamp', () => {
      const result = controller.getHealth();

      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });

  describe('getMemory', () => {
    it('devuelve la muestra del momento, no una guardada', () => {
      expect(controller.getMemory()).toEqual({ usoPct: 12 });
    });
  });

  describe('getReady', () => {
    it('should return status ready and a timestamp', () => {
      const result = controller.getReady();

      expect(result.status).toBe('ready');
      expect(result.timestamp).toBeDefined();
    });
  });
});
