import { fechaEnCuba, fechaHoraEnCuba, mesEnCuba } from './zona';

describe('fechas en hora de Cuba', () => {
  // El proceso corre en UTC (main.ts), así que sin decir la zona todo sale
  // cuatro horas adelantado.
  it('el proceso está en UTC, que es la premisa de todo esto', () => {
    expect(process.env.TZ ?? 'UTC').toBe('UTC');
  });

  // Este es el caso que reportó Jade con ORD-20263351: el panel lo pintaba el
  // 23 a las 23:10 y el comprobante decía 24. No cambiaba solo la hora:
  // cambiaba el día.
  it('un pedido de la noche no se pasa al día siguiente', () => {
    const guardado = '2026-09-24T03:10:23.000Z'; // 23:10 del 23, en Cuba

    expect(fechaHoraEnCuba(guardado)).toContain('23/09/2026');
    expect(fechaEnCuba(guardado)).toBe('23/09/2026');
  });

  it('la hora es la de Cuba, no la del servidor', () => {
    // 15:41 UTC son las 11:41 de la mañana en La Habana.
    const texto = fechaHoraEnCuba('2026-09-28T15:41:00.000Z');

    expect(texto).toContain('28/09/2026');
    expect(texto).toMatch(/11:41/);
  });

  it('sin fecha no inventa una', () => {
    expect(fechaHoraEnCuba(null)).toBe('—');
    expect(fechaEnCuba(undefined)).toBe('—');
  });

  it('el mes también se lee en Cuba, no en UTC', () => {
    // 01:00 UTC del 1 de octubre son las 21:00 del 30 de septiembre allá.
    expect(mesEnCuba('2026-10-01T01:00:00.000Z')).toBe('septiembre');
  });
});
