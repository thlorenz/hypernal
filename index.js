'use strict';

var Terminal = require('./term')
  , through = require('through')
  ;

function style(parentElem) {
  var currentStyle = parentElem.getAttribute('style') || '';
  // TODO: make white-space work
  // white-space: pre has the following problem:
  // If applied before the terminal is visible, things break horribly to the point that the output is either
  // shifted to the left or not visible at all.
  // However when this style is set after the parent element became visible, it works fine.
  parentElem.setAttribute('style', currentStyle + 'overflow-y: auto; /* white-space: pre; */');
}

function scroll(elem) {
  if (!elem) return;
  elem.scrollTop = elem.scrollHeight;
}

module.exports = function (opts) {
  var term = new Terminal(opts);
  term.open();
  
  var hypernal = through(term.write.bind(term));
  hypernal.appendTo = function (parent) {
    if (typeof parent === 'string') parent = document.querySelector(parent);

    parent.appendChild(term.element);
    style(parent);
    hypernal.container = parent;
    term.element.style.position = 'relative';
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
