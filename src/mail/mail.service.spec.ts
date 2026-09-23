import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmailLog, EmailStatus } from './entities/email-log.entity';
import { MailService } from './mail.service';

describe('MailService', () => {
  let service: MailService;
  let saved: Partial<EmailLog>[];
  let resend: {
    apiKey?: string;
    fromAddress?: string;
    replyTo?: string;
    configured: boolean;
  };

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
  // El remitente es una dirección del dominio, y el dominio no recibe correo:
  // escribirle a `pedidos@maxihabana.com` rebota con «User does not exist».
  // Sin Reply-To, cada cliente que contesta a su pedido escribe al vacío.
  it('manda las respuestas al buzón que el equipo lee', async () => {
    resend = {
      apiKey: 'k',
      fromAddress: 'Maxi <pedidos@maxihabana.com>',
      replyTo: 'comercialmaxihabana@gmail.com',
      configured: true,
    };
    service = await build();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'resend-124' }),
    });
    global.fetch = fetchMock;

    await service.send(email);

    const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(cuerpo.reply_to).toBe('comercialmaxihabana@gmail.com');
  });

  it('sin buzón de respuestas configurado, no manda el campo vacío', async () => {
    resend = {
      apiKey: 'k',
      fromAddress: 'Maxi <pedidos@maxihabana.com>',
      configured: true,
    };
    service = await build();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'resend-125' }),
    });
    global.fetch = fetchMock;

    await service.send(email);

    const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect('reply_to' in cuerpo).toBe(false);
  });
  // El comprobante del pedido existe desde hace semanas, pero vivía solo
  // detrás de un botón de la web. Esto es la pieza que permite mandárselo.
  it('manda los adjuntos en base64, como los quiere Resend', async () => {
    resend = {
      apiKey: 'k',
      fromAddress: 'Maxi <pedidos@maxihabana.com>',
      configured: true,
    };
    service = await build();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'resend-126' }),
    });
    global.fetch = fetchMock;

    await service.send({
      ...email,
      attachments: [
        { filename: 'ORD-20260001.pdf', content: Buffer.from('%PDF-1.4 x') },
      ],
    });

    const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(cuerpo.attachments).toEqual([
      {
        filename: 'ORD-20260001.pdf',
        content: Buffer.from('%PDF-1.4 x').toString('base64'),
      },
    ]);
  });

  it('sin adjuntos no manda el campo, para que no salga el clip vacío', async () => {
    resend = {
      apiKey: 'k',
      fromAddress: 'Maxi <pedidos@maxihabana.com>',
      configured: true,
    };
    service = await build();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'resend-127' }),
    });
    global.fetch = fetchMock;

    await service.send(email);

    const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect('attachments' in cuerpo).toBe(false);
  });
});
