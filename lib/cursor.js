'use strict';

module.exports = function (Terminal) {
  Terminal.prototype.cursorBlink = function() {
    if (Terminal.focus !== this) return;
    this.cursorState ^= 1;
    this.refresh(this.y, this.y);
  };

  Terminal.prototype.showCursor = function() {
    if (!this.cursorState) {
      this.cursorState = 1;
      this.refresh(this.y, this.y);
    } else {
      // Temporarily disabled:
      // this.refreshBlink();
    }
  };

  Terminal.prototype.startBlink = function() {
    if (!Terminal.cursorBlink) return;
    var self = this;
    this._blinker = function() {
      self.cursorBlink();
    };
    this._blink = setInterval(this._blinker, 500);
  };

  Terminal.prototype.refreshBlink = function() {
    if (!Terminal.cursorBlink) return;
    clearInterval(this._blink);
    this._blink = setInterval(this._blinker, 500);
  };
};
