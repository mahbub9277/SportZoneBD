/**
 * Creates an object composed of the picked object properties.
 * Safely extracts only specified keys from a source object.
 * @param {object} object - The source object (can be null/undefined).
 * @param {string[]} keys - The property keys to pick.
 * @returns {object} Returns a new object with only the picked properties.
 * @throws {TypeError} If keys is not an array.
 * @example
 *   pick({ a: 1, b: 2, c: 3 }, ['a', 'c']) // => { a: 1, c: 3 }
 *   pick(null, ['a']) // => {}
 */
export const pick = (object, keys) => {
  if (!Array.isArray(keys)) {
    throw new TypeError('Keys argument must be an array');
  }

  if (!object || typeof object !== 'object') {
    return {};
  }

  return keys.reduce((result, key) => {
    if (typeof key !== 'string') {
      return result;
    }

    if (Object.prototype.hasOwnProperty.call(object, key)) {
      result[key] = object[key];
    }

    return result;
  }, {});
};