import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentMethod } from './entities/payment-method.entity';
import { CustomManualGateway } from './gateways/custom-manual/custom-manual.gateway';
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
    softDelete: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((m: unknown) => Promise.resolve(m)),
      softDelete: jest.fn(),
      create: jest.fn().mockImplementation((m: unknown) => m),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentMethodsService,
        { provide: getRepositoryToken(PaymentMethod), useValue: repo },
        CustomManualGateway,
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

      expect((await service.resolve()).method.code).toBe('tropipay');
    });

    it('falls back to manual when every gateway is off', async () => {
      repo.find.mockResolvedValue([]);
      repo.findOne.mockResolvedValue(method('manual'));

      expect((await service.resolve()).method.code).toBe('manual');
    });

    /**
     * Un código sin clase registrada es un método que creó el admin, no un
     * error: cae en la pasarela manual personalizada. Así un cobro de un método
     * ya borrado se sigue mostrando en vez de reventar el pedido.
     */
    it('un código desconocido cae en la pasarela manual personalizada', () => {
      expect(service.gatewayFor('transfermovil').kind).toBe('manual');
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

    it('leaves fields the caller did not send alone', async () => {
      repo.findOne.mockResolvedValue(
        method('tropipay', { label: 'Tarjeta', icon: 'CreditCard' }),
      );

      const result = await service.update('id-tropipay', {
        enabled: true,
        label: undefined,
        icon: undefined,
      });

      expect(result.label).toBe('Tarjeta');
      expect(result.icon).toBe('CreditCard');
    });
  });

  describe('métodos que crea el admin', () => {
    const bank = {
      label: 'Banco Metropolitano',
      instructions: {
        type: 'bank' as const,
        bankName: 'Banco Metropolitano',
        accountNumber: '9227 0699 1234 5678',
      },
    };

    it('saca el código de la etiqueta y lo marca como personalizado', async () => {
      repo.findOne.mockResolvedValue(null);

      await service.create(bank);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'banco-metropolitano',
          isCustom: true,
          instructions: expect.objectContaining({ type: 'bank' }),
        }),
      );
    });

    // Si el código chocara, `gatewayFor` devolvería la clase registrada y las
    // instrucciones del admin no se mostrarían jamás.
    it('rechaza un nombre que choca con una pasarela integrada', async () => {
      await expect(
        service.create({ ...bank, label: 'Tropipay' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('desambigua el código cuando ya existe', async () => {
      repo.findOne
        .mockResolvedValueOnce(method('banco-metropolitano'))
        .mockResolvedValue(null);

      await service.create(bank);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'banco-metropolitano-2' }),
      );
    });

    it('exige la red en cripto: mandar por la equivocada pierde los fondos', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.create({
          label: 'USDT',
          instructions: { type: 'crypto', address: '0xabc' },
        }),
      ).rejects.toThrow(/red/i);
    });

    it('acepta cripto con red y guarda el memo', async () => {
      repo.findOne.mockResolvedValue(null);

      await service.create({
        label: 'USDT',
        instructions: {
          type: 'crypto',
          address: '0xabc',
          network: 'BEP20',
          memo: '12345',
        },
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          instructions: expect.objectContaining({
            network: 'BEP20',
            memo: '12345',
          }),
        }),
      );
    });

    it('exige cuenta o tarjeta en una transferencia', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.create({
          label: 'Banco X',
          instructions: { type: 'bank', bankName: 'Banco X' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('borra sólo lo que creó un admin', async () => {
      repo.findOne.mockResolvedValue(
        method('transfermovil', { isCustom: true }),
      );

      await service.remove('id-transfermovil');

      expect(repo.softDelete).toHaveBeenCalledWith('id-transfermovil');
    });

    it('se niega a borrar una pasarela integrada', async () => {
      repo.findOne.mockResolvedValue(method('tropipay'));

      await expect(service.remove('id-tropipay')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });
});
