'use strict';

/* eslint-disable */

const logger = require('pino')();
var escape = require('escape-regexp');
var Message = require('@bitbybit/amp-message');
var createSocket = require('./socket');

/**
 * Expose `SubSocket`.
 */

module.exports = createSubSocket;

/**
 * Initialize a new `SubSocket`.
 *
 * @api private
 */

function createSubSocket({ settings = {} }) {
  const subscriptions = [];

  const subSocket = Object.assign(
    {
      hasSubscriptions,
      matches,
      onmessage,
      subscribe,
      unsubscribe,
      clearSubscriptions,
      send
    },
    createSocket({ settings })
  );

  return subSocket;

  /**
   * Check if this socket has subscriptions.
   *
   * @return {Boolean}
   * @api public
   */

  function hasSubscriptions() {
    return !!subscriptions.length;
  }

  /**
   * Check if any subscriptions match `topic`.
   *
   * @param {String} topic
   * @return {Boolean}
   * @api public
   */

  function matches(topic) {
    const subsLen = subscriptions.length;

    let index = 0;
    while (index < subsLen) {
      if (subscriptions[index].test(topic)) {
        return true;
      }
      index += 1;
    }

    return false;
  }

  /**
   * Message handler.
   *
   * @param {net.Socket} sock
   * @return {Function} closure(msg, mulitpart)
   * @api private
   */
  function onmessage(sock) {
    return function(buf) {
      const msg = new Message(buf);

      if (hasSubscriptions) {
        const topic = msg.payload[0];
        if (!matches(topic)) return logger.info(`not subscribed to "${topic}"`);
      }

      subSocket.emit('message', ...msg.payload);
    };
  }

  /**
   * Subscribe with the given `re`.
   *
   * @param {RegExp|String} re
   * @return {RegExp}
   * @api public
   */
  function subscribe(re) {
    logger.info(`subscribe to "${re}`);
    subscriptions.push((re = toRegExp(re)));
    return re;
  }

  /**
   * Unsubscribe with the given `re`.
   *
   * @param {RegExp|String} re
   * @api public
   */

  function unsubscribe(re) {
    logger.info(`unsubscribe from "${re}"`);
    re = toRegExp(re);

    let index = subscriptions.length - 1;
    while (index > -1) {
      if (subscriptions[index].toString() === re.toString()) {
        subscriptions.splice(index, 1);
        index -= 1;
      }
    }
  }

  /**
   * Clear current subscriptions.
   *
   * @api public
   */
  function clearSubscriptions() {
    subscriptions.length = 0;
  }

  /**
   * Subscribers should not send messages.
   */
  function send() {
    throw new Error('subscribers cannot send messages');
  }
}

/**
 * Convert `str` to a `RegExp`.
 *
 * @param {String} str
 * @return {RegExp}
 * @api private
 */
function toRegExp(str) {
  if (str instanceof RegExp) return str;
  str = escape(str);
  str = str.replace(/\\\*/g, '(.+)');
  return new RegExp(`^${str}$`);
}
