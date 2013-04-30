'use strict';

module.exports = function off(el, type, handler, capture) {
  el.removeEventListener(type, handler, capture || false);
};
