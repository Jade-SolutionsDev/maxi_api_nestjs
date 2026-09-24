import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailStatus } from '../mail/entities/email-log.entity';
import { MailService } from '../mail/mail.service';
import { ContactMailService } from './contact-mail.service';

const TIENDA = 'https://www.maxihabana.com';

describe('ContactMailService', () => {
  let service: ContactMailService;
  let mail: { send: jest.Mock; configured: boolean };

  beforeEach(async () => {
    mail = {
      send: jest.fn().mockResolvedValue({ status: EmailStatus.SENT }),
      configured: true,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactMailService,
        { provide: MailService, useValue: mail },
        {
          provide: ConfigService,
          useValue: {
            get: (clave: string) =>
              clave === 'storefront'
                ? { url: TIENDA }
                : { whatsapp: '+53 5251 9414' },
          },
        },
      ],
    }).compile();

    service = module.get(ContactMailService);
  });

  const enviado = () => mail.send.mock.calls[0][0];

  /**
   * Era el único correo del sistema armado a mano, fuera del layout: salía sin
   * cabecera, sin marca y sin enlaces legales. Y fue el primero que se envió de
   * verdad cuando se montó el correo.
   */
  it('sale con la marca y los enlaces legales, como los demás', async () => {
    await service.sendReply('cliente@ejemplo.com', 'Re: duda', 'Hola, mira…');

    const { html } = enviado();
    expect(html).toContain('maxi');
    expect(html).toContain('politica-de-privacidad');
    expect(html).toContain('terminos-y-condiciones');
  });

  it('dice por qué le llega, que es lo que miran los filtros', async () => {
    await service.sendReply('cliente@ejemplo.com', 'Re: duda', 'Hola');

    expect(enviado().html).toContain('nos escribiste');
  });

  it('respeta el asunto que escribió soporte, no se lo inventa', async () => {
    await service.sendReply('cliente@ejemplo.com', 'Re: mi pedido', 'Hola');

    expect(enviado().subject).toBe('Re: mi pedido');
  });

  it('escapa lo que teclea soporte: el panel no puede inyectar HTML', async () => {
    await service.sendReply(
      'cliente@ejemplo.com',
      'Re: duda',
      '<script>alert(1)</script>',
    );

    const { html } = enviado();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('conserva los saltos de línea de quien responde', async () => {
    await service.sendReply(
      'cliente@ejemplo.com',
      'Re: duda',
      'Primera línea\nSegunda línea',
    );

    const { html, text } = enviado();
    expect(html).toContain('white-space:pre-wrap');
    expect(text).toContain('Primera línea');
    expect(text).toContain('Segunda línea');
  });

  it('sin correo configurado no deja dar por respondido el mensaje', async () => {
    mail.configured = false;

    await expect(
      service.sendReply('cliente@ejemplo.com', 'Re: duda', 'Hola'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('un envío que no sale tampoco cuenta como respondido', async () => {
    mail.send.mockResolvedValue({
      status: EmailStatus.FAILED,
      error: 'dominio sin verificar',
    });

    await expect(
      service.sendReply('cliente@ejemplo.com', 'Re: duda', 'Hola'),
    ).rejects.toThrow(/dominio sin verificar/);
  });
});
