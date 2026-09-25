import { isCubanIdCard } from './cuban-id';

describe('isCubanIdCard', () => {
  it.each([
    ['91031512345', 'nacido en 1991'],
    ['04053067890', 'nacido en 2004 (dígito de siglo 6)'],
    ['00010112345', 'primero de enero de 1900'],
  ])('acepta %s — %s', (ci) => {
    expect(isCubanIdCard(ci)).toBe(true);
  });

  it.each([
    ['9103151234', 'diez dígitos'],
    ['910315123456', 'doce dígitos'],
    ['91031512345 6', 'con un espacio dentro'],
    ['9103151234a', 'con una letra'],
    ['', 'vacío'],
    // El caso que da sentido a validar la fecha y no solo la longitud.
    ['99023012345', '30 de febrero'],
    ['99043112345', '31 de abril'],
    ['99133012345', 'mes 13'],
    ['99000112345', 'mes 0'],
    ['99010012345', 'día 0'],
  ])('rechaza %s — %s', (ci) => {
    expect(isCubanIdCard(ci)).toBe(false);
  });

  it('rechaza lo que no es una cadena', () => {
    expect(isCubanIdCard(91031512345)).toBe(false);
    expect(isCubanIdCard(null)).toBe(false);
    expect(isCubanIdCard(undefined)).toBe(false);
  });

  it('tolera espacios alrededor, que es lo que llega de un formulario', () => {
    expect(isCubanIdCard('  91031512345  ')).toBe(true);
  });
});
