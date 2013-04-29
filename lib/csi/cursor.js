'use strict';

module.exports = function (Terminal) {
  // CSI s
  // Save cursor (ANSI.SYS).
  Terminal.prototype.saveCursor = function(params) {
    this.savedX = this.x;
    this.savedY = this.y;
  };

  // CSI u
  // Restore cursor (ANSI.SYS).
  Terminal.prototype.restoreCursor = function(params) {
    this.x = this.savedX || 0;
    this.y = this.savedY || 0;
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
  
  // CSI Ps E
  // Cursor Next Line Ps Times (default = 1) (CNL).
  // same as CSI Ps B ?
  Terminal.prototype.cursorNextLine = function(params) {
      var param = params[0];
      if (param < 1) param = 1;
      this.y += param;
      if (this.y >= this.rows) {
          this.y = this.rows - 1;
      }
      this.x = 0;
  };

  // CSI Ps F
  // Cursor Preceding Line Ps Times (default = 1) (CNL).
  // reuse CSI Ps A ?
  Terminal.prototype.cursorPrecedingLine = function(params) {
      var param = params[0];
      if (param < 1) param = 1;
      this.y -= param;
      if (this.y < 0) this.y = 0;
      this.x = 0;
  };

  // CSI Ps G
  // Cursor Character Absolute [column] (default = [row,1]) (CHA).
  Terminal.prototype.cursorCharAbsolute = function(params) {
      var param = params[0];
      if (param < 1) param = 1;
      this.x = param - 1;
  };

  // CSI Ps I
  // Cursor Forward Tabulation Ps tab stops (default = 1) (CHT).
  Terminal.prototype.cursorForwardTab = function(params) {
      var param = params[0] || 1;
      while (param--) {
          this.x = this.nextStop();
      }
  };

  // CSI Ps Z Cursor Backward Tabulation Ps tab stops (default = 1) (CBT).
  Terminal.prototype.cursorBackwardTab = function(params) {
      var param = params[0] || 1;
      while (param--) {
          this.x = this.prevStop();
      }
  };

};
