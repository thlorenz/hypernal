'use strict';

module.exports = function (Terminal) {
  Terminal.prototype.setgLevel = function(g) {
    this.glevel = g;
    this.charset = this.charsets[g];
  };
};
