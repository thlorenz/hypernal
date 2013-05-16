'use strict';

function addRowsOnDemand () {
  while (this.y >= this.rows) {
    this.lines.push(this.blankLine());
    var div = document.createElement('div');
    this.element.appendChild(div);
    this.children.push(div);

    this.rows++;
  }
}

module.exports = function (Terminal) {
  Terminal.prototype.updateRange = function(y) {
    if (y < this.refreshStart) this.refreshStart = y;
    if (y > this.refreshEnd) this.refreshEnd = y;
    addRowsOnDemand.bind(this)();
  };

  Terminal.prototype.maxRange = function() {
    this.refreshStart = 0;
    this.refreshEnd = this.rows - 1;
  };
};
