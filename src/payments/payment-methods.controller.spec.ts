import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import {
  isSystemAdmin,
  PermissionsService,
} from '../permissions/permissions.service';
import { Role } from '../users/entities/user.entity';
import { PaymentMethodsController } from './payment-methods.controller';

/**
 * MxH-0133, punto 2: el catálogo de métodos de pago estaba cerrado a
 * ADMIN/SUPER_ADMIN **entero**, así que un empleado con permiso de cobros
 * abría la pantalla de pedidos con el filtro por método vacío y no podía
 * registrar un cobro al crear un pedido. Las dos cosas piden
 * `GET /payment-methods`.
 *
 * Esta prueba pasa los dos guardias **de verdad** —con el `Reflector` real
 * leyendo los decoradores reales del controlador— por cada ruta, en vez de
 * comprobar que los decoradores están escritos. Lo que se quiere fijar es el
 * reparto, no su ortografía: leer se concede, gestionar no.
 */
describe('PaymentMethodsController · quién puede qué', () => {
  const reflector = new Reflector();

  const contexto = (
    handler: unknown,
    user: { id: string; role: Role } | undefined,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => PaymentMethodsController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  /** La cadena real de guardias de la aplicación, en su orden. */
  const dejaPasar = async (
    handler: unknown,
    user: { id: string; role: Role },
    permisos: (module: string, action: string) => boolean,
  ): Promise<boolean> => {
    const roles = new RolesGuard(reflector);
    const permisosGuard = new PermissionGuard(reflector, {
      hasPermission: (
        _userId: string,
        role: string,
        module: string,
        action: string,
      ) =>
        Promise.resolve(isSystemAdmin(role) ? true : permisos(module, action)),
    } as unknown as PermissionsService);

    const ctx = contexto(handler, user);
    try {
      roles.canActivate(ctx);
      return await permisosGuard.canActivate(ctx);
    } catch (err) {
      if (err instanceof ForbiddenException) return false;
      throw err;
    }
  };

  const prototipo = PaymentMethodsController.prototype;
  const empleado = { id: 'u-staff', role: Role.STAFF };
  const admin = { id: 'u-admin', role: Role.ADMIN };
  const conOrdersList = (module: string, action: string) =>
    module === 'orders' && action === 'list';
  const sinNada = () => false;

  it('un empleado con orders:list puede leer el catálogo', async () => {
    await expect(
      dejaPasar(prototipo.findAll, empleado, conOrdersList),
    ).resolves.toBe(true);
  });

  it('sin orders:list no lo puede leer: el permiso es lo que abre la puerta', async () => {
    await expect(dejaPasar(prototipo.findAll, empleado, sinNada)).resolves.toBe(
      false,
    );
  });

  it.each([
    ['crear', () => prototipo.create],
    ['editar', () => prototipo.update],
    ['borrar', () => prototipo.remove],
  ])(
    'gestionar el catálogo (%s) sigue siendo solo de admin',
    async (_nombre, handler) => {
      /**
       * Ni siquiera con todos los permisos concedidos: la puerta es el rol.
       *
       * Medido por mutación, para no atribuirle a esta prueba más de lo que
       * vigila: cazó darle a la escritura un `@RequirePermission` —el error que
       * la volvería concedible—, y **no** cazó quitarle el `@Roles` a secas.
       * Esto segundo es correcto: sin decorador la ruta cae en el default-deny
       * del `PermissionGuard`, que la cierra igual al empleado y la deja pasar
       * igual al admin. La mutación no cambia el comportamiento, así que no hay
       * nada que cazar.
       */
      await expect(dejaPasar(handler(), empleado, () => true)).resolves.toBe(
        false,
      );
      await expect(dejaPasar(handler(), admin, sinNada)).resolves.toBe(true);
    },
  );

  it('un admin lee el catálogo sin que se le pida ningún permiso', async () => {
    await expect(dejaPasar(prototipo.findAll, admin, sinNada)).resolves.toBe(
      true,
    );
  });
});
