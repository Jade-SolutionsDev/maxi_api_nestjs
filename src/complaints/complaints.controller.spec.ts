import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { PERMISSION_KEY } from '../permissions/decorators/require-permission.decorator';
import { ComplaintsController } from './complaints.controller';
import { ComplaintsService } from './complaints.service';
import { ComplaintStatus } from './entities/complaint.entity';

const peticion = { user: { id: 'u1' } } as AuthenticatedUserRequest;

describe('ComplaintsController', () => {
  let controller: ComplaintsController;
  let service: {
    findAll: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    changeStatus: jest.Mock;
    addNote: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      findOne: jest.fn().mockResolvedValue({ id: 'q1' }),
      create: jest.fn().mockResolvedValue({ id: 'q1' }),
      update: jest.fn().mockResolvedValue({ id: 'q1' }),
      changeStatus: jest.fn().mockResolvedValue({ id: 'q1' }),
      addNote: jest.fn().mockResolvedValue({ id: 'q1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ComplaintsController],
      providers: [{ provide: ComplaintsService, useValue: service }],
    }).compile();

    controller = module.get(ComplaintsController);
  });

  const permisoDe = (metodo: keyof ComplaintsController) =>
    new Reflector().get<{ module: string; action: string }>(
      PERMISSION_KEY,
      ComplaintsController.prototype[metodo],
    );

  /**
   * MxH-0064: el Call Center registra y consulta, pero dar un caso por
   * resuelto se concede aparte. Si `resolve` compartiera permiso con el resto,
   * quien atiende el teléfono podría cerrar sus propias quejas.
   */
  it('resolver pide un permiso distinto del de gestionar', () => {
    expect(permisoDe('resolve')).toEqual({
      module: 'complaints',
      action: 'close',
    });
    expect(permisoDe('changeStatus')).toEqual({
      module: 'complaints',
      action: 'update',
    });
  });

  it('todas las rutas van decoradas: sin eso el guard las deniega', () => {
    const metodos: Array<keyof ComplaintsController> = [
      'findAll',
      'findOne',
      'create',
      'update',
      'changeStatus',
      'resolve',
      'addNote',
    ];

    for (const metodo of metodos) {
      expect(permisoDe(metodo)).toBeDefined();
    }
  });

  it('solo la ruta de resolver deja cerrar', async () => {
    await controller.resolve(
      'q1',
      { status: ComplaintStatus.RESUELTA, note: 'Se repuso' },
      peticion,
    );
    expect(service.changeStatus).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({ status: ComplaintStatus.RESUELTA }),
      'u1',
      true,
    );

    service.changeStatus.mockClear();

    await controller.changeStatus(
      'q1',
      { status: ComplaintStatus.EN_GESTION },
      peticion,
    );
    expect(service.changeStatus).toHaveBeenCalledWith(
      'q1',
      { status: ComplaintStatus.EN_GESTION },
      'u1',
      false,
    );
  });

  // Aunque alguien mande otro estado al cuerpo de `resolve`, la ruta resuelve.
  it('resolver ignora el estado que venga en el cuerpo', async () => {
    await controller.resolve(
      'q1',
      { status: ComplaintStatus.ABIERTA, note: 'Se repuso' },
      peticion,
    );

    expect(service.changeStatus).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({ status: ComplaintStatus.RESUELTA }),
      'u1',
      true,
    );
  });
});
