'use strict';

// these methods are broken (params not defined) and are nowhere used
module.exports = function (Terminal) {
  // CSI P m SP }
  // Insert P s Column(s) (default = 1) (DECIC), VT420 and up.
  // NOTE: xterm doesn't enable this code by default.
  Terminal.prototype.insertColumns = function() {
    var param = params[0],
      l = this.ybase + this.rows,
      ch = [this.curAttr, ' '] // xterm?
      ,
      i;

    while (param--) {
      for (i = this.ybase; i < l; i++) {
        this.lines[i].splice(this.x + 1, 0, ch);
        this.lines[i].pop();
      }
    }

    this.maxRange();
  };

  // CSI P m SP ~
  // Delete P s Column(s) (default = 1) (DECDC), VT420 and up
  // NOTE: xterm doesn't enable this code by default.
  Terminal.prototype.deleteColumns = function() {
    var param = params[0],
      l = this.ybase + this.rows,
      ch = [this.curAttr, ' '] // xterm?
      ,
      i;

    while (param--) {
      for (i = this.ybase; i < l; i++) {
        this.lines[i].splice(this.x, 1);
        this.lines[i].push(ch);
      }
    }

    this.maxRange();
  };

};
