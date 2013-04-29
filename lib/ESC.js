'use strict';
var states = require('./states');

module.exports = function (Terminal) {
  // ESC D Index (IND is 0x84).
  Terminal.prototype.index = function() {
    this.y++;
    if (this.y > this.scrollBottom) {
      this.y--;
      this.scroll();
    }
    this.state = states.normal;
  };

  // ESC M Reverse Index (RI is 0x8d).
  Terminal.prototype.reverseIndex = function() {
    var j;
    this.y--;
    if (this.y < this.scrollTop) {
      this.y++;
      // possibly move the code below to term.reverseScroll();
      // test: echo -ne '\e[1;1H\e[44m\eM\e[0m'
      // blankLine(true) is xterm/linux behavior
      this.lines.splice(this.y + this.ybase, 0, this.blankLine(true));
      j = this.rows - 1 - this.scrollBottom;
      this.lines.splice(this.rows - 1 + this.ybase - j + 1, 1);
      // this.maxRange();
      this.updateRange(this.scrollTop);
      this.updateRange(this.scrollBottom);
    }
    this.state = states.normal;
  };

  // ESC c Full Reset (RIS).
  Terminal.prototype.reset = function() {
    Terminal.call(this, this.cols, this.rows);
    this.refresh(0, this.rows - 1);
  };

  // ESC H Tab Set (HTS is 0x88).
  Terminal.prototype.tabSet = function() {
    this.tabs[this.x] = true;
    this.state = states.normal;
  };

};
