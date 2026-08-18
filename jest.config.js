module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'server.js',
    'src/**/*.js',
    '!node_modules/**',
    '!coverage/**'
  ],
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/*.test.js'
  ],
  transform: {
    '^.+[\\\\/]src[\\\\/]client[\\\\/].+\\.js$': '<rootDir>/scripts/jest-esbuild-transform.cjs',
    '^.+\\.js$': 'babel-jest'
  },
  verbose: true,
  maxWorkers: 4
};
