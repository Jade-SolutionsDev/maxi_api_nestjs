import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NomenclatorsService } from '../nomenclators/nomenclators.service';
import { User } from '../users/entities/user.entity';
import { TicketEvent, TicketEventKind } from './entities/ticket-event.entity';
import { Ticket, TicketPriority, TicketStatus } from './entities/ticket.entity';
import { TicketMailerService } from './ticket-mailer.service';
import { TicketsService } from './tickets.service';

describe('TicketsService', () => {
  let service: TicketsService;
  let ticket: Ticket;
  let eventos: TicketEvent[];

  let ticketRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let eventRepo: { find: jest.Mock; create: jest.Mock; save: jest.Mock };
  let userRepo: { exists: jest.Mock; find: jest.Mock };
  let nomencladores: { findActiveOption: jest.Mock; labelsFor: jest.Mock };
  let mailer: { avisarAsignado: jest.Mock };

  beforeEach(async () => {
    ticket = {
      id: 't1',
      title: 'La impresora de etiquetas no imprime',
      description: 'Enciende pero saca las etiquetas en blanco.',
      categoryId: 'cat1',
      priority: TicketPriority.MEDIA,
      status: TicketStatus.ABIERTO,
      assignedUserId: null,
      createdByUserId: 'u1',
      images: [],
      resolution: null,
      resolvedAt: null,
      closedAt: null,
      createdAt: new Date('2026-10-21T10:00:00Z'),
      updatedAt: new Date('2026-10-21T10:00:00Z'),
      deletedAt: null,
    };
    eventos = [];

    ticketRepo = {
      findOne: jest.fn().mockImplementation(() => Promise.resolve(ticket)),
      create: jest.fn((datos: Partial<Ticket>) => ({ ...ticket, ...datos })),
      save: jest.fn((entidad: Ticket) => {
        ticket = { ...ticket, ...entidad };
        return Promise.resolve(ticket);
      }),
      createQueryBuilder: jest.fn(),
    };
    eventRepo = {
      find: jest.fn().mockImplementation(() => Promise.resolve(eventos)),
      create: jest.fn((datos: Partial<TicketEvent>) => datos),
      save: jest.fn((evento: TicketEvent) => {
        eventos.push({ ...evento, createdAt: new Date() });
        return Promise.resolve(evento);
      }),
    };
    userRepo = {
      exists: jest.fn().mockResolvedValue(true),
      find: jest.fn().mockResolvedValue([]),
    };
    nomencladores = {
      findActiveOption: jest.fn().mockResolvedValue({ id: 'cat1' }),
      labelsFor: jest
        .fn()
        .mockResolvedValue(new Map([['cat1', 'Equipos y dispositivos']])),
    };
    mailer = { avisarAsignado: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: getRepositoryToken(Ticket), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketEvent), useValue: eventRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: NomenclatorsService, useValue: nomencladores },
        { provide: TicketMailerService, useValue: mailer },
      ],
    }).compile();

    service = module.get(TicketsService);
  });

  const dtoNuevo = {
    title: 'La impresora de etiquetas no imprime',
    description: 'Enciende pero saca las etiquetas en blanco.',
    categoryId: 'cat1',
  };

  describe('abrir', () => {
    it('nace abierto, con prioridad media y anotando quién lo abrió', async () => {
      const creado = await service.create(dtoNuevo, 'u1');

      expect(creado.status).toBe(TicketStatus.ABIERTO);
      expect(creado.priority).toBe(TicketPriority.MEDIA);
      expect(eventos).toHaveLength(1);
      expect(eventos[0]).toMatchObject({
        kind: TicketEventKind.ABIERTO,
        userId: 'u1',
      });
    });

    // Sin categorías tipificadas no se pueden agrupar, que es para lo que
    // existe el nomenclador.
    it('una categoría que no existe no vale', async () => {
      nomencladores.findActiveOption.mockResolvedValue(null);
      await expect(service.create(dtoNuevo, 'u1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('si nace asignado, avisa al asignado y lo anota', async () => {
      await service.create({ ...dtoNuevo, assignedUserId: 'u2' }, 'u1');

      expect(mailer.avisarAsignado).toHaveBeenCalledTimes(1);
      expect(eventos.map((e) => e.kind)).toEqual([
        TicketEventKind.ABIERTO,
        TicketEventKind.ASIGNADO,
      ]);
    });

    it('si nace sin asignar, no manda ningún correo', async () => {
      await service.create(dtoNuevo, 'u1');
      expect(mailer.avisarAsignado).not.toHaveBeenCalled();
    });
  });

  describe('asignar', () => {
    it('avisa al nuevo asignado', async () => {
      await service.update('t1', { assignedUserId: 'u2' }, 'u1');
      expect(mailer.avisarAsignado).toHaveBeenCalledTimes(1);
    });

    it('quitar la asignación no manda correo a nadie', async () => {
      ticket.assignedUserId = 'u2';
      await service.update('t1', { assignedUserId: '' }, 'u1');

      expect(ticket.assignedUserId).toBeNull();
      expect(mailer.avisarAsignado).not.toHaveBeenCalled();
    });

    it('asignar a quien no existe no vale', async () => {
      userRepo.exists.mockResolvedValue(false);
      await expect(
        service.update('t1', { assignedUserId: 'fantasma' }, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('estados', () => {
    it('abierto pasa a en curso', async () => {
      await service.changeStatus(
        't1',
        { status: TicketStatus.EN_CURSO },
        'u1',
        false,
      );
      expect(ticket.status).toBe(TicketStatus.EN_CURSO);
    });

    it('al mismo estado no, que no es un cambio', async () => {
      await expect(
        service.changeStatus(
          't1',
          { status: TicketStatus.ABIERTO },
          'u1',
          false,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('de abierto no se salta a cerrado: alguien tiene que resolverlo', async () => {
      await expect(
        service.changeStatus(
          't1',
          { status: TicketStatus.CERRADO },
          'u1',
          true,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('resolver exige decir qué se hizo', async () => {
      await expect(
        service.changeStatus(
          't1',
          { status: TicketStatus.RESUELTO },
          'u1',
          false,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // El permiso de cierre NO hace falta para resolver: lo pone quien arregló,
    // y el sentido de los cuatro estados es que su palabra no sea la última.
    it('resolver no pide el permiso de cerrar', async () => {
      const r = await service.changeStatus(
        't1',
        { status: TicketStatus.RESUELTO, note: 'Era el cabezal, lo limpié' },
        'u2',
        false,
      );

      expect(r.status).toBe(TicketStatus.RESUELTO);
      expect(ticket.resolution).toBe('Era el cabezal, lo limpié');
      expect(ticket.resolvedAt).toBeInstanceOf(Date);
    });

    it('cerrar sí lo pide', async () => {
      ticket.status = TicketStatus.RESUELTO;
      await expect(
        service.changeStatus(
          't1',
          { status: TicketStatus.CERRADO },
          'u1',
          false,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('cerrar no reescribe lo que dijo quien arregló: le pone fecha', async () => {
      ticket.status = TicketStatus.RESUELTO;
      ticket.resolution = 'Era el cabezal, lo limpié';
      ticket.resolvedAt = new Date('2026-10-21T11:00:00Z');

      await service.changeStatus(
        't1',
        { status: TicketStatus.CERRADO },
        'u3',
        true,
      );

      expect(ticket.status).toBe(TicketStatus.CERRADO);
      expect(ticket.resolution).toBe('Era el cabezal, lo limpié');
      expect(ticket.closedAt).toBeInstanceOf(Date);
    });

    it('si no estaba arreglado, vuelve a en curso y borra la resolución', async () => {
      ticket.status = TicketStatus.RESUELTO;
      ticket.resolution = 'Era el cabezal, lo limpié';
      ticket.resolvedAt = new Date('2026-10-21T11:00:00Z');

      await service.changeStatus(
        't1',
        { status: TicketStatus.EN_CURSO, note: 'Sigue saliendo en blanco' },
        'u1',
        false,
      );

      expect(ticket.status).toBe(TicketStatus.EN_CURSO);
      expect(ticket.resolution).toBeNull();
      expect(ticket.resolvedAt).toBeNull();
    });

    it('reabrir uno cerrado pide el permiso de cerrar', async () => {
      ticket.status = TicketStatus.CERRADO;
      await expect(
        service.changeStatus(
          't1',
          { status: TicketStatus.EN_CURSO, note: 'volvió a pasar' },
          'u1',
          false,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('reabrir uno cerrado exige decir por qué', async () => {
      ticket.status = TicketStatus.CERRADO;
      await expect(
        service.changeStatus(
          't1',
          { status: TicketStatus.EN_CURSO },
          'u1',
          true,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('reabrir uno cerrado borra también la fecha de cierre', async () => {
      ticket.status = TicketStatus.CERRADO;
      ticket.resolution = 'Era el cabezal';
      ticket.resolvedAt = new Date('2026-10-21T11:00:00Z');
      ticket.closedAt = new Date('2026-10-21T12:00:00Z');

      await service.changeStatus(
        't1',
        { status: TicketStatus.EN_CURSO, note: 'volvió a pasar' },
        'u3',
        true,
      );

      expect(ticket.status).toBe(TicketStatus.EN_CURSO);
      expect(ticket.closedAt).toBeNull();
      expect(ticket.resolution).toBeNull();
    });

    it('cada cambio queda en el historial con el de dónde y el a dónde', async () => {
      await service.changeStatus(
        't1',
        { status: TicketStatus.EN_CURSO },
        'u2',
        false,
      );

      expect(eventos).toHaveLength(1);
      expect(eventos[0]).toMatchObject({
        kind: TicketEventKind.ESTADO,
        fromStatus: TicketStatus.ABIERTO,
        toStatus: TicketStatus.EN_CURSO,
        userId: 'u2',
      });
    });
  });

  describe('comentarios', () => {
    it('quedan en el mismo historial que los cambios de estado', async () => {
      await service.addComment(
        't1',
        'Probé con otro rollo y sigue igual',
        'u2',
      );

      expect(eventos).toHaveLength(1);
      expect(eventos[0]).toMatchObject({
        kind: TicketEventKind.COMENTARIO,
        note: 'Probé con otro rollo y sigue igual',
        userId: 'u2',
      });
      // Comentar no mueve el ticket.
      expect(ticket.status).toBe(TicketStatus.ABIERTO);
    });
  });
});
