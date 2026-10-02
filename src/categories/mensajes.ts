/**
 * Los textos que este módulo devuelve al panel.
 *
 * Están juntos y sin interpolar nada por dos razones. La primera es que los ve
 * quien administra la tienda: hasta el 2-oct-2026 salían en inglés y con el
 * UUID dentro —«Cannot delete category "5f86a427-…" because it has active
 * products»— y el panel los enseña tal cual en el aviso. La segunda es que así
 * se pueden comprobar de una vez (ver `mensajes.spec.ts`).
 *
 * Los dos primeros son los que especifica MxH-0021, palabra por palabra.
 */
export const MENSAJES = {
  categoriaConProductos:
    'No es posible eliminar esta categoría porque tiene productos asociados. ' +
    'Para eliminarla, primero deberá eliminar o reasignar todos los productos ' +
    'pertenecientes a esta categoría.',

  departamentoConCategorias:
    'No es posible eliminar este departamento porque tiene categorías ' +
    'asociadas. Para eliminarlo, primero deberá eliminar o mover todas las ' +
    'categorías que contiene.',

  esUnDepartamento:
    'Este elemento es un departamento y debe eliminarse desde el módulo de ' +
    'Departamentos.',

  productoEnDepartamento:
    'Los productos se asignan a una categoría, no a un departamento. ' +
    'Elija una categoría dentro del departamento.',

  categoriaNoEncontrada: 'No se encontró la categoría.',

  departamentoNoEncontrado: 'No se encontró el departamento.',
} as const;
