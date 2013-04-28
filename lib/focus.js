'use strict';

module.exports = function (Terminal) {
  Terminal.focus = null;

  Terminal.prototype.focus = function() {
    if (Terminal.focus === this) return;
    if (Terminal.focus) {
      Terminal.focus.cursorState = 0;
      Terminal.focus.refresh(Terminal.focus.y, Terminal.focus.y);
      if (Terminal.focus.sendFocus) Terminal.focus.send('\x1b[O');
    }
    Terminal.focus = this;
    if (this.sendFocus) this.send('\x1b[I');
    this.showCursor();
  };
};
