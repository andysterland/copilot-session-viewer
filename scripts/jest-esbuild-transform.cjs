const esbuild = require('esbuild');

module.exports = {
  process(sourceText, sourcePath) {
    const result = esbuild.transformSync(sourceText, {
      format: 'cjs',
      loader: 'js',
      sourcefile: sourcePath,
      sourcemap: 'inline',
      target: 'node22',
    });

    return { code: result.code };
  },
};
