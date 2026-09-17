import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmailLog, EmailStatus } from './entities/email-log.entity';
import { MailService } from './mail.service';

describe('MailService', () => {
  let service: MailService;
  let saved: Partial<EmailLog>[];
  let resend: { apiKey?: string; fromAddress?: string; configured: boolean };

  const build = async (): Promise<MailService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockImplementation(() => resend) },
        },
        {
          provide: getRepositoryToken(EmailLog),
          useValue: {
            create: jest
              .fn()
              .mockImplementation((row: Partial<EmailLog>) => row),
            save: jest.fn().mockImplementation((row: Partial<EmailLog>) => {
              saved.push(row);
              return Promise.resolve(row);
            }),
            count: jest.fn().mockResolvedValue(0),
          },
        },
      ],
    }).compile();
    return module.get(MailService);
  };

  const email = {
    to: 'cliente@ejemplo.com',
    subject: 'Pedido ORD-1',
    html: '<p>hola</p>',
    text: 'hola',
    template: 'payment_received',
    orderId: 'o1',
  };

  beforeEach(async () => {
    saved = [];
    resend = { configured: false };
    service = await build();
  });

  it('sin credenciales no inventa un envío: lo deja registrado como omitido', async () => {
    const result = await service.send(email);
    expect(result.status).toBe(EmailStatus.SKIPPED);
    expect(saved[0]).toMatchObject({
      template: 'payment_received',
      status: EmailStatus.SKIPPED,
      orderId: 'o1',
    });
  });

  it('configurado, manda a Resend y guarda el identificador', async () => {
    resend = {
      apiKey: 'k',
      fromAddress: 'Maxi <no-reply@x.cu>',
      configured: true,
    };
    service = await build();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'resend-123' }),
    });
    global.fetch = fetchMock;

    const result = await service.send(email);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.status).toBe(EmailStatus.SENT);
    expect(saved[0]).toMatchObject({
      status: EmailStatus.SENT,
      providerId: 'resend-123',
    });
  });

  it('un rechazo de Resend queda registrado con su motivo y no revienta', async () => {
    resend = {
      apiKey: 'k',
      fromAddress: 'Maxi <no-reply@x.cu>',
      configured: true,
    };
    service = await build();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ message: 'dominio sin verificar' }),
    });

    const result = await service.send(email);

    expect(result.status).toBe(EmailStatus.FAILED);
    expect(result.error).toBe('dominio sin verificar');
    expect(saved[0]).toMatchObject({ status: EmailStatus.FAILED });
  });
});
