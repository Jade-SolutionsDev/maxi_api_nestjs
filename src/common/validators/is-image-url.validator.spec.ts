import { esUrlDeImagen } from './is-image-url.validator';

describe('esUrlDeImagen', () => {
  // El caso de MxH-0086: guardar esto dejaba el catálogo sin cargar.
  it('rechaza un host sin dominio', () => {
    expect(esUrlDeImagen('https://x/p.png')).toBe(false);
  });

  it('acepta las imágenes que la tienda usa hoy', () => {
    expect(
      esUrlDeImagen('https://res.cloudinary.com/demo/image/upload/a.webp'),
    ).toBe(true);
    expect(
      esUrlDeImagen(
        'https://maxi-media-prod.s3.us-east-1.amazonaws.com/BANNER/a.webp',
      ),
    ).toBe(true);
  });

  it('acepta una ruta propia', () => {
    expect(esUrlDeImagen('/imagenes/producto.webp')).toBe(true);
  });

  it('acepta el almacenamiento local de desarrollo', () => {
    expect(esUrlDeImagen('http://localhost:9002/foto.webp')).toBe(true);
  });

  it('rechaza lo que no es una dirección', () => {
    expect(esUrlDeImagen('')).toBe(false);
    expect(esUrlDeImagen('   ')).toBe(false);
    expect(esUrlDeImagen('imagen.png')).toBe(false);
    expect(esUrlDeImagen('una imagen cualquiera')).toBe(false);
  });

  it('rechaza esquemas que no sirven una imagen', () => {
    expect(esUrlDeImagen('javascript:alert(1)')).toBe(false);
    expect(esUrlDeImagen('file:///etc/passwd')).toBe(false);
    expect(esUrlDeImagen('ftp://sitio.com/a.png')).toBe(false);
  });

  it('rechaza lo que no es texto', () => {
    expect(esUrlDeImagen(null)).toBe(false);
    expect(esUrlDeImagen(undefined)).toBe(false);
    expect(esUrlDeImagen(42)).toBe(false);
  });
});
