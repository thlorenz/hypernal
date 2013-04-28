'use strict';

module.exports = function inherits(child, parent) {
  function F() {
      this.constructor = child;
  }
  F.prototype = parent.prototype;
  child.prototype = new F();
};
