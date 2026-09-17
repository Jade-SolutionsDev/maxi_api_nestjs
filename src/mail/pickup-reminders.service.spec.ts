import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Order } from '../orders/entities/order.entity';
import { EmailLog, EmailStatus } from './entities/email-log.entity';
import { OrderMailerService } from './order-mailer.service';
import { PickupRemindersService } from './pickup-reminders.service';

describe('PickupRemindersService', () => {
  let service: PickupRemindersService;
  let candidates: Partial<Order>[];
  let andWhereCalls: string[];
  let mailer: { configured: boolean; pickupReminder: jest.Mock };

  const build = async (): Promise<PickupRemindersService> => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockImplementation(function (
        this: unknown,
        clause: string,
      ) {
        andWhereCalls.push(clause);
        return qb;
      }),
      getMany: jest.fn().mockImplementation(() => Promise.resolve(candidates)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PickupRemindersService,
        {
          provide: getRepositoryToken(Order),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(qb),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(EmailLog),
          useValue: { count: jest.fn() },
        },
        { provide: OrderMailerService, useValue: mailer },
      ],
    }).compile();
    return module.get(PickupRemindersService);
  };

  beforeEach(() => {
    andWhereCalls = [];
    candidates = [];
    mailer = {
      configured: true,
      pickupReminder: jest.fn().mockResolvedValue({
        status: EmailStatus.SENT,
        providerId: 'x',
        error: null,
      }),
    };
  });

  it('sin correo configurado no manda ni consulta', async () => {
    mailer.configured = false;
    service = await build();
    const result = await service.sweep();
    expect(mailer.pickupReminder).not.toHaveBeenCalled();
    expect(result.sent).toEqual({});
  });

  it('avisa a cada pedido que cumple el hito y lo cuenta', async () => {
    candidates = [{ id: 'o1' }, { id: 'o2' }];
    service = await build();
    const result = await service.sweep();
    // Dos hitos (15 y 25) por dos pedidos.
    expect(mailer.pickupReminder).toHaveBeenCalledTimes(4);
    expect(mailer.pickupReminder).toHaveBeenCalledWith('o1', 15);
    expect(mailer.pickupReminder).toHaveBeenCalledWith('o2', 25);
    expect(result.sent).toEqual({
      pickup_reminder_15: 2,
      pickup_reminder_25: 2,
    });
  });

  it('no repite un recordatorio ya enviado ni avisa pasada la custodia', async () => {
    service = await build();
    await service.sweep();
    const clauses = andWhereCalls.join(' ');
    expect(clauses).toContain('NOT EXISTS');
    expect(clauses).toContain('log.status = :sent');
    expect(clauses).toContain('order.paid_at > :custodyFloor');
    expect(clauses).toContain('order.delivered_at IS NULL');
  });

  it('un correo que no sale cuenta como omitido, no como enviado', async () => {
    candidates = [{ id: 'o1' }];
    mailer.pickupReminder = jest.fn().mockResolvedValue({
      status: EmailStatus.FAILED,
      providerId: null,
      error: 'sin dominio',
    });
    service = await build();
    const result = await service.sweep();
    expect(result.sent.pickup_reminder_15).toBe(0);
    expect(result.skipped).toBe(2);
  });
});
