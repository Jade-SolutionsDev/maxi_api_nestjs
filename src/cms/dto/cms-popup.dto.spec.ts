import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateCmsPopupDto } from './cms-popup.dto';

const base = { title: 'Envío gratis', body: 'Hasta el 31 de octubre.' };

const errores = (payload: unknown) =>
  validateSync(plainToInstance(CreateCmsPopupDto, payload), {
    whitelist: true,
  });

describe('CreateCmsPopupDto · a dónde puede llevar el botón', () => {
  const con = (buttonHref: string) =>
    errores({ ...base, buttonLabel: 'Ver', buttonHref });

  it('acepta una ruta de la tienda', () => {
    expect(con('/catalog')).toHaveLength(0);
    expect(con('/catalog?departamento=alimentos')).toHaveLength(0);
  });

  it('acepta una dirección http o https', () => {
    expect(con('https://maxihabana.com/catalog')).toHaveLength(0);
    expect(con('http://maxihabana.com')).toHaveLength(0);
  });

  it('rechaza javascript:, que sería código en el navegador del cliente', () => {
    // Quien redacta avisos no tiene por qué poder ejecutar código en la
    // tienda: esto acaba en un href que pulsa cualquiera que entre.
    expect(con('javascript:alert(1)').length).toBeGreaterThan(0);
    expect(con('JavaScript:alert(1)').length).toBeGreaterThan(0);
  });

  it('rechaza data: y otros esquemas', () => {
    expect(
      con('data:text/html,<script>alert(1)</script>').length,
    ).toBeGreaterThan(0);
    expect(con('vbscript:msgbox(1)').length).toBeGreaterThan(0);
    expect(con('file:///etc/passwd').length).toBeGreaterThan(0);
  });

  it('rechaza //otro-sitio.com, que el navegador lee como externo', () => {
    expect(con('//evil.example/phishing').length).toBeGreaterThan(0);
  });

  it('un aviso sin botón sigue valiendo', () => {
    expect(errores(base)).toHaveLength(0);
  });
});
