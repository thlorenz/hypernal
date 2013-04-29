'use strict';

module.exports = function (Terminal) {
  // CSI Pt; Pl; Pb; Pr; Ps$ r
  // Change Attributes in Rectangular Area (DECCARA), VT400 and up.
  // Pt; Pl; Pb; Pr denotes the rectangle.
  // Ps denotes the SGR attributes to change: 0, 1, 4, 5, 7.
  // NOTE: xterm doesn't enable this code by default.
  Terminal.prototype.setAttrInRectangle = function(params) {
    var t = params[0],
      l = params[1],
      b = params[2],
      r = params[3],
      attr = params[4];

    var line, i;

    for (; t < b + 1; t++) {
      line = this.lines[this.ybase + t];
      for (i = l; i < r; i++) {
        line[i] = [attr, line[i][1]];
      }
    }

    // this.maxRange();
    this.updateRange(params[0]);
    this.updateRange(params[2]);
  };

  // CSI Pc; Pt; Pl; Pb; Pr$ x
  // Fill Rectangular Area (DECFRA), VT420 and up.
  // Pc is the character to use.
  // Pt; Pl; Pb; Pr denotes the rectangle.
  // NOTE: xterm doesn't enable this code by default.
  Terminal.prototype.fillRectangle = function(params) {
    var ch = params[0],
      t = params[1],
      l = params[2],
      b = params[3],
      r = params[4];

    var line, i;

    for (; t < b + 1; t++) {
      line = this.lines[this.ybase + t];
      for (i = l; i < r; i++) {
        line[i] = [line[i][0], String.fromCharCode(ch)];
      }
    }

    // this.maxRange();
    this.updateRange(params[1]);
    this.updateRange(params[3]);
  };

  // CSI Pt; Pl; Pb; Pr$ z
  // Erase Rectangular Area (DECERA), VT400 and up.
  // Pt; Pl; Pb; Pr denotes the rectangle.
  // NOTE: xterm doesn't enable this code by default.
  Terminal.prototype.eraseRectangle = function(params) {
    var t = params[0],
      l = params[1],
      b = params[2],
      r = params[3];

    var line, i, ch;

    ch = [this.curAttr, ' ']; // xterm?

    for (; t < b + 1; t++) {
      line = this.lines[this.ybase + t];
      for (i = l; i < r; i++) {
        line[i] = ch;
      }
    }

    // this.maxRange();
    this.updateRange(params[0]);
    this.updateRange(params[2]);
  };

};
