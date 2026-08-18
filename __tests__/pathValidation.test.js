const { execFileSync } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');

describe('isAbsolutePath', () => {
  const cases = [
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
  ];
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../src/client/utils/pathValidation.js')).href;
  const script = `
    import { isAbsolutePath } from ${JSON.stringify(moduleUrl)};
    const values = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(values.map(isAbsolutePath)));
  `;
  const results = JSON.parse(execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', script, JSON.stringify(cases.map(([value]) => value))],
    { encoding: 'utf8' }
  ));

  test.each(cases.map(([value, expected], index) => [value, expected, results[index]]))(
    'returns %s for %p',
    (_value, expected, result) => {
      expect(result).toBe(expected);
    }
  );
});
