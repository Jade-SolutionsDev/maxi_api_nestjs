import { shouldExposeDocs } from './swagger.util';

describe('shouldExposeDocs', () => {
  it('exposes docs only in local development', () => {
    expect(shouldExposeDocs('development')).toBe(true);
  });

  it.each(['staging', 'production', 'test', undefined])(
    'hides docs in %s',
    (env) => {
      expect(shouldExposeDocs(env)).toBe(false);
    },
  );
});
