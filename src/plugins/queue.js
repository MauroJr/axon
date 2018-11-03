'use strict';

/**
 * Module dependencies.
 */

const debug = require('debug')('axon:queue');

/**
 * Queue plugin.
 *
 * Provides an `.enqueue()` method to the `sock`. Messages
 * passed to `enqueue` will be buffered until the next
 * `connect` event is emitted.
 *
 * Emits:
 *
 *  - `drop` (msg) when a message is dropped
 *  - `flush` (msgs) when the queue is flushed
 *
 * @param {Object} [options]
 * @api private
 */
// eslint-disable-next-line no-unused-vars
module.exports = function (options = {}) {
  return function (sock) {
    /**
     * Message buffer.
     */

    sock.queue = [];

    /**
     * Flush `buf` on `connect`.
     */

    sock.on('connect', function () {
      var prev = sock.queue;
      var len = prev.length;
      var i;

      sock.queue = [];
      debug('flush %d messages', len);

      for (i = 0; i < len; i += 1) {
        this.send(...prev[i]);
      }

      sock.emit('flush', prev);
    });

    /**
     * Pushes `msg` into `buf`.
     */

    sock.enqueue = function (msg) {
      var hwm = sock.settings.hwm;
      if (sock.queue.length >= hwm) return drop(msg);
      sock.queue.push(msg);
    };

    /**
     * Drop the given `msg`.
     */

    function drop(msg) {
      debug('drop');
      sock.emit('drop', msg);
    }
  };
};
