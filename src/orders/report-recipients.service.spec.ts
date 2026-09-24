import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRole } from '../permissions/entities/user-role.entity';
import { User } from '../users/entities/user.entity';
import { ReportRecipientsService } from './report-recipients.service';

describe('ReportRecipientsService', () => {
  let service: ReportRecipientsService;
  let userRepo: { find: jest.Mock };
  let userRoleRepo: { find: jest.Mock };

  const usuario = (extra: Partial<User> = {}): User =>
    ({
      id: 'u1',
      email: 'ana@maxihabana.com',
      firstName: 'Ana',
      lastName: 'Pérez',
      isActive: true,
      deletedAt: null,
      ...extra,
    }) as User;

  beforeEach(async () => {
    userRepo = { find: jest.fn().mockResolvedValue([]) };
    userRoleRepo = { find: jest.fn().mockResolvedValue([]) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportRecipientsService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(UserRole), useValue: userRoleRepo },
      ],
    }).compile();
    service = module.get(ReportRecipientsService);
  });

  it('normaliza los correos escritos a mano', async () => {
    const r = await service.resolver(['  Jefe@Maxi.COM ', ''], []);
    expect(r.correos).toEqual(['jefe@maxi.com']);
  });

  it('resuelve los usuarios de un rol', async () => {
    userRoleRepo.find.mockResolvedValue([
      { userId: 'u1', roleId: 'r1', role: { name: 'Economista' } },
      { userId: 'u2', roleId: 'r1', role: { name: 'Economista' } },
    ]);
    userRepo.find.mockResolvedValue([
      usuario(),
      usuario({ id: 'u2', email: 'luis@maxihabana.com', firstName: 'Luis' }),
    ]);

    const r = await service.resolver([], ['r1']);

    expect(r.correos).toEqual(['ana@maxihabana.com', 'luis@maxihabana.com']);
    expect(r.detalle[0].motivo).toBe('Economista');
  });

  // Quien está en el rol y a la vez escrito a mano recibe UN correo, no dos
  // con el mismo adjunto.
  it('no manda dos veces a la misma persona', async () => {
    userRoleRepo.find.mockResolvedValue([
      { userId: 'u1', roleId: 'r1', role: { name: 'Economista' } },
    ]);
    userRepo.find.mockResolvedValue([usuario()]);

    const r = await service.resolver(['ANA@maxihabana.com'], ['r1']);

    expect(r.correos).toEqual(['ana@maxihabana.com']);
  });

  // Mandarle las cifras de la empresa a quien ya no trabaja aquí es filtrarlas
  // fuera de ella. El repositorio se consulta con `isActive` y sin borrados.
  it('no incluye a los desactivados ni a los borrados', async () => {
    userRoleRepo.find.mockResolvedValue([
      { userId: 'u1', roleId: 'r1', role: { name: 'Economista' } },
    ]);

    await service.resolver([], ['r1']);

    expect(userRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      }),
    );
  });

  // Los usuarios del back-office nacen de una invitación y su fila local se
  // rellena por webhook: si alguna se quedó a medias, hay gente en el rol sin
  // dirección. Quien pulsa el botón tiene que enterarse.
  it('avisa de quién se queda fuera por no tener correo', async () => {
    userRoleRepo.find.mockResolvedValue([
      { userId: 'u1', roleId: 'r1', role: { name: 'Economista' } },
      { userId: 'u2', roleId: 'r1', role: { name: 'Economista' } },
    ]);
    userRepo.find.mockResolvedValue([
      usuario(),
      usuario({ id: 'u2', email: null, firstName: 'Sin', lastName: 'Correo' }),
    ]);

    const r = await service.resolver([], ['r1']);

    expect(r.correos).toEqual(['ana@maxihabana.com']);
    expect(r.sinCorreo).toEqual([{ nombre: 'Sin Correo', rol: 'Economista' }]);
  });

  it('avisa del rol que no tiene a nadie', async () => {
    userRoleRepo.find.mockResolvedValue([]);
    const r = await service.resolver([], ['r-vacio']);
    expect(r.correos).toEqual([]);
    expect(r.rolesVacios).toEqual(['r-vacio']);
  });
});
