import type { QueryRunner } from 'typeorm';
import { AlmaceneroSembradoDeMas1790400000000 } from './1790400000000-AlmaceneroSembradoDeMas';

const VIEJO = [
  'categories:list',
  'categories:read',
  'departments:list',
  'departments:read',
  'inventory:create-operation',
  'inventory:history',
  'inventory:list',
  'inventory:read',
  'orders:list',
  'orders:read',
  'orders:update-status',
  'orders:update-status-direct',
  'products:create',
  'products:delete',
  'products:list',
  'products:read',
  'products:update',
  'stock-locations:list',
  'stock-locations:read',
  'stock-locations:update',
];

const NUEVO = VIEJO.filter(
  (p) =>
    !p.startsWith('orders:') &&
    !['products:create', 'products:delete', 'products:update'].includes(p) &&
    p !== 'stock-locations:update',
);

/**
 * Una base de mentira que responde a las dos consultas de lectura de la
 * migración —el rol y su conjunto de permisos— y guarda las de escritura para
 * poder mirarlas.
 */
const base = (opciones: { rol?: string; conjunto?: string[] }) => {
  const escrituras: { sql: string; params?: unknown[] }[] = [];
  const qr = {
    query: jest.fn((sql: string, params?: unknown[]) => {
      if (/^SELECT .*FROM "roles"/s.test(sql)) {
        return Promise.resolve(opciones.rol ? [{ id: opciones.rol }] : []);
      }
      if (/^SELECT .*FROM "role_permissions"/s.test(sql)) {
        return Promise.resolve(
          (opciones.conjunto ?? []).map((clave) => ({ clave })),
        );
      }
      escrituras.push({ sql, params });
      return Promise.resolve(undefined);
    }),
  } as unknown as QueryRunner;
  return { qr, escrituras };
};

describe('AlmaceneroSembradoDeMas1790400000000', () => {
  it('recorta los ocho permisos que la tarjeta no autoriza', async () => {
    const { qr, escrituras } = base({ rol: 'r-grocer', conjunto: VIEJO });
    await new AlmaceneroSembradoDeMas1790400000000().up(qr);

    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].sql).toMatch(/DELETE FROM "role_permissions"/);
    const sobrantes = escrituras[0].params?.[1] as string[];
    expect(sobrantes.sort()).toEqual(
      [
        'orders:list',
        'orders:read',
        'orders:update-status',
        'orders:update-status-direct',
        'products:create',
        'products:delete',
        'products:update',
        'stock-locations:update',
      ].sort(),
    );
  });

  /**
   * El criterio que hace que esto sea seguro de desplegar. Si alguien ha
   * tocado la plantilla desde el panel, su configuración es una decisión y
   * manda: `updated_at` no sirve para saberlo —conceder permisos escribe en
   * `role_permissions`, no en la fila del rol—, así que se compara el
   * conjunto entero.
   */
  it('no toca un rol que alguien haya configurado', async () => {
    for (const conjunto of [
      [...VIEJO, 'clients:list'], // le añadieron uno
      VIEJO.filter((p) => p !== 'orders:list'), // le quitaron uno
      NUEVO, // ya está recortado
      [],
    ]) {
      const { qr, escrituras } = base({ rol: 'r-grocer', conjunto });
      await new AlmaceneroSembradoDeMas1790400000000().up(qr);
      expect(escrituras).toHaveLength(0);
    }
  });

  it('no falla donde el rol no existe', async () => {
    const { qr, escrituras } = base({});
    await new AlmaceneroSembradoDeMas1790400000000().up(qr);
    expect(escrituras).toHaveLength(0);
  });

  it('se puede deshacer, y solo sobre lo que dejó recortado', async () => {
    const { qr, escrituras } = base({ rol: 'r-grocer', conjunto: NUEVO });
    await new AlmaceneroSembradoDeMas1790400000000().down(qr);
    expect(escrituras[0].sql).toMatch(/INSERT INTO "role_permissions"/);

    const otro = base({ rol: 'r-grocer', conjunto: VIEJO });
    await new AlmaceneroSembradoDeMas1790400000000().down(otro.qr);
    expect(otro.escrituras).toHaveLength(0);
  });

  it('nunca borra el rol ni le quita usuarios', async () => {
    const { qr } = base({ rol: 'r-grocer', conjunto: VIEJO });
    const m = new AlmaceneroSembradoDeMas1790400000000();
    await m.up(qr);
    await m.down(qr);
    const todo = (qr.query as jest.Mock).mock.calls
      .map(([s]) => s as string)
      .join('\n');
    expect(todo).not.toMatch(/DELETE FROM "roles"/i);
    expect(todo).not.toMatch(/user_roles/i);
  });
});
