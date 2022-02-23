module.exports = {
  norpc: true,
  testCommand: "npm run test",
  compileCommand: "npm run compile",
  skipFiles: [
    'interfaces/',
    'oz/',
    'test/'
  ],
  mocha: {
    fgrep: "[skip-on-coverage]",
    invert: true,
  },
};