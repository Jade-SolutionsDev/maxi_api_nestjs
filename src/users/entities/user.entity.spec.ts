import { instanceToPlain } from 'class-transformer';
import { getMetadataArgsStorage } from 'typeorm';
import { User } from './user.entity';

describe('User entity', () => {
  it('should expose the expected columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (column) => column.target === User,
    );
    const names = columns.map((column) => column.propertyName);

    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'clerkUserId',
        'firstName',
        'lastName',
        'email',
        'phone',
        'userType',
        'status',
        'passwordHash',
        'createdAt',
        'updatedAt',
        'deletedAt',
      ]),
    );
  });

  it('should mark id as primary generated uuid column', () => {
    const idColumn = getMetadataArgsStorage().columns.find(
      (column) => column.target === User && column.propertyName === 'id',
    );

    expect(idColumn).toBeDefined();
    expect(idColumn?.options.primary).toBe(true);
  });

  it('should mark email and clerkUserId as unique', () => {
    const uniques = getMetadataArgsStorage().uniques.filter(
      (unique) => unique.target === User,
    );
    const uniqueColumns = uniques.flatMap(
      (unique) => (unique.columns as string[]) ?? [],
    );

    expect(uniqueColumns).toContain('email');
    expect(uniqueColumns).toContain('clerkUserId');
  });

  it('should exclude passwordHash when serialized with class-transformer', () => {
    const user = new User();
    user.passwordHash = 'secret-hash';

    const plain = instanceToPlain(user);

    expect(plain.passwordHash).toBeUndefined();
  });
});
