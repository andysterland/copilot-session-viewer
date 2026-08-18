const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\[^\\]+\\[^\\]+/;

function isAbsolutePath(value) {
  return typeof value === 'string' && (
    value.startsWith('/')
    || value.startsWith('~')
    || WINDOWS_DRIVE_PATH.test(value)
    || WINDOWS_UNC_PATH.test(value)
  );
}

module.exports = { isAbsolutePath };
