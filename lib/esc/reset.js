'use strict';

module.exports = function (Terminal) {

  // ESC c Full Reset (RIS).
  Terminal.prototype.reset = function() {
    Terminal.call(this, this.cols, this.rows);
    this.refresh(0, this.rows - 1);
  };
};
