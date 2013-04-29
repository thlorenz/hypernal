'use strict';

module.exports = function (Terminal) {
  Terminal.prototype.ch = function(cur) {
    return cur ? [this.curAttr, ' '] : [this.defAttr, ' '];
  };

  Terminal.prototype.is = function(term) {
    var name = this.termName || Terminal.termName;
    return (name + '')
      .indexOf(term) === 0;
  };
};
