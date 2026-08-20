import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentMethod } from './entities/payment-method.entity';
import { PAYMENT_GATEWAYS, PaymentGateway } from './payment-gateway.interface';
import { PaymentMethodsService } from './payment-methods.service';

const stubGateway = (code: string, configured: boolean): PaymentGateway =>
  ({ code, kind: 'redirect', configured }) as PaymentGateway;

const method = (code: string, overrides: Partial<PaymentMethod> = {}) => ({
  id: `id-${code}`,
  code,
  label: code,
  description: null,
  icon: null,
  sortOrder: 0,
  enabled: true,
  config: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('PaymentMethodsService', () => {
  let service: PaymentMethodsService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((m: unknown) => Promise.resolve(m)),
      create: jest.fn().mockImplementation((m: unknown) => m),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentMethodsService,
        { provide: getRepositoryToken(PaymentMethod), useValue: repo },
        {
          provide: PAYMENT_GATEWAYS,
          useValue: [
            stubGateway('tropipay', true),
            stubGateway('mibilletera', false),
            stubGateway('manual', true),
          ],
        },
      ],
    }).compile();

    service = module.get(PaymentMethodsService);
  });

  describe('onModuleInit', () => {
    it('registers a row per gateway, enabling only the manual fallback', async () => {
      await service.onModuleInit();

      expect(repo.save).toHaveBeenCalledTimes(3);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'tropipay', enabled: false }),
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'manual', enabled: true }),
      );
    });

    it('never touches a row the admin already owns', async () => {
      repo.findOne.mockResolvedValue(method('tropipay'));

      await service.onModuleInit();

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('findAvailable', () => {
    it('hides enabled methods whose credentials are missing', async () => {
      repo.find.mockResolvedValue([method('tropipay'), method('mibilletera')]);

      const available = await service.findAvailable();

      expect(available.map((m) => m.code)).toEqual(['tropipay']);
    });
  });

  describe('resolve', () => {
    it('rejects a method that is not available', async () => {
      repo.find.mockResolvedValue([method('tropipay')]);

      await expect(service.resolve('mibilletera')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('falls back to the first available method when none is requested', async () => {
      repo.find.mockResolvedValue([method('tropipay'), method('manual')]);

      expect((await service.resolve()).code).toBe('tropipay');
    });

    it('falls back to manual when every gateway is off', async () => {
      repo.find.mockResolvedValue([]);

      expect((await service.resolve()).code).toBe('manual');
    });

    it('404s on an unknown gateway code', () => {
      expect(() => service.gatewayFor('paypal')).toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('refuses to enable a method with no credentials in this environment', async () => {
      repo.findOne.mockResolvedValue(method('mibilletera', { enabled: false }));

      await expect(
        service.update('id-mibilletera', { enabled: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows disabling an unconfigured method', async () => {
      repo.findOne.mockResolvedValue(method('mibilletera'));

      const result = await service.update('id-mibilletera', { enabled: false });

      expect(result.enabled).toBe(false);
      expect(result.configured).toBe(false);
    });
  });
});
