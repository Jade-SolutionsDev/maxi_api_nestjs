import { RoleResponseDto } from './role-response.dto';
import { ManagedRole } from '../entities/role.entity';

const rol = (extra: Partial<ManagedRole>): ManagedRole =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Economista',
    description: null,
    isSystem: false,
    systemKey: null,
    isActive: true,
    createdBy: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...extra,
  }) as ManagedRole;

describe('RoleResponseDto · systemKey', () => {
  // MxH-0103: el panel no podía distinguir los roles semilla de los creados a
  // mano, así que su columna «Tipo» decía «Personalizado» para todos y la
  // diferencia solo vivía pegada al nombre como «— base».
  it('expone el systemKey de un rol semilla', () => {
    const dto = RoleResponseDto.fromEntity(
      rol({ name: 'Almacenero — base', systemKey: 'GROCER' }),
    );
    expect(dto.systemKey).toBe('GROCER');
  });

  it('un rol creado a mano no tiene systemKey', () => {
    expect(RoleResponseDto.fromEntity(rol({})).systemKey).toBeNull();
  });
});
