'use strict';
/*jshint browser:true */

var Terminal = require('./term')
  , through = require('through')
  ;

function scroll(elem) {
  if (!elem) return;
  elem.scrollTop = elem.scrollHeight;
}

module.exports = function (opts) {
  opts = opts || {};
  var term = new Terminal(opts);
  term.open();
  
  var hypernal = through(term.write.bind(term));
  hypernal.appendTo = function (elem) {
    if (typeof elem === 'string') elem = document.querySelector(elem);

    elem.appendChild(term.element);
    elem.setAttribute('style', 'overflow-y : scroll;');
    hypernal.container = elem;
    term.element.style.position = 'relative';
  };

  hypernal.writeln = function (line) {
    term.writeln(line);
    if (opts.autoscroll) scroll(hypernal.container);
  };

  hypernal.write = function (data) {
    term.write(data);
    if (opts.autoscroll) scroll(hypernal.container);
  };

  // convenience shortcuts
  hypernal.reset   =  term.reset.bind(term);
  hypernal.element =  term.element;

  // the underlying term for all other needs
  hypernal.term = term;

  return hypernal;
};
