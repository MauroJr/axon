'use strict';

/* eslint-disable */

const logger = require('pino')();

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
module.exports = queue;

function queue(sock) {
  /**
   * Message buffer.
   */

  sock.queue = [];

  /**
   * Flush `buf` on `connect`.
   */

  sock.on('connect', () => {
    const prev = sock.queue;
    const prevLen = prev.length;
    var i;

    sock.queue = [];
    logger.info(`flush ${prevLen} messages`);

    let index = 0;
    while (index < prevLen) {
      sock.send(...prev[index]);
      index += 1;
    }

    sock.emit('flush', prev);
  });

  /**
   * Pushes `msg` into `buf`.
   */

  sock.enqueue = function(msg) {
    if (sock.queue.length >= sock.hwm) return drop(msg);
    sock.queue.push(msg);
  };

  /**
   * Drop the given `msg`.
   */

  function drop(msg) {
    logger.info('drop');
    sock.emit('drop', msg);
  }
}
