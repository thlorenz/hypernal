'use strict';
var states = require('../states');

module.exports = function (Terminal) {

  // ESC H Tab Set (HTS is 0x88).
  Terminal.prototype.tabSet = function() {
    this.tabs[this.x] = true;
    this.state = states.normal;
  };
};
