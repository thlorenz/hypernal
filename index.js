'use strict';

var Terminal = require('./term')
  , through = require('through')
  ;

function style(parentElem) {
  var currentStyle = parentElem.getAttribute('style') || '';
  // TODO: make white-space work
  // white-space: pre has the following problem:
  // If applied before the terminal is visible, things break horribly 
  // to the point that the output is either shifted to the left or not visible at all.
  // (at least for hyperwatch, to repro: -- npm install hyperwatch; npm explore hyperwatch; npm run demo; ) 
  //  - most likely due to the fact that hyperwatch is positioned absolute
  //
  // However when this style is set after the parent element became visible, it works fine.
  parentElem.setAttribute('style', currentStyle + 'overflow-y: auto; /* white-space: pre; */');
}

function scrollToBottom(elem) {
  if (!elem) return;
  elem.scrollTop = elem.scrollHeight;
}

function isScrolledToBottom(elem) {
  return !!elem && elem.scrollHeight - elem.clientHeight <= elem.scrollTop + 1;
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
    var shouldScrollToBottom = hypernal.tail && isScrolledToBottom(hypernal.container);
    term.writeln(line);
    if (shouldScrollToBottom) scrollToBottom(hypernal.container);
  };

  hypernal.write = function (data) {
    var shouldScrollToBottom = hypernal.tail && isScrolledToBottom(hypernal.container);
    term.write(data);
    if (shouldScrollToBottom) scrollToBottom(hypernal.container);
  };

  // convenience shortcuts
  hypernal.reset   =  term.reset.bind(term);
  hypernal.element =  term.element;

  // the underlying term for all other needs
  hypernal.term = term;

  return hypernal;
};
