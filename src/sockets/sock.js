// @ts-nocheck

'use strict';

/**
 * Module dependencies.
 */

const EventEmitter = require('eventemitter3');
const debug = require('debug')('axon:sock');
const Message = require('amp-message');
const Parser = require('@bitbybit/amp').Stream;
const url = require('url');
const net = require('net');
const fs = require('fs');
const { inherits } = require('util');

const { Configurable } = require('../utils');

/**
 * Errors to ignore.
 */
const ignore = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'ENOENT'
];

/**
 * Expose `Socket`.
 */
module.exports = Socket;

/**
 * Initialize a new `Socket`.
 *
 * A "Socket" encapsulates the ability of being
 * the "client" or the "server" depending on
 * whether `connect()` or `bind()` was called.
 *
 * @api private
 */
function Socket() {
  EventEmitter.call(this);
  this.server = null;
  this.socks = [];
  this.settings = {};
  this.set('hwm', Infinity);
  this.set('identity', String(process.pid));
  this.set('retry timeout', 100);
  this.set('retry max timeout', 5000);
}

/**
 * Inherit from `Emitter.prototype`.
 */
inherits(Socket, EventEmitter);

/**
 * Make it configurable `.set()` etc.
 */
Configurable(Socket.prototype);

/**
 * Use the given `plugin`.
 *
 * @param {Function} plugin
 * @api private
 */
Socket.prototype.use = function (plugin) {
  plugin(this);
  return this;
};

/**
 * Creates a new `Message` and write the `args`.
 *
 * @param {Array} args
 * @return {Buffer}
 * @api private
 */
Socket.prototype.pack = function (args) {
  var msg = new Message(args);
  return msg.toBuffer();
};

/**
 * Close all open underlying sockets.
 *
 * @api private
 */
Socket.prototype.closeSockets = function () {
  debug('%s closing %d connections', this.type, this.socks.length);
  this.socks.forEach(function (sock) {
    sock.destroy();
  });
};

/**
 * Close the socket.
 *
 * Delegates to the server or clients
 * based on the socket `type`.
 *
 * @param {Function} [fn]
 * @api public
 */
Socket.prototype.close = function (fn) {
  debug('%s closing', this.type);
  this.closing = true;
  this.closeSockets();
  if (this.server) this.closeServer(fn);
};

/**
 * Close the server.
 *
 * @param {Function} [fn]
 * @api public
 */
Socket.prototype.closeServer = function (fn) {
  debug('%s closing server', this.type);
  // @ts-ignore
  this.server.on('close', this.emit.bind(this, 'close'));
  this.server.close();
  if (fn) fn();
};

/**
 * Return the server address.
 *
 * @return {Object}
 * @api public
 */
Socket.prototype.address = function () {
  if (!this.server) return;
  const addr = this.server.address();
  // @ts-ignore
  addr.string = `tcp://${addr.address}:${addr.port}`;
  return addr;
};

/**
 * Remove `sock`.
 *
 * @param {Socket} sock
 * @api private
 */

Socket.prototype.removeSocket = function (sock) {
  var i = this.socks.indexOf(sock);
  if (!~i) return;
  debug('%s remove socket %d', this.type, i);
  this.socks.splice(i, 1);
};

/**
 * Add `sock`.
 *
 * @param {net.Socket} sock
 * @api private
 */
Socket.prototype.addSocket = function (sock) {
  var parser = new Parser();
  var i = this.socks.push(sock) - 1;
  debug('%s add socket %d', this.type, i);
  sock.pipe(parser);
  parser.on('data', this.onmessage(sock));
};

/**
 * Handle `sock` errors.
 *
 * Emits:
 *
 *  - `error` (err) when the error is not ignored
 *  - `ignored error` (err) when the error is ignored
 *  - `socket error` (err) regardless of ignoring
 *
 * @param {net.Socket} sock
 * @api private
 */
Socket.prototype.handleErrors = function (sock) {
  var self = this;
  sock.on('error', function (err) {
    debug('%s error %s', self.type, err.code || err.message);
    self.emit('socket error', err);
    self.removeSocket(sock);
    if (!~ignore.indexOf(err.code)) return self.emit('error', err);
    debug('%s ignored %s', self.type, err.code);
    self.emit('ignored error', err);
  });
};

/**
 * Handles framed messages emitted from the parser, by
 * default it will go ahead and emit the "message" events on
 * the socket. However, if the "higher level" socket needs
 * to hook into the messages before they are emitted, it
 * should override this method and take care of everything
 * it self, including emitted the "message" event.
 *
 * @param {net.Socket} _sock
 * @return {Function} closure(msg, mulitpart)
 * @api private
 */
// eslint-disable-next-line no-unused-vars
Socket.prototype.onmessage = function (_sock) {
  var self = this;

  return function (buf) {
    var msg = new Message(buf);
    // @ts-ignore
    self.emit(...['message'].concat(msg.args));
  };
};

/**
 * Connect to `port` at `host` and invoke `fn()`.
 *
 * Defaults `host` to localhost.
 *
 * TODO: needs big cleanup
 *
 * @param {Number|String} port
 * @param {String} host
 * @param {Function} fn
 * @return {Socket}
 * @api public
 */
Socket.prototype.connect = function (port, host, fn) {
  const self = this;
  if (this.type === 'server') throw new Error('cannot connect() after bind()');
  if (typeof host === 'function') {
    fn = host;
    host = undefined;
  }

  if (typeof port === 'string') {
    // @ts-ignore
    port = url.parse(port);

    // @ts-ignore
    if (port.protocol === 'unix:') {
      // @ts-ignore
      host = fn;
      fn = undefined;
      // @ts-ignore
      port = port.pathname;
    } else {
      // @ts-ignore
      host = port.hostname || '0.0.0.0';
      // @ts-ignore
      port = parseInt(port.port, 10);
    }
  } else {
    host = host || '0.0.0.0';
  }

  // @ts-ignore
  const max = self.get('retry max timeout');
  const sock = new net.Socket();
  sock.setNoDelay();
  this.type = 'client';

  this.handleErrors(sock);

  sock.on('close', function () {
    self.emit('socket close', sock);
    self.connected = false;
    self.removeSocket(sock);
    if (self.closing) return self.emit('close');
    const retry = self.retry || self.get('retry timeout');
    if (retry === 0) return;

    setTimeout(function () {
      debug('%s attempting reconnect', self.type);
      self.emit('reconnect attempt');
      sock.destroy();
      self.connect(
        port,
        host
      );
      self.retry = Math.round(Math.min(max, retry * 1.5));
    }, retry);
  });

  sock.on('connect', function () {
    debug('%s connect', self.type);
    self.connected = true;
    self.addSocket(sock);
    self.retry = self.get('retry timeout');
    self.emit('connect', sock);
    if (fn) fn(sock);
  });

  debug('%s connect attempt %s:%s', self.type, host, port);
  sock.connect(
    port,
    host
  );
  return this;
};

/**
 * Handle connection.
 *
 * @param {Socket} sock
 * @api private
 */

Socket.prototype.onconnect = function (sock) {
  var self = this;
  var addr = `${sock.remoteAddress}:${sock.remotePort}`;
  debug('%s accept %s', self.type, addr);
  this.addSocket(sock);
  this.handleErrors(sock);
  this.emit('connect', sock);
  sock.on('close', function () {
    debug('%s disconnect %s', self.type, addr);
    self.emit('disconnect', sock);
    self.removeSocket(sock);
  });
};

/**
 * Bind to `port` at `host` and invoke `fn()`.
 *
 * Defaults `host` to INADDR_ANY.
 *
 * Emits:
 *
 *  - `connection` when a client connects
 *  - `disconnect` when a client disconnects
 *  - `bind` when bound and listening
 *
 * @param {Number|String} port
 * @param {Function} fn
 * @return {Socket}
 * @api public
 */

Socket.prototype.bind = function (port, host, fn) {
  var self = this;
  if (this.type === 'client') throw new Error('cannot bind() after connect()');
  if (typeof host === 'function') {
    fn = host;
    host = undefined;
  }

  let unixSocket = false;

  if (typeof port === 'string') {
    port = url.parse(port);

    if (port.protocol === 'unix:') {
      host = fn;
      fn = undefined;
      port = port.pathname;
      unixSocket = true;
    } else {
      host = port.hostname || '0.0.0.0';
      port = parseInt(port.port, 10);
    }
  } else {
    host = host || '0.0.0.0';
  }

  this.type = 'server';

  this.server = net.createServer(this.onconnect.bind(this));

  debug('%s bind %s:%s', this.type, host, port);
  this.server.on('listening', this.emit.bind(this, 'bind'));

  if (unixSocket) {
    // TODO: move out
    this.server.on('error', function (e) {
      if (e.code === 'EADDRINUSE') {
        // Unix file socket and error EADDRINUSE is the case if
        // the file socket exists. We check if other processes
        // listen on file socket, otherwise it is a stale socket
        // that we could reopen
        // We try to connect to socket via plain network socket
        const clientSocket = new net.Socket();

        clientSocket.on('error', function (e2) {
          if (e2.code === 'ECONNREFUSED') {
            // No other server listening, so we can delete stale
            // socket file and reopen server socket
            fs.unlink(port);
            self.server.listen(port, host, fn);
          }
        });

        clientSocket.connect(
          { path: port },
          function () {
            // Connection is possible, so other server is listening
            // on this file socket
            throw e;
          }
        );
      }
    });
  }

  this.server.listen(port, host, fn);
  return this;
};
