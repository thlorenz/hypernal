'use strict';

var Terminal = require('..');

var term = new Terminal(100, 100, onData);

term.writeln('var a = 3;');

function onData(data) {
  console.log(data);
}
