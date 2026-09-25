import { feriadosCubanos, fechaEnCuba, finDelPlazo } from './business-days';

/** Un instante a mediodía en Cuba, para no pelear con el cambio de día. */
const mediodiaEnCuba = (fecha: string): Date => new Date(`${fecha}T16:00:00Z`);

describe('días hábiles', () => {
  describe('feriados cubanos', () => {
    it('trae los fijos del año', () => {
      const dias = feriadosCubanos(2026);

      expect(dias.has('2026-01-01')).toBe(true);
      expect(dias.has('2026-07-26')).toBe(true);
      expect(dias.has('2026-10-10')).toBe(true);
      expect(dias.has('2026-12-31')).toBe(true);
    });

    it('calcula el Viernes Santo, que se mueve cada año', () => {
      // Pascua 2026: 5 de abril → Viernes Santo, 3 de abril.
      expect(feriadosCubanos(2026).has('2026-04-03')).toBe(true);
      // Pascua 2027: 28 de marzo → Viernes Santo, 26 de marzo.
      expect(feriadosCubanos(2027).has('2027-03-26')).toBe(true);
    });

    it('no marca de más', () => {
      expect(feriadosCubanos(2026).has('2026-04-04')).toBe(false);
      expect(feriadosCubanos(2026).has('2026-03-08')).toBe(false);
    });
  });

  describe('fin del plazo', () => {
    it('el día en que se paga no cuenta', () => {
      // Lunes 7 de septiembre de 2026, plazo de 1 día → martes 8.
      const fin = finDelPlazo(mediodiaEnCuba('2026-09-07'), 1);

      expect(fechaEnCuba(fin as Date)).toBe('2026-09-08');
    });

    it('se salta el domingo', () => {
      // Sábado 5 de septiembre, plazo de 1 día → lunes 7, no domingo 6.
      const fin = finDelPlazo(mediodiaEnCuba('2026-09-05'), 1);

      expect(fechaEnCuba(fin as Date)).toBe('2026-09-07');
    });

    it('se salta un feriado', () => {
      // Jueves 24 de septiembre... mejor un caso real: viernes 24 de julio de
      // 2026 con plazo 1 cae en el 25, 26 y 27 de julio, que son feriados, y
      // el domingo. El primer hábil es el martes 28.
      const fin = finDelPlazo(mediodiaEnCuba('2026-07-24'), 1);

      expect(fechaEnCuba(fin as Date)).toBe('2026-07-28');
    });

    it('cuenta varios días saltando lo que no cuenta', () => {
      // Jueves 31 de diciembre de 2026 es feriado; el 1 y 2 de enero también,
      // y el 3 de enero de 2027 es domingo. Con plazo 2 desde el miércoles 30:
      // lunes 4 y martes 5 → vence el martes 5 de enero.
      const fin = finDelPlazo(mediodiaEnCuba('2026-12-30'), 2);

      expect(fechaEnCuba(fin as Date)).toBe('2027-01-05');
    });

    it('vence al final del día, no al principio', () => {
      const fin = finDelPlazo(mediodiaEnCuba('2026-09-07'), 1) as Date;

      // Las 23:59:59 en Cuba, que en septiembre son las 03:59:59 UTC del día
      // siguiente: un pedido entregado esa tarde llegó a tiempo.
      expect(fin.toISOString()).toBe('2026-09-09T03:59:59.000Z');
    });

    it('sin plazo no hay fecha que prometer', () => {
      expect(finDelPlazo(new Date(), null)).toBeNull();
      expect(finDelPlazo(new Date(), 0)).toBeNull();
    });

    it('cuenta en hora de Cuba, no en UTC', () => {
      // Sábado 5 de septiembre a las 21:00 en Cuba son las 01:00 UTC del
      // domingo. Contando en UTC el plazo saldría un día más tarde.
      const sabadoTarde = new Date('2026-09-06T01:00:00Z');

      expect(fechaEnCuba(sabadoTarde)).toBe('2026-09-05');
      expect(fechaEnCuba(finDelPlazo(sabadoTarde, 1) as Date)).toBe(
        '2026-09-07',
      );
    });
  });
});
