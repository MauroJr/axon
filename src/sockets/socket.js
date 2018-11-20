'use strict';

const net = require('net');
const fs = require('fs');
const url = require('url');

const createEmitter = require('@bitbybit/emitter');
const createMessage = require('@bitbybit/amp-message');
const Parser = require('@bitbybit/amp').Stream;
const logger = require('pino')();

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

function createSocket({ settings = {}, plugins = [] }) {
  const emitter = createEmitter();
  const state = {
    type: undefined,
    server: undefined,
    socks: [],
    closing: false,
    connected: false,

    hwm: settings.hwm || Infinity,
    identity: settings.identity || String(process.pid),
    retryTimeout: settings.retryTimeout || 100,
    retryMaxTimeout: settings.retryMaxTimeout || 5000
  };

  const socket = Object.assign(
    {
      pack,
      close,
      closeServer,
      address,
      connect,
      bind
    },
    emitter
  );

  plugins.forEach(plugin => plugin(socket));

  return socket;

  function pack(payload) {
    const msg = createMessage(payload);
    return msg.toBuffer();
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
    logger.debug(`${state.type} closing`);
    state.closing = true;
    closeSockets();
    if (state.server) closeServer(fn);
  }

  /**
   * Close the server.
   *
   * @param {Function} [fn]
   * @api public
   */
  function closeServer(fn) {
    const { server } = state;

    logger.debug(`${state.type} closing server`);
    server.on('close', args => socket.emit('close', ...args));
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
    const { server } = state;

    if (!server) return;

    const addr = server.address();
    addr.string = `tcp://${addr.address}:${addr.port}`;
    return addr;
  }

  /**
   * Close all open underlying sockets.
   *
   * @api private
   */
  function closeSockets() {
    const { type, socks } = state;
    logger.debug(`${type} closing ${socks.length} connections.`);
    socks.forEach(sock => sock.destroy());
  }

  /**
   * Remove `sock`.
   *
   * @param {Socket} sock
   * @api private
   */
  function removeSocket(sock) {
    const { socks, type } = state;
    const index = socks.indexOf(sock);

    if (index === -1) return;

    logger.debug(`${type} remove socket ${index}`);
    socks.splice(index, 1);
  }

  /**
   * Add `sock`.
   *
   * @param {net.Socket} sock
   * @api private
   */
  function addSocket(sock) {
    const parser = new Parser();
    const index = state.socks.push(sock) - 1;

    logger.debug(`${state.type} add socket ${index}`);
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
    sock.on('error', (err) => {
      logger.error(`${state.type} error ${err.code || err.message}`);
      socket.emit('socket error', err);
      removeSocket(sock);
      if (!~ignore.indexOf(err.code)) return socket.emit('error', err);
      logger.debug(`${state.type} ignored ${err.code}`);
      socket.emit('ignored error', err);
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
   * @param {net.Socket} _sock
   * @return {Function} closure(msg, mulitpart)
   * @api private
   */
  // eslint-disable-next-line no-unused-vars
  function onMessage(_sock) {
    return function (buf) {
      const msg = createMessage(buf);
      socket.emit('message', ...msg.payload);
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
   * @param {string | function} host
   * @param {Function} [fn]
   * @return {Socket}
   * @api public
   */
  function connect(port, host, fn) {
    if (state.type === 'server') throw new Error('cannot connect() after bind()');
    if (typeof host === 'function') {
      fn = host;
      host = undefined;
    }

    if (typeof port === 'string') {
      const uri = url.parse(port);

      if (uri.protocol === 'unix:') {
        host = fn;
        fn = undefined;
        port = uri.pathname;
      } else {
        host = uri.hostname || '0.0.0.0';
        port = parseInt(uri.port, 10);
      }
    } else {
      host = host || '0.0.0.0';
    }

    const sock = new net.Socket();
    sock.setNoDelay();
    state.type = 'client';

    handleErrors(sock);

    sock.on('close', () => {
      socket.emit('socket close', sock);
      state.connected = false;
      removeSocket(sock);
      if (state.closing) return socket.emit('close');
      if (state.retryTimeout === 0) return;

      setTimeout(function () {
        logger.info(`${state.type} attempting reconnect`);
        socket.emit('reconnect attempt');
        sock.destroy();
        connect(
          port,
          host
        );
        state.retryTimeout = Math.round(Math.min(state.retryMaxTimeout, state.retryTimeout * 1.5));
      }, state.retryTimeout);
    });

    sock.on('connect', () => {
      logger.info(`${state.type} connect`);
      state.connected = true;
      addSocket(sock);
      socket.emit('connect', sock);
      if (fn) fn(sock);
    });

    logger.info(`${state.type} connect attempt ${host}:${port}`);
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
    logger.info(`${state.type} accept ${addr}`);
    addSocket(sock);
    handleErrors(sock);
    socket.emit('connect', sock);
    sock.on('close', () => {
      logger.info(`${state.type} disconnect ${addr}`);
      socket.emit('disconnect', sock);
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
   * @param {number|string} port
   * @param {function|string} [host]
   * @param {function} [fn]
   * @return {Socket}
   * @api public
   */
  function bind(port, host, fn) {
    if (state.type === 'client') throw new Error('cannot bind() after connect()');
    if (typeof host === 'function') {
      fn = host;
      host = undefined;
    }

    let unixSocket = false;

    if (typeof port === 'string') {
      const uri = url.parse(port);

      if (uri.protocol === 'unix:') {
        host = fn;
        fn = undefined;
        port = uri.pathname;
        unixSocket = true;
      } else {
        host = uri.hostname || '0.0.0.0';
        port = parseInt(uri.port, 10);
      }
    } else {
      host = host || '0.0.0.0';
    }

    state.type = 'server';

    state.server = net.createServer(onConnect);

    logger.info(`${state.type} bind ${host}:${port}`);
    state.server.on('listening', args => socket.emit('bind', ...args));

    if (unixSocket) {
      // TODO: move out
      state.server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
          // Unix file socket and error EADDRINUSE is the case if
          // the file socket exists. We check if other processes
          // listen on file socket, otherwise it is a stale socket
          // that we could reopen
          // We try to connect to socket via plain network socket
          const clientSocket = new net.Socket();

          clientSocket.on('error', (e2) => {
            if (e2.code === 'ECONNREFUSED') {
              // No other server listening, so we can delete stale
              // socket file and reopen server socket
              fs.unlinkSync(port);
              state.server.listen(port, host, fn);
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

    state.server.listen(port, host, fn);
    return socket;
  }
}
