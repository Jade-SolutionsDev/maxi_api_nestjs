import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTicketDto } from './ticket.dto';

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
