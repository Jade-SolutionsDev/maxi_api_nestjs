import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MailService } from '../mail/mail.service';
import { NomenclatorsService } from '../nomenclators/nomenclators.service';
import { User } from '../users/entities/user.entity';
import resendConfigDefault from '../config/configuration';
import { Ticket, TicketPriority, TicketStatus } from './entities/ticket.entity';
import { ticketAsignado } from './ticket-mail';
import {
  PLANTILLA_TICKET_ASIGNADO,
  TicketMailerService,
} from './ticket-mailer.service';

const ticket = (): Ticket => ({
  id: 't1',
  title: 'La impresora de etiquetas no imprime',
  description: 'Enciende pero saca las etiquetas en blanco.',
  categoryId: 'cat1',
  priority: TicketPriority.ALTA,
  status: TicketStatus.ABIERTO,
  assignedUserId: 'u2',
  createdByUserId: 'u1',
  images: [],
  resolution: null,
  resolvedAt: null,
  closedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
});

describe('TicketMailerService', () => {
  let service: TicketMailerService;
  let mail: { send: jest.Mock };
  let userRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    mail = { send: jest.fn().mockResolvedValue({ status: 'sent' }) };
    userRepo = {
      findOne: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === 'u2'
              ? {
                  id: 'u2',
                  email: 'pedrito@maxihabana.com',
                  firstName: 'Pedrito',
                }
              : { id: 'u1', email: 'jade@maxihabana.com', firstName: 'Jade' },
          ),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketMailerService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        { provide: MailService, useValue: mail },
        {
          provide: NomenclatorsService,
          useValue: {
            labelsFor: jest
              .fn()
              .mockResolvedValue(new Map([['cat1', 'Equipos y dispositivos']])),
          },
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get(TicketMailerService);
  });

  it('manda el aviso al asignado con su clave de plantilla', async () => {
    await service.avisarAsignado(ticket());

    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(mail.send.mock.calls[0][0]).toMatchObject({
      to: 'pedrito@maxihabana.com',
      template: PLANTILLA_TICKET_ASIGNADO,
    });
  });

  it('sin asignado no manda nada', async () => {
    await service.avisarAsignado({ ...ticket(), assignedUserId: null });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('si el asignado no tiene correo, se calla y no revienta', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u2', email: null });
    await expect(service.avisarAsignado(ticket())).resolves.toBeNull();
    expect(mail.send).not.toHaveBeenCalled();
  });

  /**
   * Asignar ya ocurrió cuando esto se llama: si el correo falla, el ticket
   * sigue asignado. Perder un aviso es malo, no poder asignar sería peor.
   */
  it('si el envío falla, devuelve null en vez de propagar', async () => {
    mail.send.mockRejectedValue(new Error('Resend caído'));
    await expect(service.avisarAsignado(ticket())).resolves.toBeNull();
  });
});

describe('la plantilla del aviso', () => {
  const datos = {
    title: 'La impresora no imprime',
    description: 'Enciende pero saca las etiquetas en blanco.',
    categoryLabel: 'Equipos y dispositivos',
    priority: TicketPriority.ALTA,
    openedBy: 'Jade',
    assignedName: 'Pedrito',
    ticketId: 't1',
  };

  it('lleva el título, la prioridad y quién lo abrió', () => {
    const { html, text, subject } = ticketAsignado(datos);
    expect(subject).toContain('La impresora no imprime');
    for (const salida of [html, text]) {
      expect(salida).toContain('Alta');
      expect(salida).toContain('Equipos y dispositivos');
      expect(salida).toContain('Jade');
    }
  });

  it('sin la dirección del panel sale sin botón, no con un enlace roto', () => {
    const { html, text } = ticketAsignado({ ...datos, adminUrl: null });
    expect(html).not.toContain('Abrir el ticket');
    expect(text).not.toContain('undefined');
  });

  it('con la dirección del panel, el enlace apunta al ticket', () => {
    const { html } = ticketAsignado({
      ...datos,
      adminUrl: 'https://admin.maxihabana.com/',
    });
    // La barra de más del final no se duplica.
    expect(html).toContain('https://admin.maxihabana.com/tickets/t1');
  });

  it('no deja pasar etiquetas en el título ni en la descripción', () => {
    const { html } = ticketAsignado({
      ...datos,
      title: '<script>alert(1)</script>',
      description: 'rompe <b>esto</b>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('rompe <b>esto</b>');
  });

  it('recorta una descripción larguísima', () => {
    const { text } = ticketAsignado({ ...datos, description: 'x'.repeat(900) });
    expect(text).toContain('…');
    expect(text.length).toBeLessThan(900);
  });
});

describe('el cupo de correo', () => {
  /**
   * Un aviso interno no puede competir por el cupo con el correo de quien
   * acaba de pagar, así que nace declarado como prescindible.
   */
  it('la plantilla es prescindible por omisión', () => {
    const anterior = process.env.MAIL_TEMPLATES_LOW_PRIORITY;
    delete process.env.MAIL_TEMPLATES_LOW_PRIORITY;
    try {
      expect(resendConfigDefault().resend.plantillasPrescindibles).toContain(
        PLANTILLA_TICKET_ASIGNADO,
      );
    } finally {
      if (anterior !== undefined)
        process.env.MAIL_TEMPLATES_LOW_PRIORITY = anterior;
    }
  });
});
