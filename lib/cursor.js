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
  
  // CSI Ps A
  // Cursor Up Ps Times (default = 1) (CUU).
  Terminal.prototype.cursorUp = function(params) {
      var param = params[0];
      if (param < 1) param = 1;
      this.y -= param;
      if (this.y < 0) this.y = 0;
  };

  // CSI Ps B
  // Cursor Down Ps Times (default = 1) (CUD).
  Terminal.prototype.cursorDown = function(params) {
      var param = params[0];
      if (param < 1) param = 1;
      this.y += param;
      if (this.y >= this.rows) {
          this.y = this.rows - 1;
      }
  };

  // CSI Ps C
  // Cursor Forward Ps Times (default = 1) (CUF).
  Terminal.prototype.cursorForward = function(params) {
      var param = params[0];
      if (param < 1) param = 1;
      this.x += param;
      if (this.x >= this.cols) {
          this.x = this.cols - 1;
      }
  };

  // CSI Ps D
  // Cursor Backward Ps Times (default = 1) (CUB).
  Terminal.prototype.cursorBackward = function(params) {
      var param = params[0];
      if (param < 1) param = 1;
      this.x -= param;
      if (this.x < 0) this.x = 0;
  };

  // CSI Ps ; Ps H
  // Cursor Position [row;column] (default = [1,1]) (CUP).
  Terminal.prototype.cursorPos = function(params) {
      var row, col;

      row = params[0] - 1;

      if (params.length >= 2) {
          col = params[1] - 1;
      } else {
          col = 0;
      }

      if (row < 0) {
          row = 0;
      } else if (row >= this.rows) {
          row = this.rows - 1;
      }

      if (col < 0) {
          col = 0;
      } else if (col >= this.cols) {
          col = this.cols - 1;
      }

      this.x = col;
      this.y = row;
  };
};
