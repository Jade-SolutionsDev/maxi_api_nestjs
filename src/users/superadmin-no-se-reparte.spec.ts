import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { Role, User } from './entities/user.entity';

/**
 * El rol de superadministrador es lo que separa de corregir pedidos en
 * cualquier dirección, editar sus líneas y borrar intentos de cobro. Un ADMIN
 * no puede repartirlo ni quedarse con una cuenta que ya lo tiene.
 *
 * Las pruebas llaman al servicio con un doble mínimo: lo que se mide es la
 * decisión de permiso, que ocurre ANTES de tocar la base. Por eso basta con
 * que `findOne` devuelva el objetivo.
 */
describe('UsersService · nadie se fabrica un superadministrador', () => {
  const comoUsuario = (role: Role, id = 'quien-actua'): User =>
    ({ id, role }) as User;

  const servicio = (objetivo: User): UsersService => {
    const s = Object.create(UsersService.prototype) as UsersService;
    (s as unknown as { findOne: unknown }).findOne = jest
      .fn()
      .mockResolvedValue(objetivo);
    return s;
  };

  const ADMIN = comoUsuario(Role.ADMIN);
  const SUPER = comoUsuario(Role.SUPER_ADMIN);
  const otroAdmin = comoUsuario(Role.ADMIN, 'otro');
  const unSuper = comoUsuario(Role.SUPER_ADMIN, 'el-super');

  describe('lo que un ADMIN no puede', () => {
    it('crear un usuario con rol de superadministrador', async () => {
      await expect(
        servicio(otroAdmin).create(
          { role: Role.SUPER_ADMIN } as never,
          ADMIN,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ascender a otro usuario a superadministrador', async () => {
      await expect(
        servicio(otroAdmin).update('otro', { role: Role.SUPER_ADMIN }, ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('imponer contraseña a un superadministrador', async () => {
      await expect(
        servicio(unSuper).setPassword('el-super', 'la-que-yo-elija', ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('editar la cuenta de un superadministrador', async () => {
      await expect(
        servicio(unSuper).update('el-super', { firstName: 'X' }, ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('borrar a un superadministrador', async () => {
      await expect(
        servicio(unSuper).remove('el-super', ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  /**
   * La mitad que de verdad importa: un arreglo de permisos no falla a gritos,
   * falla dejando fuera a quien debía entrar, y eso se descubre el peor día.
   * Aquí se comprueba que lo legítimo NO se rechaza por permiso: la llamada
   * sigue adelante y falla más tarde por no tener repositorio detrás, que es
   * otra cosa.
   */
  describe('lo que debe seguir funcionando', () => {
    it('un ADMIN edita a otro ADMIN', async () => {
      await expect(
        servicio(otroAdmin).update('otro', { firstName: 'Ana' }, ADMIN),
      ).rejects.not.toBeInstanceOf(ForbiddenException);
    });

    it('un ADMIN cambia la contraseña de otro ADMIN', async () => {
      await expect(
        servicio(otroAdmin).setPassword('otro', 'nueva', ADMIN),
      ).rejects.not.toBeInstanceOf(ForbiddenException);
    });

    it('un ADMIN crea usuarios de rol normal', async () => {
      await expect(
        servicio(otroAdmin).create({ role: Role.ADMIN } as never, ADMIN),
      ).rejects.not.toBeInstanceOf(ForbiddenException);
    });

    it('un SUPER_ADMIN sí puede ascender a otro', async () => {
      await expect(
        servicio(otroAdmin).update('otro', { role: Role.SUPER_ADMIN }, SUPER),
      ).rejects.not.toBeInstanceOf(ForbiddenException);
    });

    it('un SUPER_ADMIN sí puede gestionar a otro superadministrador', async () => {
      await expect(
        servicio(unSuper).setPassword('el-super', 'nueva', SUPER),
      ).rejects.not.toBeInstanceOf(ForbiddenException);
    });
  });
});
