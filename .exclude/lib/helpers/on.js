'use strict';

module.exports = function on(el, type, handler, capture) {
  el.addEventListener(type, handler, capture || false);
};
