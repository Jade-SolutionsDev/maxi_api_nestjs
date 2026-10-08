import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateOrderStatusDto } from './update-order-status.dto';
import { OrderStatus } from '../entities/order.entity';

const errores = async (pickedUpBy: Record<string, unknown>) => {
  const dto = plainToInstance(UpdateOrderStatusDto, {
    status: OrderStatus.DELIVERED,
    pickedUpBy,
  });
  const fallos = await validate(dto, { whitelist: true });
  return JSON.stringify(fallos);
};

describe('UpdateOrderStatusDto · carné de quien retira', () => {
  // MxH-0111: «el campo de carnet acepta letras el tamaño q quieras CORREGIR».
  // El resto del sistema ya usaba @IsCubanIdCard(); este DTO se había quedado
  // con un @IsString() @MaxLength(20) que dejaba pasar cualquier cosa.
  it('rechaza letras', async () => {
    expect(await errores({ name: 'Ana Pérez', idCard: 'ajajaj' })).toContain(
      'idCard',
    );
  });

  it('rechaza un número que no tiene 11 dígitos', async () => {
    expect(await errores({ name: 'Ana Pérez', idCard: '123' })).toContain(
      'idCard',
    );
    expect(
      await errores({ name: 'Ana Pérez', idCard: '850423123456789' }),
    ).toContain('idCard');
  });

  it('rechaza una fecha de nacimiento imposible', async () => {
    // 30 de febrero
    expect(
      await errores({ name: 'Ana Pérez', idCard: '99023012345' }),
    ).toContain('idCard');
  });

  it('acepta un carné válido', async () => {
    expect(await errores({ name: 'Ana Pérez', idCard: '85042312345' })).toBe(
      '[]',
    );
  });

  it('sigue aceptando que no se anote el carné', async () => {
    expect(await errores({ name: 'Ana Pérez' })).toBe('[]');
  });
});
