import { Logger } from '@nestjs/common';
import { isLocalEnv, resendConfig } from './configuration';

/**
 * Lo que la aplicación necesita para funcionar, comprobado antes de aceptar la
 * primera petición.
 *
 * Sin esto, olvidar una variable en el panel de despliegue no se nota al
 * arrancar: se nota más tarde, y de la peor manera — el primer cliente que
 * intenta pagar, el primer correo que no sale, el primer webhook que se
 * descarta. Treinta variables escritas a mano con prisa hacen que ese olvido
 * sea el fallo más probable de un despliegue.
 *
 * La regla: **lo que abre un agujero o impide vender detiene el arranque; lo
 * que apaga una función avisa y sigue.**
 */

type Variable = { nombre: string; porque: string };

/** Sin estas, o no se puede vender, o algo queda abierto. */
const IMPRESCINDIBLES: Variable[] = [
  { nombre: 'DATABASE_URL', porque: 'sin base de datos no hay nada' },
  {
    nombre: 'CLERK_SECRET_KEY',
    porque:
      'sin ella la verificación de tokens de la tienda cae a un respaldo de desarrollo',
  },
  {
    nombre: 'CLERK_BACKOFFICE_SECRET_KEY',
    porque: 'nadie podría entrar a la administración',
  },
  {
    nombre: 'CLERK_WEBHOOK_SECRET',
    porque: 'los clientes que se registran no llegarían a la base',
  },
  {
    nombre: 'CLERK_BACKOFFICE_WEBHOOK_SECRET',
    porque: 'los usuarios internos que se invitan no llegarían a la base',
  },
  {
    nombre: 'CRON_SECRET',
    porque:
      'los pedidos sin pagar no caducarían y su stock quedaría reservado para siempre',
  },
  {
    nombre: 'STOREFRONT_REVALIDATE_SECRET',
    porque: 'la tienda seguiría mostrando el catálogo viejo tras cada cambio',
  },
];

/** Sin estas la aplicación funciona, pero algo deja de hacerse. */
const DEGRADAN: Variable[] = [
  { nombre: 'RESEND_API_KEY', porque: 'no se enviará ningún correo' },
  {
    nombre: 'STOREFRONT_URL',
    porque: 'no se podrá avisar a la tienda de los cambios',
  },
  {
    nombre: 'PUBLIC_API_URL',
    porque: 'los enlaces absolutos que genere la API saldrán mal',
  },
];

const falta = (nombre: string) => !process.env[nombre]?.trim();

/**
 * Se llama antes de escuchar peticiones. En local no comprueba nada: ahí se
 * trabaja con media configuración a propósito.
 */
export function comprobarConfiguracion(): void {
  if (isLocalEnv()) return;

  const logger = new Logger('Configuración');

  const ausentes = IMPRESCINDIBLES.filter((v) => falta(v.nombre));
  if (ausentes.length > 0) {
    const detalle = ausentes
      .map((v) => `  · ${v.nombre} — ${v.porque}`)
      .join('\n');
    const plural = ausentes.length === 1;
    throw new Error(
      `${plural ? 'Falta 1 variable imprescindible' : `Faltan ${ausentes.length} variables imprescindibles`} para arrancar en este entorno:\n${detalle}\n` +
        `${plural ? 'Añádela' : 'Añádelas'} a la configuración del despliegue y vuelve a arrancar.`,
    );
  }

  for (const v of DEGRADAN.filter((v) => falta(v.nombre))) {
    logger.warn(`${v.nombre} no está definida: ${v.porque}.`);
  }

  // Un correo apagado no se nota: no hay error, simplemente nadie recibe nada.
  // Decirlo al arrancar es lo que evita que un apagado temporal se quede
  // encendido seis meses porque nadie se acordaba de que estaba puesto.
  const apagadas = (process.env.MAIL_TEMPLATES_OFF ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  if (apagadas.length > 0) {
    logger.warn(
      `Correos apagados en este entorno (MAIL_TEMPLATES_OFF): ${apagadas.join(', ')}. No se enviará ninguno de ellos.`,
    );
  }

  // La reserva solo se nota cuando ya ha cortado algo, y para entonces el
  // correo lleva rato sin salir. Decir de cuánto es al arrancar permite
  // cuadrarla con el plan contratado sin tener que leer el código.
  const { cupoMensual, cupoDiario, reservaMensual, reservaDiaria } =
    resendConfig();
  if (cupoMensual > 0 || cupoDiario > 0) {
    logger.log(
      `Cupo de correo: ${cupoMensual}/mes y ${cupoDiario}/día, con ${reservaMensual} y ${reservaDiaria} en reserva para lo esencial.`,
    );
  }

  const sinPasarela = falta('TROPIPAY_CLIENT_ID') && falta('MIBI_KEY_ID');
  if (sinPasarela) {
    logger.warn(
      'No hay ninguna pasarela de pago configurada: los pedidos solo podrán cobrarse a mano.',
    );
  }
}
