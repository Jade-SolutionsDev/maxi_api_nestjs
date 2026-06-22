import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
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

  describe('getReady', () => {
    it('should return status ready and a timestamp', () => {
      const result = controller.getReady();

      expect(result.status).toBe('ready');
      expect(result.timestamp).toBeDefined();
    });
  });
});
