'use strict';

const net = require('net');
const fs = require('fs');
const url = require('url');

const EventEmitter = require('eventemitter3');
const Message = require('amp-message');
const Parser = require('@bitbybit/amp').Stream;
const debug = require('debug')('axon:sock');

class Socket extends EventEmitter {
  constructor() {}
}
