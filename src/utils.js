'use strict';

/* eslint-disable */

/**
 * Slice helper.
 *
 * @api private
 * @param {arguments} args
 * @return {Array}
 */
exports.slice = function(args) {
  const len = args.length;
  const ret = new Array(len);
  let i;

  for (i = 0; i < len; i += 1) {
    ret[i] = args[i];
  }

  return ret;
};

/**
 * Make `obj` configurable.
 *
 * @param {Object} obj
 * @return {Object} the `obj`
 * @api public
 */
exports.Configurable = function Configurable(obj) {
  obj.settings = {};

  obj.set = function(name, val) {
    if (arguments.length === 1) {
      // eslint-disable-next-line guard-for-in
      for (const key in name) {
        this.set(key, name[key]);
      }
    } else {
      this.settings[name] = val;
    }

    return this;
  };

  obj.get = function(name) {
    return this.settings[name];
  };

  obj.enable = function(name) {
    return this.set(name, true);
  };

  obj.disable = function(name) {
    return this.set(name, false);
  };

  obj.enabled = function(name) {
    return !!this.get(name);
  };

  obj.disabled = function(name) {
    return !this.get(name);
  };

  return obj;
};
