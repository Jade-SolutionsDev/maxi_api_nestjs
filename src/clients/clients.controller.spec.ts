import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ClientAddressesService } from '../client-addresses/client-addresses.service';
import type { ClientAddress } from '../client-addresses/entities/client-address.entity';
import type { ClientAddressResponseDto } from '../client-addresses/dto/client-address-response.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import {
  isSystemAdmin,
  PermissionsService,
} from '../permissions/permissions.service';
import { Role } from '../users/entities/user.entity';
import type { ClientInvitationsService } from './client-invitations.service';
import { ClientReconciliationService } from './client-reconciliation.service';
import { ClientsController } from './clients.controller';
import type { ClientsService } from './clients.service';

/**
 * La libreta de direcciones de un cliente en el panel (MxH-0178).
 *
 * Son direcciones de casas, con teléfono y a veces carné, así que lo que se
 * fija aquí es **quién puede abrirla** y que una cuenta inventada no conteste
 * como una cuenta real sin direcciones.
 *
 * Las dos primeras pruebas pasan la cadena real de guardias —el `Reflector` de
 * verdad leyendo los decoradores de verdad— en vez de comprobar que el
 * decorador está escrito. Lo que importa es el reparto, no su ortografía.
 */
describe('ClientsController · la libreta de direcciones', () => {
  const reflector = new Reflector();
  const prototipo = ClientsController.prototype;
  const empleado = { id: 'u-staff', role: Role.STAFF };

  const contexto = (
    handler: unknown,
    user: { id: string; role: Role },
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => ClientsController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

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

  const conClientsRead = (module: string, action: string) =>
    module === 'clients' && action === 'read';
  const soloClientsList = (module: string, action: string) =>
    module === 'clients' && action === 'list';
  const sinNada = () => false;

  it('se abre con clients:read, el mismo permiso que la ficha', async () => {
    await expect(
      dejaPasar(prototipo.findAddresses, empleado, conClientsRead),
    ).resolves.toBe(true);
  });

  it('ver el listado de clientes no basta para abrirla', async () => {
    // `clients:list` es el permiso de la rejilla, donde no hay direcciones.
    // Si esta ruta se contentara con él, cualquiera que pueda buscar clientes
    // leería dónde viven.
    await expect(
      dejaPasar(prototipo.findAddresses, empleado, soloClientsList),
    ).resolves.toBe(false);
  });

  it('sin permiso de clientes, no se abre', async () => {
    await expect(
      dejaPasar(prototipo.findAddresses, empleado, sinNada),
    ).resolves.toBe(false);
  });

  describe('qué devuelve', () => {
    const direccion = { id: 'dir-1' } as ClientAddress;
    const respuesta = {
      id: 'dir-1',
      street: 'Calle 23',
    } as ClientAddressResponseDto;

    const controlador = (clientes: Partial<ClientsService>) => {
      const addresses = {
        findAllForClient: jest.fn().mockResolvedValue([direccion]),
        toResponse: jest.fn().mockResolvedValue([respuesta]),
      };

      const controller = new ClientsController(
        clientes as ClientsService,
        {} as ClientInvitationsService,
        addresses as unknown as ClientAddressesService,
        {} as ClientReconciliationService,
      );

      return { controller, addresses };
    };

    it('devuelve la libreta tal y como la arma el servicio de direcciones', async () => {
      // El orden —predeterminada primero— y los nombres de municipio y
      // provincia los pone `toResponse`. El controlador no los recalcula.
      const { controller, addresses } = controlador({
        findOne: jest.fn().mockResolvedValue({ id: 'cli-1' }),
      });

      await expect(controller.findAddresses('cli-1')).resolves.toEqual([
        respuesta,
      ]);
      expect(addresses.findAllForClient).toHaveBeenCalledWith('cli-1');
      expect(addresses.toResponse).toHaveBeenCalledWith([direccion]);
    });

    it('un cliente que no existe es un 404, no una libreta vacía', async () => {
      // Sin esta comprobación, un id inventado contestaría `[]` —exactamente
      // lo mismo que un cliente real que no ha guardado ninguna dirección—, y
      // quien atiende no podría distinguir «no tiene» de «no es».
      const { controller, addresses } = controlador({
        findOne: jest.fn().mockRejectedValue(new NotFoundException()),
      });

      await expect(controller.findAddresses('cli-fantasma')).rejects.toThrow(
        NotFoundException,
      );
      expect(addresses.findAllForClient).not.toHaveBeenCalled();
    });
  });
});

describe('ClientsController · buscar por clerkId', () => {
  /**
   * `GET /clients/lookup` devolvía **500 cuando no venía `clerkId`**
   * (MxH-0181): el parámetro llegaba `undefined`, entraba en el `where` de
   * TypeORM y este se niega a construirlo. Lo que se fija aquí es que el
   * identificador **llega al servicio**; que una petición sin él responde 400
   * lo fija `ClerkLookupQueryDto`, que es quien lo valida.
   */
  const controlador = () => {
    const clientes = { findByClerkId: jest.fn().mockResolvedValue(null) };
    const controller = new ClientsController(
      clientes as unknown as ClientsService,
      {} as ClientInvitationsService,
      {} as ClientAddressesService,
      {} as ClientReconciliationService,
    );
    return { controller, clientes };
  };

  it('le pasa al servicio el clerkId que vino en la consulta', async () => {
    const { controller, clientes } = controlador();
    await controller.findByClerkId({ clerkId: 'user_2abcDEF' });
    expect(clientes.findByClerkId).toHaveBeenCalledWith('user_2abcDEF');
  });

  it('una cuenta que no está devuelve null, no un error', async () => {
    const { controller } = controlador();
    expect(await controller.findByClerkId({ clerkId: 'user_no_existe' })).toBe(
      null,
    );
  });
});
