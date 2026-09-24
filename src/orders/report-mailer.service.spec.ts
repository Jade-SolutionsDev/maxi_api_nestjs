import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailStatus } from '../mail/entities/email-log.entity';
import { MailService } from '../mail/mail.service';
import { ReportMailerService } from './report-mailer.service';

describe('ReportMailerService', () => {
  let service: ReportMailerService;
  let mail: { send: jest.Mock; configured: boolean };

  const datos = {
    criterios: 'Del 01/09/2026 al 24/09/2026 · Estado: Cancelado',
    pedidos: 47,
    importe: '12480.00',
    solicitante: 'José Falcón',
  };

  beforeEach(async () => {
    mail = {
      send: jest
        .fn()
        .mockResolvedValue({ status: EmailStatus.SENT, providerId: 'r1' }),
      configured: true,
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportMailerService,
        { provide: MailService, useValue: mail },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({ whatsapp: '+53 5251 9414' }),
          },
        },
      ],
    }).compile();
    service = module.get(ReportMailerService);
  });

  const pdf = Buffer.from('%PDF-1.4 contenido');

  it('manda el PDF adjunto a cada destinatario', async () => {
    const r = await service.enviar(
      ['ana@maxihabana.com', 'luis@maxihabana.com'],
      pdf,
      'pedidos-cancelado.pdf',
      datos,
    );

    expect(r.enviados).toEqual(['ana@maxihabana.com', 'luis@maxihabana.com']);
    expect(mail.send).toHaveBeenCalledTimes(2);
    const primero = mail.send.mock.calls[0][0] as {
      attachments: { filename: string; content: Buffer }[];
      template: string;
    };
    expect(primero.attachments[0].filename).toBe('pedidos-cancelado.pdf');
    expect(primero.attachments[0].content).toBe(pdf);
    expect(primero.template).toBe('orders_report');
  });

  // Uno a uno y no en copia oculta: si una dirección rebota, las demás tienen
  // que recibirlo igual, y en `email_log` queda una fila por persona.
  it('un destinatario que falla no deja sin reporte a los demás', async () => {
    mail.send
      .mockResolvedValueOnce({
        status: EmailStatus.FAILED,
        error: 'dirección inexistente',
      })
      .mockResolvedValueOnce({ status: EmailStatus.SENT, providerId: 'r2' });

    const r = await service.enviar(
      ['rota@ejemplo.com', 'buena@maxihabana.com'],
      pdf,
      'pedidos.pdf',
      datos,
    );

    expect(r.enviados).toEqual(['buena@maxihabana.com']);
    expect(r.fallidos).toEqual([
      { email: 'rota@ejemplo.com', motivo: 'dirección inexistente' },
    ]);
  });

  it('una excepción tampoco corta el reparto', async () => {
    mail.send
      .mockRejectedValueOnce(new Error('resend caído'))
      .mockResolvedValueOnce({ status: EmailStatus.SENT, providerId: 'r3' });

    const r = await service.enviar(
      ['una@ejemplo.com', 'otra@maxihabana.com'],
      pdf,
      'pedidos.pdf',
      datos,
    );

    expect(r.enviados).toEqual(['otra@maxihabana.com']);
    expect(r.fallidos[0].motivo).toBe('resend caído');
  });

  // El asunto adelanta las dos cifras: se responde a un «¿cómo vamos?» desde
  // la lista del móvil, sin abrir el adjunto.
  //
  // El importe sale sin separador de miles porque así lo formatea `money` en
  // todas las plantillas; cambiarlo afectaría a los diez correos y es decisión
  // aparte.
  it('el asunto lleva el número de pedidos y el importe', async () => {
    await service.enviar(['ana@maxihabana.com'], pdf, 'pedidos.pdf', datos);
    const { subject } = mail.send.mock.calls[0][0] as { subject: string };
    expect(subject).toContain('47');
    expect(subject).toContain('12480.00');
  });
});
