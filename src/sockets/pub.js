'use strict';

/* eslint-disable */

/**
 * Module dependencies.
 */

const createSocket = require('./create-socket');
const { slice } = require('../utils');
const queue = require('../plugins/queue');

/**
 * Expose `PubSocket`.
 */

module.exports = PubSocket;

/**
 * Initialize a new `PubSocket`.
 *
 * @api private
 */
function PubSocket() {
  const socket = createSocket();
  let ready = false;

  socket.use(queue());

  socket.on('bind', setReady);
  socket.on('connect', setReady);

  return Object.assign(
    {
      send
    },
    socket
  );

  function setReady() {
    ready = true;
  }

  /**
   * Send `msg` to all established peers.
   *
   * @param {any} msg
   * @api public
   */
  function send(msg) {
    var socks = socket.socks;
    var len = socks.length;
    var sock;
    var i;

    if (!ready) return socket.enqueue(slice(arguments));

    const buf = socket.pack(arguments);

    for (i = 0; i < len; i += 1) {
      sock = socks[i];
      if (sock.writable) sock.write(buf);
    }

    return this;
  }
}
