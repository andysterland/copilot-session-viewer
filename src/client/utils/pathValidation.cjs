const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\[^\\]+\\[^\\]+/;

function isAbsolutePath(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length === 0) return false;

  return (
    v.startsWith('/')
    || v.startsWith('~')
    || WINDOWS_DRIVE_PATH.test(v)
    || WINDOWS_UNC_PATH.test(v)
  );
}

module.exports = { isAbsolutePath };
