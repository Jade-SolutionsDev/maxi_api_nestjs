import { ConflictException } from '@nestjs/common';
import { MENSAJES } from './mensajes';

/**
 * Los textos de este módulo los ve quien administra la tienda, así que están
 * fijados aquí: hasta hoy salían en inglés y con el UUID dentro —«Cannot delete
 * category "5f86a427-…" because it has active products»— y eso es lo que llegaba
 * al aviso del panel.
 *
 * Los dos primeros son los que especifica MxH-0021, palabra por palabra.
 */
describe('Mensajes del módulo de categorías', () => {
  it('el de eliminar con productos es el que pide la tarjeta', () => {
    expect(MENSAJES.categoriaConProductos).toBe(
      'No es posible eliminar esta categoría porque tiene productos asociados. ' +
        'Para eliminarla, primero deberá eliminar o reasignar todos los productos ' +
        'pertenecientes a esta categoría.',
    );
  });

  it('ninguno lleva un identificador dentro', () => {
    // Un UUID en pantalla no le dice nada a quien administra la tienda.
    for (const [clave, texto] of Object.entries(MENSAJES)) {
      expect(`${clave}: ${texto}`).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i,
      );
      expect(`${clave}: ${texto}`).not.toMatch(/\$\{/);
    }
  });

  it('ninguno está en inglés', () => {
    const delatores =
      /\b(cannot|because|not found|must be|endpoint|delete|category|department)\b/i;
    for (const [clave, texto] of Object.entries(MENSAJES)) {
      expect(`${clave}: ${texto}`).not.toMatch(delatores);
    }
  });

  it('todos empiezan en mayúscula y terminan en punto', () => {
    for (const [clave, texto] of Object.entries(MENSAJES)) {
      expect(`${clave}: ${texto}`).toMatch(/: [A-ZÁÉÍÓÚÑ¿«]/);
      expect(texto.trim()).toMatch(/\.$/);
    }
  });

  it('se pueden lanzar tal cual', () => {
    const e = new ConflictException(MENSAJES.categoriaConProductos);
    expect(e.message).toContain('productos asociados');
  });
});
