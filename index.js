'use strict';
/*jshint browser:true */

var Terminal = require('./term')
  , through = require('through')
  , colors = require('ansicolors')
  ;

module.exports = function (cols, rows, handler) {
  var term = new Terminal(cols, rows, handler);
  term.open();
  
  var hypernal = through(term.write.bind(term));
  hypernal.appendTo = function (elem) {
    if (typeof elem === 'string') elem = document.querySelector(elem);

    elem.appendChild(term.element);
    term.element.style.position = 'relative';
  };

  hypernal.writeln = function (line) {
    term.writeln(line);
  };

  hypernal.write = term.write.bind(term);

  return hypernal;
};
