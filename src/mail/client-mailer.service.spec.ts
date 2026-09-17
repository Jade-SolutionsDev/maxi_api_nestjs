import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '../clients/entities/client.entity';
import { ClientMailerService } from './client-mailer.service';
import { EmailStatus } from './entities/email-log.entity';
import { MailService } from './mail.service';

describe('ClientMailerService', () => {
  let service: ClientMailerService;
  let mail: { send: jest.Mock; alreadySentTo: jest.Mock };

  const cliente = (extra: Partial<Client> = {}): Client =>
    ({
      id: 'cli-1',
      email: 'marisol@example.com',
      firstName: 'Marisol',
      lastName: 'Pérez',
      ...extra,
    }) as Client;

  beforeEach(async () => {
    mail = {
      send: jest.fn().mockResolvedValue({
        status: EmailStatus.SENT,
        providerId: 'x',
        error: null,
      }),
      alreadySentTo: jest.fn().mockResolvedValue(false),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientMailerService,
        { provide: MailService, useValue: mail },
        {
          provide: ConfigService,
          useValue: {
            get: jest
              .fn()
              .mockImplementation((key: string) =>
                key === 'storefront'
                  ? { url: 'https://staging.maxihabana.com' }
                  : { whatsapp: '+53 5251 9414' },
              ),
          },
        },
      ],
    }).compile();
    service = module.get(ClientMailerService);
  });

  it('manda la bienvenida con el nombre del cliente', async () => {
    await service.welcome(cliente());

    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'marisol@example.com',
        template: 'welcome',
        subject: expect.stringContaining('Marisol'),
      }),
    );
  });

  it('usa la tienda configurada para los enlaces del pie', async () => {
    await service.welcome(cliente());

    const enviado = mail.send.mock.calls[0][0] as { html: string };
    expect(enviado.html).toContain('https://staging.maxihabana.com/contacto');
  });

  it('no la manda dos veces a la misma dirección', async () => {
    mail.alreadySentTo.mockResolvedValue(true);

    const resultado = await service.welcome(cliente());

    expect(resultado).toBeNull();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('un cliente sin correo no rompe nada', async () => {
    const resultado = await service.welcome(cliente({ email: null }));

    expect(resultado).toBeNull();
    expect(mail.send).not.toHaveBeenCalled();
  });
});
