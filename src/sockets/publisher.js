'use strict';

/* eslint-disable */

const createSocket = require('./socket');
const { slice } = require('../utils');
const queue = require('../plugins/queue');

module.exports = createPubSocket;

function createPubSocket({ settings = {} }) {
  const state = {
    ready: false
  };

  const pubSocket = Object.assign(
    {
      send
    },
    createSocket({
      settings,
      plugins: [queue]
    })
  );

  pubSocket.on('bind', setReady);
  pubSocket.on('connect', setReady);

  return pubSocket;

  /**
   * Send `msg` to all established peers.
   *
   * @param {any} msg
   * @api public
   */
  function send(msg) {
    const socks = pubSocket.socks;
    const socksLen = socks.length;

    if (!state.ready) return pubSocket.enqueue(slice(arguments));

    const buf = pubSocket.pack(arguments);

    let index = 0;
    while (index < socksLen) {
      const sock = socks[index];
      if (sock.writable) sock.write(buf);
      index += 1;
    }

    return pubSocket;
  }

  function setReady() {
    state.ready = true;
  }
}
