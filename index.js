'use strict';
/*jshint browser:true */

var Terminal = require('./term')
  , through = require('through')
  ;

module.exports = function (opts) {
  var term = new Terminal(opts);
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

  // convenience shortcuts
  hypernal.write   =  term.write.bind(term);
  hypernal.reset   =  term.reset.bind(term);
  hypernal.element =  term.element;

  // the underlying term for all other needs
  hypernal.term = term;

  return hypernal;
};
