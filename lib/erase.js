'use strict';

module.exports = function (Terminal) {
  Terminal.prototype.eraseRight = function(x, y) {
    var line = this.lines[this.ybase + y],
      ch = [this.curAttr, ' ']; // xterm

    for (; x < this.cols; x++) {
      line[x] = ch;
    }

    this.updateRange(y);
  };

  Terminal.prototype.eraseLeft = function(x, y) {
    var line = this.lines[this.ybase + y],
      ch = [this.curAttr, ' ']; // xterm

    x++;
    while (x--) line[x] = ch;

    this.updateRange(y);
  };

  Terminal.prototype.eraseLine = function(y) {
    this.eraseRight(0, y);
  };
  
  // CSI Ps J Erase in Display (ED).
  // Ps = 0 -> Erase Below (default).
  // Ps = 1 -> Erase Above.
  // Ps = 2 -> Erase All.
  // Ps = 3 -> Erase Saved Lines (xterm).
  // CSI ? Ps J
  // Erase in Display (DECSED).
  // Ps = 0 -> Selective Erase Below (default).
  // Ps = 1 -> Selective Erase Above.
  // Ps = 2 -> Selective Erase All.
  Terminal.prototype.eraseInDisplay = function(params) {
      var j;
      switch (params[0]) {
      case 0:
          this.eraseRight(this.x, this.y);
          j = this.y + 1;
          for (; j < this.rows; j++) {
              this.eraseLine(j);
          }
          break;
      case 1:
          this.eraseLeft(this.x, this.y);
          j = this.y;
          while (j--) {
              this.eraseLine(j);
          }
          break;
      case 2:
          j = this.rows;
          while (j--) this.eraseLine(j);
          break;
      case 3:
          ; // no saved lines
          break;
      }
  };

  // CSI Ps K Erase in Line (EL).
  // Ps = 0 -> Erase to Right (default).
  // Ps = 1 -> Erase to Left.
  // Ps = 2 -> Erase All.
  // CSI ? Ps K
  // Erase in Line (DECSEL).
  // Ps = 0 -> Selective Erase to Right (default).
  // Ps = 1 -> Selective Erase to Left.
  // Ps = 2 -> Selective Erase All.
  Terminal.prototype.eraseInLine = function(params) {
      switch (params[0]) {
      case 0:
          this.eraseRight(this.x, this.y);
          break;
      case 1:
          this.eraseLeft(this.x, this.y);
          break;
      case 2:
          this.eraseLine(this.y);
          break;
      }
  };
};
