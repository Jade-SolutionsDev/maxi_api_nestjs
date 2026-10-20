import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Client } from '../clients/entities/client.entity';
import { NomenclatorsService } from '../nomenclators/nomenclators.service';
import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { ComplaintsService } from './complaints.service';
import {
  ComplaintEvent,
  ComplaintEventKind,
} from './entities/complaint-event.entity';
import { Complaint, ComplaintStatus } from './entities/complaint.entity';

describe('ComplaintsService', () => {
  let service: ComplaintsService;
  let queja: Complaint;
  let eventos: ComplaintEvent[];

  let complaintRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let eventRepo: { find: jest.Mock; create: jest.Mock; save: jest.Mock };
  let clientRepo: { exists: jest.Mock; find: jest.Mock };
  let orderRepo: { findOne: jest.Mock; find: jest.Mock };
  let userRepo: { exists: jest.Mock; find: jest.Mock };
  let nomencladores: { findActiveOption: jest.Mock; labelsFor: jest.Mock };

  beforeEach(async () => {
    queja = {
      id: 'q1',
      clientId: 'c1',
      orderId: null,
      motiveId: 'm1',
      description: 'Llegó sin dos productos del pedido',
      status: ComplaintStatus.ABIERTA,
      assignedUserId: null,
      createdByUserId: 'u1',
      resolution: null,
      resolvedAt: null,
      createdAt: new Date('2026-10-20T10:00:00Z'),
      updatedAt: new Date('2026-10-20T10:00:00Z'),
      deletedAt: null,
    };
    eventos = [];

    complaintRepo = {
      findOne: jest.fn().mockImplementation(() => Promise.resolve(queja)),
      create: jest.fn((datos: Partial<Complaint>) => ({ ...queja, ...datos })),
      save: jest.fn((entidad: Complaint) => {
        queja = { ...queja, ...entidad };
        return Promise.resolve(queja);
      }),
      createQueryBuilder: jest.fn(),
    };
    eventRepo = {
      find: jest.fn().mockImplementation(() => Promise.resolve(eventos)),
      create: jest.fn((datos: Partial<ComplaintEvent>) => datos),
      save: jest.fn((evento: ComplaintEvent) => {
        eventos.push({ ...evento, createdAt: new Date() });
        return Promise.resolve(evento);
      }),
    };
    clientRepo = {
      exists: jest.fn().mockResolvedValue(true),
      find: jest.fn().mockResolvedValue([]),
    };
    orderRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'o1', clientId: 'c1' }),
      find: jest.fn().mockResolvedValue([]),
    };
    userRepo = {
      exists: jest.fn().mockResolvedValue(true),
      find: jest.fn().mockResolvedValue([]),
    };
    nomencladores = {
      findActiveOption: jest.fn().mockResolvedValue({ id: 'm1' }),
      labelsFor: jest
        .fn()
        .mockResolvedValue(new Map([['m1', 'Pedido incompleto']])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplaintsService,
        { provide: getRepositoryToken(Complaint), useValue: complaintRepo },
        { provide: getRepositoryToken(ComplaintEvent), useValue: eventRepo },
        { provide: getRepositoryToken(Client), useValue: clientRepo },
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: NomenclatorsService, useValue: nomencladores },
      ],
    }).compile();

    service = module.get(ComplaintsService);
  });

  describe('registrar', () => {
    it('deja la queja abierta y anota quién la registró', async () => {
      const dto = {
        clientId: 'c1',
        motiveId: 'm1',
        description: 'Llegó sin dos productos del pedido',
      };

      const creada = await service.create(dto, 'u1');

      expect(creada.status).toBe(ComplaintStatus.ABIERTA);
      expect(eventos).toHaveLength(1);
      expect(eventos[0]).toMatchObject({
        kind: ComplaintEventKind.REGISTRADA,
        userId: 'u1',
      });
    });

    // Sin motivos tipificados no se pueden agrupar en un informe, que es para
    // lo que existe el nomenclador.
    it('no acepta un motivo que no existe o está inactivo', async () => {
      nomencladores.findActiveOption.mockResolvedValue(null);

      await expect(
        service.create(
          { clientId: 'c1', motiveId: 'mx', description: 'una descripción' },
          'u1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * Si la queja pudiera colgarse de un pedido ajeno, «este pedido generó una
     * queja» señalaría al cliente equivocado.
     */
    it('no deja colgar la queja de un pedido de otro cliente', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 'o9', clientId: 'otro' });

      await expect(
        service.create(
          {
            clientId: 'c1',
            orderId: 'o9',
            motiveId: 'm1',
            description: 'una descripción',
          },
          'u1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cerrar', () => {
    it('sin el permiso de cerrar, no se resuelve', async () => {
      await expect(
        service.changeStatus(
          'q1',
          { status: ComplaintStatus.RESUELTA, note: 'Se repuso el faltante' },
          'u1',
          false,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(queja.status).toBe(ComplaintStatus.ABIERTA);
    });

    it('con el permiso, se resuelve y guarda cómo', async () => {
      const resuelta = await service.changeStatus(
        'q1',
        { status: ComplaintStatus.RESUELTA, note: 'Se repuso el faltante' },
        'u2',
        true,
      );

      expect(resuelta.status).toBe(ComplaintStatus.RESUELTA);
      expect(queja.resolution).toBe('Se repuso el faltante');
      expect(queja.resolvedAt).toBeInstanceOf(Date);
      expect(eventos.at(-1)).toMatchObject({
        kind: ComplaintEventKind.ESTADO,
        fromStatus: ComplaintStatus.ABIERTA,
        toStatus: ComplaintStatus.RESUELTA,
        userId: 'u2',
      });
    });

    // Una queja resuelta sin explicación no sirve ni para el informe ni para
    // quien atienda la próxima llamada del mismo cliente.
    it('no se resuelve sin decir cómo', async () => {
      await expect(
        service.changeStatus(
          'q1',
          { status: ComplaintStatus.RESUELTA, note: '   ' },
          'u1',
          true,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('reabrirla borra el cierre anterior', async () => {
      await service.changeStatus(
        'q1',
        { status: ComplaintStatus.RESUELTA, note: 'Se repuso el faltante' },
        'u2',
        true,
      );

      await service.changeStatus(
        'q1',
        { status: ComplaintStatus.EN_GESTION },
        'u1',
        false,
      );

      expect(queja.status).toBe(ComplaintStatus.EN_GESTION);
      expect(queja.resolution).toBeNull();
      expect(queja.resolvedAt).toBeNull();
    });
  });

  describe('estados', () => {
    it('no acepta moverla al estado que ya tiene', async () => {
      await expect(
        service.changeStatus(
          'q1',
          { status: ComplaintStatus.ABIERTA },
          'u1',
          false,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('de abierta a en gestión sí', async () => {
      const movida = await service.changeStatus(
        'q1',
        { status: ComplaintStatus.EN_GESTION },
        'u1',
        false,
      );

      expect(movida.status).toBe(ComplaintStatus.EN_GESTION);
    });
  });

  describe('historial', () => {
    it('asignar a alguien queda anotado', async () => {
      await service.update('q1', { assignedUserId: 'u5' }, 'u1');

      expect(queja.assignedUserId).toBe('u5');
      expect(eventos.map((e) => e.kind)).toContain(ComplaintEventKind.ASIGNADA);
    });

    it('una nota queda en el historial con su autor', async () => {
      await service.addNote('q1', 'El cliente llamó otra vez', 'u3');

      expect(eventos.at(-1)).toMatchObject({
        kind: ComplaintEventKind.NOTA,
        note: 'El cliente llamó otra vez',
        userId: 'u3',
      });
    });
  });
});
