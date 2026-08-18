const { isAbsolutePath } = require('../src/client/utils/pathValidation.js');

describe('isAbsolutePath', () => {
  test.each([
    ['/home/user/sessions', true],
    ['~/sessions', true],
    ['C:\\Users\\user\\sessions', true],
    ['D:/sessions', true],
    ['\\\\server\\share\\sessions', true],
    ['  C:\\Users\\user\\sessions  ', true],
    ['  \\\\server\\share\\sessions  ', true],
    ['relative/path', false],
    ['C:relative\\path', false],
    ['\\\\server', false],
    ['   ', false],
    ['', false],
    [null, false],
  ])('returns %s for %p', (value, expected) => {
    expect(isAbsolutePath(value)).toBe(expected);
  });
});
