'use strict';

module.exports = function (Terminal) {
  Terminal.prototype.scrollDisp = function(disp) {
    this.ydisp += disp;

    if (this.ydisp > this.ybase) {
      this.ydisp = this.ybase;
    } else if (this.ydisp < 0) {
      this.ydisp = 0;
    }

    this.refresh(0, this.rows - 1);
  };
};
