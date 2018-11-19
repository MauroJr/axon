'use strict';

const net = require('net');
const fs = require('fs');
const url = require('url');

const EventEmitter = require('eventemitter3');
const Message = require('amp-message');
const Parser = require('@bitbybit/amp').Stream;
const debug = require('debug')('axon:sock');

module.exports = createSocket;

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

function createSocket(opts = {}) {
  const emitter = new EventEmitter();
  const settings = {
    hwm: opts.hwm || Infinity,
    identity: opts.identity || String(process.pid),
    retryTimeout: opts.retryTimeout || 100,
    retryMaxTimeout: opts.retryMaxTimeout || 5000
  };

  const socks = [];
  let retry;
  let type;
  let closing = false;
  let connected = false;
  let server;

  return {
    on(evt, listener) {
      emitter.on(evt, listener);
      return this;
    },
    once(evt, listener) {
      emitter.once(evt, listener);
      return this;
    },
    off(evt, listener) {
      emitter.off(evt, listener);
      return this;
    },
    emit(evt, ...args) {
      emitter.emit(evt, ...args);
      return this;
    },
    settings,
    use,
    close,
    closeServer,
    address,
    connect,
    bind,
    socks,
    pack,
    connected: () => connected
  };

  /**
   * Close all open underlying sockets.
   *
   * @api private
   */
  function closeSockets() {
    debug('%s closing %d connections', type, socks.length);
    socks.forEach(sock => sock.destroy());
  }

  /**
   * Close the socket.
   *
   * Delegates to the server or clients
   * based on the socket `type`.
   *
   * @param {Function} [fn]
   * @api public
   */
  function close(fn) {
    debug('%s closing', type);
    closing = true;
    closeSockets();
    if (server) closeServer(fn);
  }

  /**
   * Close the server.
   *
   * @param {Function} [fn]
   * @api public
   */
  function closeServer(fn) {
    debug('%s closing server', type);
    // @ts-ignore
    server.on('close', emitter.emit('close'));
    server.close();
    if (fn) fn();
  }

  /**
   * Return the server address.
   *
   * @return {Object}
   * @api public
   */
  function address() {
    if (!server) return;
    const addr = server.address();
    // @ts-ignore
    addr.string = `tcp://${addr.address}:${addr.port}`;
    return addr;
  }

  /**
   * Remove `sock`.
   *
   * @param {net.Socket} sock
   * @api private
   */
  function removeSocket(sock) {
    const i = socks.indexOf(sock);
    if (i === -1) return;
    debug('%s remove socket %d', type, i);
    socks.splice(i, 1);
  }

  /**
   * Add `sock`.
   *
   * @param {net.Socket} sock
   * @api private
   */
  function addSocket(sock) {
    const parser = new Parser();
    const i = socks.push(sock) - 1;
    debug('%s add socket %d', type, i);
    sock.pipe(parser);
    parser.on('data', onMessage(sock));
  }

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
  function handleErrors(sock) {
    sock.on('error', function (err) {
      debug('%s error %s', type, err.code || err.message);
      emitter.emit('socket error', err);
      removeSocket(sock);
      if (ignore.indexOf(err.code) === -1) {
        return emitter.emit('error', err);
      }
      debug('%s ignored %s', type, err.code);
      emitter.emit('ignored error', err);
    });
  }

  /**
   * Handles framed messages emitted from the parser, by
   * default it will go ahead and emit the "message" events on
   * the socket. However, if the "higher level" socket needs
   * to hook into the messages before they are emitted, it
   * should override this method and take care of everything
   * it self, including emitted the "message" event.
   *
   * @param {net.Socket} sock
   * @return {Function} closure(msg, mulitpart)
   * @api private
   */
  // eslint-disable-next-line no-unused-vars
  function onMessage(sock) {
    return function (buf) {
      const msg = new Message(buf);
      // @ts-ignore
      emitter.emit(...['message'].concat(msg.args));
    };
  }

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
  function connect(port, host, fn) {
    if (type === 'server') {
      throw new Error('cannot connect() after bind()');
    }

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
    const max = settings.retryMaxTimeout;
    const sock = new net.Socket();
    sock.setNoDelay();
    type = 'client';

    handleErrors(sock);

    sock.on('close', function () {
      emitter.emit('socket close', sock);
      connected = false;
      removeSocket(sock);
      if (closing) return emitter.emit('close');
      retry = retry || settings.retryTimeout;
      if (retry === 0) return;

      setTimeout(function () {
        debug('%s attempting reconnect', type);
        emitter.emit('reconnect attempt');
        sock.destroy();
        connect(
          port,
          host
        );
        retry = Math.round(Math.min(max, retry * 1.5));
      }, retry);
    });

    sock.on('connect', function () {
      debug('%s connect', type);
      connected = true;
      addSocket(sock);
      retry = settings.retryTimeout;
      emitter.emit('connect', sock);
      if (fn) fn(sock);
    });

    debug('%s connect attempt %s:%s', type, host, port);
    sock.connect(
      port,
      host
    );
    return this;
  }

  /**
   * Handle connection.
   *
   * @param {Socket} sock
   * @api private
   */

  function onConnect(sock) {
    const addr = `${sock.remoteAddress}:${sock.remotePort}`;
    debug('%s accept %s', type, addr);
    addSocket(sock);
    handleErrors(sock);
    emitter.emit('connect', sock);
    sock.on('close', function () {
      debug('%s disconnect %s', type, addr);
      emitter.emit('disconnect', sock);
      removeSocket(sock);
    });
  }

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
   * @return {net.Socket}
   * @api public
   */
  function bind(port, host, fn) {
    if (type === 'client') {
      throw new Error('cannot bind() after connect()');
    }

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

    type = 'server';

    server = net.createServer(onConnect);

    debug('%s bind %s:%s', type, host, port);
    server.on('listening', () => emitter.emit('bind'));

    server.on('error', (err) => {
      if (unixSocket) {
        if (err.code === 'EADDRINUSE') {
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
              fs.unlink(port, () => {
                server.listen(port, host, fn);
              });
            }
          });

          clientSocket.connect(
            { path: port },
            function () {
              // Connection is possible, so other server is listening
              // on this file socket
              throw err;
            }
          );
        }
      } else {
        debug(err);
        throw err;
      }
    });

    server.listen(port, host, fn);
    return this;
  }
}

/**
 * Use the given `plugin`.
 *
 * @param {Function} plugin
 * @api private
 */
function use(plugin) {
  plugin(this);
  return this;
}

/**
 * Creates a new `Message` and write the `args`.
 *
 * @param {Array} args
 * @return {Buffer}
 * @api private
 */
function pack(args) {
  const msg = new Message(args);
  return msg.toBuffer();
}
