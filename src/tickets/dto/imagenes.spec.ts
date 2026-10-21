import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ChangeTicketStatusDto,
  CloseTicketDto,
  CreateTicketDto,
  ReopenTicketDto,
} from './ticket.dto';

/**
 * Qué direcciones de imagen entran en un ticket.
 *
 * Escrita a raíz de una revisión automática que señaló la ficha del panel por
 * pintar `<a href={url}>` con una dirección venida de la base de datos. El
 * esquema `javascript:` **ya se rechazaba**, pero por el valor por omisión de
 * la lista de protocolos de `@IsUrl` —algo que nadie había escrito y que se
 * pierde en cuanto alguien toque las opciones del decorador—. Esto lo fija.
 *
 * Y de paso destapó uno de verdad: `tickets/a.png`, sin esquema, **se aceptaba**
 * y se habría guardado para pintarse luego como un enlace relativo a la página
 * en la que estuvieras.
 */
describe('las imágenes de un ticket', () => {
  const conImagenes = async (images: string[]) => {
    const dto = plainToInstance(CreateTicketDto, {
      title: 'La impresora de etiquetas no imprime',
      description: 'Enciende pero saca las etiquetas en blanco.',
      categoryId: '00000000-0000-4000-8000-000000000000',
      images,
    });
    const errores = await validate(dto);
    return errores.some((e) => e.property === 'images');
  };

  it.each([
    'https://res.cloudinary.com/x/image/upload/v1/tickets/a.png',
    'http://localhost:9000/tickets/a.png',
  ])('acepta %s', async (url) => {
    expect(await conImagenes([url])).toBe(false);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '/tickets/a.png',
    'tickets/a.png',
    'res.cloudinary.com/x.png',
  ])('rechaza %s', async (url) => {
    expect(await conImagenes([url])).toBe(true);
  });

  it('una sola mala tumba la lista entera', async () => {
    expect(
      await conImagenes([
        'https://res.cloudinary.com/x/image/upload/v1/tickets/a.png',
        'javascript:alert(1)',
      ]),
    ).toBe(true);
  });

  it('más de seis no caben', async () => {
    const buena = 'https://res.cloudinary.com/x/image/upload/v1/tickets/a.png';
    expect(await conImagenes(Array(6).fill(buena))).toBe(false);
    expect(await conImagenes(Array(7).fill(buena))).toBe(true);
  });
});

/**
 * Lo que acepta el cuerpo de cada ruta, que es lo que comprueba el
 * `ValidationPipe` **antes** de que el controlador exista.
 *
 * Esto faltaba, y por eso el fallo llegó a staging: las pruebas del
 * controlador llaman a su método directamente y **se saltan el tubo**, así que
 * un cuerpo que el tubo rechaza pasa en verde ahí dentro. `POST
 * /tickets/:id/close` con el cuerpo vacío —el que tiene sentido escribir—
 * respondía 400 pidiendo un `status` que la ruta ignora.
 */
describe('el cuerpo de cerrar y reabrir', () => {
  const errores = async (
    Clase: new () => object,
    cuerpo: Record<string, unknown>,
  ) => validate(plainToInstance(Clase, cuerpo));

  it('cerrar acepta el cuerpo vacío: el estado lo pone la ruta', async () => {
    expect(await errores(CloseTicketDto, {})).toHaveLength(0);
  });

  it('cerrar acepta una nota, por si hay algo que añadir', async () => {
    expect(await errores(CloseTicketDto, { note: 'Comprobado' })).toHaveLength(
      0,
    );
  });

  it('reabrir exige la nota: deshacer un visto bueno se explica', async () => {
    const e = await errores(ReopenTicketDto, {});
    expect(e.map((x) => x.property)).toContain('note');
  });

  it('reabrir no acepta una nota de dos letras', async () => {
    const e = await errores(ReopenTicketDto, { note: 'ok' });
    expect(e.map((x) => x.property)).toContain('note');
  });

  it('mover de estado sí sigue exigiendo el estado', async () => {
    const e = await errores(ChangeTicketStatusDto, {});
    expect(e.map((x) => x.property)).toContain('status');
  });
});
