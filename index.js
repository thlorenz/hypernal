'use strict';

var Terminal = require('./term')
  , through = require('through')
  ;

function style(termElem) {
  var currentStyle = termElem.getAttribute('style') || '';
  termElem.setAttribute('style', currentStyle + 'overflow-y: auto; position: relative;');
}

function scroll(elem) {
  if (!elem) return;
  elem.scrollTop = elem.scrollHeight;
}

module.exports = function (opts) {
  var term = new Terminal(opts);
  term.open();
  
  var hypernal = through(term.write.bind(term));
  hypernal.appendTo = function (elem) {
    if (typeof elem === 'string') elem = document.querySelector(elem);

    elem.appendChild(term.element);
    style(elem);
    hypernal.container = elem;
  };

  hypernal.writeln = function (line) {
    term.writeln(line);
    if (hypernal.tail) scroll(hypernal.container);
  };

  hypernal.write = function (data) {
    term.write(data);
    if (hypernal.tail) scroll(hypernal.container);
  };

  // convenience shortcuts
  hypernal.reset   =  term.reset.bind(term);
  hypernal.element =  term.element;

  // the underlying term for all other needs
  hypernal.term = term;

  return hypernal;
};
