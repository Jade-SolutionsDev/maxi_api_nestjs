import { applyDecorators } from '@nestjs/common';
import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * ¿Puede la tienda pintar esta imagen?
 *
 * Acepta una ruta propia (`/algo.webp`) o una URL `http`/`https` con un host
 * con punto. Rechaza todo lo demás: texto suelto, `javascript:`, y hosts sin
 * dominio como el `https://x/p.png` que tumbó el catálogo entero (MxH-0086).
 *
 * Deliberadamente **no** comprueba contra la lista de sitios autorizados de la
 * tienda. Esa lista vive en el repositorio de la tienda y cambia con su
 * despliegue; duplicarla aquí sería tener dos verdades que se separan, y el
 * día que se separen se rechazarían imágenes buenas sin que nadie entienda por
 * qué. Esto ataja lo que siempre está mal, que es lo que se pegó a mano.
 */
export function esUrlDeImagen(valor: unknown): boolean {
  if (typeof valor !== 'string') return false;
  const v = valor.trim();
  if (!v) return false;
  if (v.startsWith('/')) return true;

  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  // Un host sin punto no es un dominio servible desde fuera («x», «localhost»
  // sale por la excepción de abajo porque en desarrollo sí se usa).
  if (url.hostname === 'localhost') return true;
  return url.hostname.includes('.') && !url.hostname.endsWith('.');
}

export function IsImageUrl(options?: ValidationOptions) {
  return applyDecorators((target: object, propertyName: string) => {
    registerDecorator({
      name: 'isImageUrl',
      target: target.constructor,
      propertyName,
      options: {
        message:
          'La imagen debe ser una dirección http(s) válida o una ruta que empiece por «/»',
        ...options,
      },
      validator: { validate: (value: unknown) => esUrlDeImagen(value) },
    });
  });
}
