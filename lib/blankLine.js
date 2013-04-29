'use strict';

module.exports = function (Terminal) {
  Terminal.prototype.blankLine = function(cur) {
    var attr = cur ? this.curAttr : this.defAttr;

    var ch = [attr, ' '],
      line = [],
      i = 0;

    for (; i < this.cols; i++) {
      line[i] = ch;
    }

    return line;
  };
};
