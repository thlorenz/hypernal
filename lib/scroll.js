'use strict';

module.exports = function (Terminal) {
  Terminal.prototype.scroll = function() {
    var row;

    if (++this.ybase === Terminal.scrollback) {
      this.ybase = this.ybase / 2 | 0;
      this.lines = this.lines.slice(-(this.ybase + this.rows) + 1);
    }

    this.ydisp = this.ybase;

    // last line
    row = this.ybase + this.rows - 1;

    // subtract the bottom scroll region
    row -= this.rows - 1 - this.scrollBottom;

    if (row === this.lines.length) {
      // potential optimization:
      // pushing is faster than splicing
      // when they amount to the same
      // behavior.
      this.lines.push(this.blankLine());
    } else {
      // add our new line
      this.lines.splice(row, 0, this.blankLine());
    }

    if (this.scrollTop !== 0) {
      if (this.ybase !== 0) {
        this.ybase--;
        this.ydisp = this.ybase;
      }
      this.lines.splice(this.ybase + this.scrollTop, 1);
    }

    // this.maxRange();
    this.updateRange(this.scrollTop);
    this.updateRange(this.scrollBottom);
  };
};
