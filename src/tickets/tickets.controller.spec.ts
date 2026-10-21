import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { PERMISSION_KEY } from '../permissions/decorators/require-permission.decorator';
import { TicketStatus } from './entities/ticket.entity';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

const peticion = { user: { id: 'u1' } } as AuthenticatedUserRequest;

describe('TicketsController', () => {
  let controller: TicketsController;
  let service: {
    findAll: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    changeStatus: jest.Mock;
    addComment: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      findOne: jest.fn().mockResolvedValue({ id: 't1' }),
      create: jest.fn().mockResolvedValue({ id: 't1' }),
      update: jest.fn().mockResolvedValue({ id: 't1' }),
      changeStatus: jest.fn().mockResolvedValue({ id: 't1' }),
      addComment: jest.fn().mockResolvedValue({ id: 't1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TicketsController],
      providers: [{ provide: TicketsService, useValue: service }],
    }).compile();

    controller = module.get(TicketsController);
  });

  const permisoDe = (metodo: keyof TicketsController) =>
    new Reflector().get<{ module: string; action: string }>(
      PERMISSION_KEY,
      TicketsController.prototype[metodo],
    );

  /**
   * El reparto de permisos es el contenido de la tarjeta, no un detalle: una
   * ruta mal decorada es la diferencia entre que cualquiera cierre tickets y
   * que no los cierre nadie.
   */
  describe('el reparto de permisos', () => {
    it.each([
      ['findAll', 'list'],
      ['findOne', 'read'],
      ['create', 'create'],
      ['update', 'update'],
      ['changeStatus', 'update'],
      ['close', 'close'],
      ['reopen', 'close'],
      ['addComment', 'create'],
    ] as const)('%s pide tickets:%s', (metodo, accion) => {
      expect(permisoDe(metodo)).toEqual({ module: 'tickets', action: accion });
    });

    it('ninguna ruta se queda sin decorar', () => {
      // Una ruta sin `@RequirePermission` es 403 para todos salvo los admin,
      // así que el módulo parecería roto solo para quien no es admin.
      const rutas: Array<keyof TicketsController> = [
        'findAll',
        'findOne',
        'create',
        'update',
        'changeStatus',
        'close',
        'reopen',
        'addComment',
      ];
      for (const ruta of rutas) expect(permisoDe(ruta)).toBeDefined();
    });
  });

  describe('qué le pide al servicio', () => {
    it('cambiar de estado no trae el permiso de cerrar', async () => {
      await controller.changeStatus(
        't1',
        { status: TicketStatus.EN_CURSO },
        peticion,
      );
      expect(service.changeStatus).toHaveBeenCalledWith(
        't1',
        { status: TicketStatus.EN_CURSO },
        'u1',
        false,
      );
    });

    it('cerrar fuerza el estado «cerrado» y sí lo trae', async () => {
      await controller.close(
        't1',
        // Aunque el cuerpo diga otra cosa, la ruta decide: si no, esta ruta
        // sería un atajo para hacer cualquier cambio con el permiso de cerrar.
        { status: TicketStatus.ABIERTO, note: 'confirmado' },
        peticion,
      );
      expect(service.changeStatus).toHaveBeenCalledWith(
        't1',
        { status: TicketStatus.CERRADO, note: 'confirmado' },
        'u1',
        true,
      );
    });

    it('reabrir fuerza «en curso» y lo trae', async () => {
      await controller.reopen(
        't1',
        { status: TicketStatus.ABIERTO, note: 'volvió a pasar' },
        peticion,
      );
      expect(service.changeStatus).toHaveBeenCalledWith(
        't1',
        { status: TicketStatus.EN_CURSO, note: 'volvió a pasar' },
        'u1',
        true,
      );
    });

    it('comentar pasa solo el texto y quién lo escribe', async () => {
      await controller.addComment('t1', { note: 'probé otro rollo' }, peticion);
      expect(service.addComment).toHaveBeenCalledWith(
        't1',
        'probé otro rollo',
        'u1',
      );
    });
  });
});
