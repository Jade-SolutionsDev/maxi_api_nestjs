import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../common/constants/auth.constants';
import { Role } from '../users/entities/user.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('DashboardController', () => {
  let controller: DashboardController;
  let service: { getStats: jest.Mock };

  beforeEach(async () => {
    service = {
      getStats: jest.fn().mockResolvedValue({ period: { days: 30 } }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [{ provide: DashboardService, useValue: service }],
    }).compile();

    controller = module.get<DashboardController>(DashboardController);
  });

  it('pasa la ventana pedida al servicio', async () => {
    await controller.getStats({ days: 7 });

    expect(service.getStats).toHaveBeenCalledWith(7);
  });

  it('usa 30 días cuando no se pide ventana', async () => {
    await controller.getStats({});

    expect(service.getStats).toHaveBeenCalledWith(30);
  });

  it('devuelve el DTO del servicio tal cual', async () => {
    const stats = { period: { days: 30 } };
    service.getStats.mockResolvedValue(stats);

    await expect(controller.getStats({})).resolves.toBe(stats);
  });

  it('solo lo ven SUPER_ADMIN y ADMIN', () => {
    // Un GROCER no puede leer /clients, así que no puede ver estos agregados.
    expect(Reflect.getMetadata(ROLES_KEY, DashboardController)).toEqual([
      Role.SUPER_ADMIN,
      Role.ADMIN,
    ]);
  });
});
