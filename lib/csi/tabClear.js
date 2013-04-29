'use strict';

module.exports = function (Terminal) {
  // CSI Ps g Tab Clear (TBC).
  // Ps = 0 -> Clear Current Column (default).
  // Ps = 3 -> Clear All.
  // Potentially:
  // Ps = 2 -> Clear Stops on Line.
  // http://vt100.net/annarbor/aaa-ug/section6.html
  Terminal.prototype.tabClear = function(params) {
    var param = params[0];
    if (param <= 0) {
      delete this.tabs[this.x];
    } else if (param === 3) {
      this.tabs = {};
    }
  };
};
