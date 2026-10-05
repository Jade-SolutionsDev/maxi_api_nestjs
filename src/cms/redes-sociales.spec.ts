import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DEFAULT_SITE_SETTINGS } from './cms.service';
import {
  conRedes,
  SiteSettingsResponseDto,
  UpdateSiteSettingsDto,
} from './dto/cms-site-settings.dto';
import type { CmsSiteSettings } from './entities/cms-site-settings.entity';
import { paymentReceived } from '../mail/templates';

/**
 * MxH-0119, el tercio que faltaba: las redes se editan desde el panel.
 *
 * Estaban escritas en código y, peor, en DOS repos —`redes-sociales.ts` en la
 * tienda y `REDES` en las plantillas de correo—. Cambiar de perfil obligaba a
 * tocar los dos y publicar los dos; que hoy coincidan es suerte, no diseño.
 *
 * Es una lista y no `{ facebook, instagram }` porque la propia tarjeta escribe
 * «social: { facebook, instagram, ... }»: ese «...» quiere decir que mañana hay
 * un TikTok, y con una lista eso no toca ni el esquema ni el código.
 */
const ajustes = (social: unknown) =>
  plainToInstance(UpdateSiteSettingsDto, {
    ...DEFAULT_SITE_SETTINGS,
    social,
  });

describe('MxH-0119 · las redes viven en los ajustes del sitio', () => {
  it('los valores por defecto traen las dos que ya se publicaban', () => {
    const etiquetas = DEFAULT_SITE_SETTINGS.social.map((r) => r.label);
    expect(etiquetas).toEqual(['Facebook', 'Instagram']);
    // Los mismos enlaces que estaban en código, para que nada cambie el día
    // que esto se despliegue sin que nadie haya tocado el panel.
    expect(DEFAULT_SITE_SETTINGS.social[1].url).toBe(
      'https://www.instagram.com/maxihabana',
    );
  });

  it('acepta una red más sin tocar nada', async () => {
    const dto = ajustes([
      { label: 'Facebook', url: 'https://www.facebook.com/maxi' },
      { label: 'TikTok', url: 'https://www.tiktok.com/@maxihabana' },
    ]);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('acepta quedarse sin ninguna', async () => {
    expect(await validate(ajustes([]))).toHaveLength(0);
  });

  it('rechaza algo que no es una dirección', async () => {
    const errores = await validate(ajustes([{ label: 'X', url: 'no-es-url' }]));
    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza una red sin nombre', async () => {
    const errores = await validate(
      ajustes([{ label: '', url: 'https://x.com' }]),
    );
    expect(errores.length).toBeGreaterThan(0);
  });

  it('no deja colar un javascript: en el enlace', async () => {
    // Ese enlace acaba en el pie de la tienda y en ocho plantillas de correo.
    const errores = await validate(
      ajustes([{ label: 'X', url: 'javascript:alert(1)' }]),
    );
    expect(errores.length).toBeGreaterThan(0);
  });
});

describe('el pie del correo usa las redes configuradas', () => {
  it('pinta las que le pasan, no las de código', () => {
    const { html } = paymentReceived({
      orderNumber: 'ORD-1',
      customerName: 'Merly',
      total: '60.00',
      currency: 'USD',
      pickupAddress: null,
      whatsapp: '+53 5251 9414',
      storeUrl: 'https://maxihabana.com',
      orderUrl: null,
      trackingUrl: null,
      redes: [{ label: 'TikTok', url: 'https://www.tiktok.com/@maxihabana' }],
    });
    expect(html).toContain('tiktok.com/@maxihabana');
    expect(html).toContain('TikTok');
    // Y no cuela las antiguas por detrás.
    expect(html).not.toContain('facebook.com');
  });

  it('sin redes configuradas, el pie no queda roto', () => {
    const { html } = paymentReceived({
      orderNumber: 'ORD-1',
      customerName: 'Merly',
      total: '60.00',
      currency: 'USD',
      pickupAddress: null,
      whatsapp: '+53 5251 9414',
      storeUrl: 'https://maxihabana.com',
      orderUrl: null,
      trackingUrl: null,
      redes: [],
    });
    expect(html).toContain('ORD-1');
    expect(html).not.toContain('facebook.com');
  });
});

/**
 * La fila que ya está guardada en staging y en producción se escribió antes de
 * que `social` existiera. Si al leerla no se rellena, pasan dos cosas malas:
 * el panel abre la lista vacía, y el PATCH —que reemplaza el documento entero—
 * borra las redes en cuanto alguien guarde cualquier otra cosa.
 */
describe('una fila guardada antes de que el campo existiera', () => {
  const sinRedes = () => {
    const { social: _fuera, ...resto } = DEFAULT_SITE_SETTINGS;
    return resto as typeof DEFAULT_SITE_SETTINGS;
  };

  it('se lee con las redes de siempre, no vacía', () => {
    expect(conRedes(sinRedes(), DEFAULT_SITE_SETTINGS).social).toEqual(
      DEFAULT_SITE_SETTINGS.social,
    );
  });

  it('y el panel la recibe igual, para no borrarlas al guardar', () => {
    const fila = {
      data: sinRedes(),
      updatedAt: new Date('2026-09-30T00:00:00Z'),
    } as CmsSiteSettings;
    const dto = SiteSettingsResponseDto.fromEntity(fila, DEFAULT_SITE_SETTINGS);
    expect(dto.data.social.map((r) => r.label)).toEqual([
      'Facebook',
      'Instagram',
    ]);
  });

  it('pero una lista vacía a propósito se respeta', () => {
    const guardado = { ...DEFAULT_SITE_SETTINGS, social: [] };
    expect(conRedes(guardado, DEFAULT_SITE_SETTINGS).social).toEqual([]);
  });
});
