'use strict';

var on = require('./helpers/on');

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

  /**
  * Global Events for key handling
  */

  Terminal.bindKeys = function() {
    if (Terminal.focus) return;

    // We could put an "if (Terminal.focus)" check
    // here, but it shouldn't be necessary.
    on(document, 'keydown', function(ev) {
      return Terminal.focus.keyDown(ev);
    }, true);

    on(document, 'keypress', function(ev) {
      return Terminal.focus.keyPress(ev);
    }, true);
  };
};
