'use strict';

/* eslint-disable */

const net = require('net');
const fs = require('fs');
const url = require('url');

const EventEmitter = require('eventemitter3');
const Message = require('amp-message');
const Parser = require('@bitbybit/amp').Stream;
const debug = require('debug')('axon:sock');

const addOne = num => {
  const result = num + 1;
  return result;
};

const negate = something => !something;

const customers = [
  {
    name: 'juju',
    age: 23
  },
  {
    name: 'lulu',
    age: 53
  },
  {
    name: 'mumu',
    age: 34
  },
  {
    name: 'xuxu',
    age: 13
  },
  {
    name: 'mimi',
    age: 25
  }
];

const sum = (acc, curr) => acc + curr;

const result = customers
  .map(customer => {
    return customer.age;
  })
  .reduce(sum);
