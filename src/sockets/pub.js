'use strict';

/**
 * Module dependencies.
 */
const { inherits } = require('util');

const Socket = require('./sock');
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
  Socket.call(this);

  const self = this;

  this.ready = false;
  this.use(queue());

  function ready() {
    self.ready = true;
  }

  this.on('bind', ready);
  this.on('connect', ready);
}

/**
 * Inherits from `Socket.prototype`.
 */
inherits(PubSocket, Socket);

/**
 * Send `msg` to all established peers.
 *
 * @param {any} msg
 * @api public
 */
PubSocket.prototype.send = function (msg) {
  var socks = this.socks;
  var len = socks.length;
  var sock;

  if (!this.ready) return this.enqueue(slice(arguments));

  var buf = this.pack(arguments);

  for (var i = 0; i < len; i++) {
    sock = socks[i];
    if (sock.writable) sock.write(buf);
  }

  return this;
};
