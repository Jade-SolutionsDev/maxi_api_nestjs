import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClerkLookupQueryDto } from './clerk-lookup-query.dto';

/**
 * Lo que comprueba el `ValidationPipe` global antes de que el controlador
 * exista (MxH-0181). Aquí se corre `validate` a mano, que es lo mismo que el
 * tubo ejecuta: si estas aserciones pasan, la ruta responde 400 y no 500.
 */
describe('ClerkLookupQueryDto', () => {
  const errores = async (entrada: unknown) =>
    validate(plainToInstance(ClerkLookupQueryDto, entrada));

  it('acepta un clerkId de verdad', async () => {
    expect(await errores({ clerkId: 'user_2abcDEF' })).toHaveLength(0);
  });

  it('rechaza que falte, que es el caso que daba 500', async () => {
    const e = await errores({});
    expect(e.map((x) => x.property)).toContain('clerkId');
  });

  it('rechaza la cadena vacía, que no es un identificador', async () => {
    const e = await errores({ clerkId: '' });
    expect(e.map((x) => x.property)).toContain('clerkId');
  });

  it('rechaza que venga repetido, que llega como lista', async () => {
    // `?clerkId=a&clerkId=b` le da a Express un array, no una cadena: sin esto
    // el `where` recibiría el array y volvería a fallar por dentro.
    const e = await errores({ clerkId: ['a', 'b'] });
    expect(e.map((x) => x.property)).toContain('clerkId');
  });
});
