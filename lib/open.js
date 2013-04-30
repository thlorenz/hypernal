'use strict';

// if bold is broken, we can't
// use it in the terminal.
function isBoldBroken() {
    var el = document.createElement('span');
    el.innerHTML = 'hello world';
    document.body.appendChild(el);
    var w1 = el.scrollWidth;
    el.style.fontWeight = 'bold';
    var w2 = el.scrollWidth;
    document.body.removeChild(el);
    return w1 !== w2;
}

module.exports = function (Terminal) {
  /**
  * Open Terminal
  */

  Terminal.prototype.open = function() {
    var self = this,
      i = 0,
      div;

    this.element = document.createElement('div');
    this.element.className = 'terminal';
    this.children = [];

    for (; i < this.rows; i++) {
      div = document.createElement('div');
      this.element.appendChild(div);
      this.children.push(div);
    }

    this.refresh(0, this.rows - 1);

    // XXX - hack, move this somewhere else.
    if (Terminal.brokenBold === null) {
      Terminal.brokenBold = isBoldBroken();
    }

    // sync default bg/fg colors
    this.element.style.backgroundColor = Terminal.defaultColors.bg;
    this.element.style.color = Terminal.defaultColors.fg;
  };
};
