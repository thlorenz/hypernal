'use strict';

module.exports = function (Terminal) {
  // CSI Ps ; Ps r
  // Set Scrolling Region [top;bottom] (default = full size of win-
  // dow) (DECSTBM).
  // CSI ? Pm r
  Terminal.prototype.setScrollRegion = function(params) {
    if (this.prefix) return;
    this.scrollTop = (params[0] || 1) - 1;
    this.scrollBottom = (params[1] || this.rows) - 1;
    this.x = 0;
    this.y = 0;
  };

  // CSI Ps S Scroll up Ps lines (default = 1) (SU).
  Terminal.prototype.scrollUp = function(params) {
    var param = params[0] || 1;
    while (param--) {
      this.lines.splice(this.ybase + this.scrollTop, 1);
      this.lines.splice(this.ybase + this.scrollBottom, 0, this.blankLine());
    }
    // this.maxRange();
    this.updateRange(this.scrollTop);
    this.updateRange(this.scrollBottom);
  };


  // CSI Ps T Scroll down Ps lines (default = 1) (SD).
  Terminal.prototype.scrollDown = function(params) {
    var param = params[0] || 1;
    while (param--) {
      this.lines.splice(this.ybase + this.scrollBottom, 1);
      this.lines.splice(this.ybase + this.scrollTop, 0, this.blankLine());
    }
    // this.maxRange();
    this.updateRange(this.scrollTop);
    this.updateRange(this.scrollBottom);
  };

};
