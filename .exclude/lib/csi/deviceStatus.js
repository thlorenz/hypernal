'use strict';

module.exports = function (Terminal) {
  // CSI Ps n Device Status Report (DSR).
  // Ps = 5 -> Status Report. Result (``OK'') is
  // CSI 0 n
  // Ps = 6 -> Report Cursor Position (CPR) [row;column].
  // Result is
  // CSI r ; c R
  // CSI ? Ps n
  // Device Status Report (DSR, DEC-specific).
  // Ps = 6 -> Report Cursor Position (CPR) [row;column] as CSI
  // ? r ; c R (assumes page is zero).
  // Ps = 1 5 -> Report Printer status as CSI ? 1 0 n (ready).
  // or CSI ? 1 1 n (not ready).
  // Ps = 2 5 -> Report UDK status as CSI ? 2 0 n (unlocked)
  // or CSI ? 2 1 n (locked).
  // Ps = 2 6 -> Report Keyboard status as
  // CSI ? 2 7 ; 1 ; 0 ; 0 n (North American).
  // The last two parameters apply to VT400 & up, and denote key-
  // board ready and LK01 respectively.
  // Ps = 5 3 -> Report Locator status as
  // CSI ? 5 3 n Locator available, if compiled-in, or
  // CSI ? 5 0 n No Locator, if not.
  Terminal.prototype.deviceStatus = function(params) {
    if (!this.prefix) {
      switch (params[0]) {
      case 5:
        // status report
        this.send('\x1b[0n');
        break;
      case 6:
        // cursor position
        this.send('\x1b[' + (this.y + 1) + ';' + (this.x + 1) + 'R');
        break;
      }
    } else if (this.prefix === '?') {
      // modern xterm doesnt seem to
      // respond to any of these except ?6, 6, and 5
      switch (params[0]) {
      case 6:
        // cursor position
        this.send('\x1b[?' + (this.y + 1) + ';' + (this.x + 1) + 'R');
        break;
      case 15:
        // no printer
        // this.send('\x1b[?11n');
        break;
      case 25:
        // dont support user defined keys
        // this.send('\x1b[?21n');
        break;
      case 26:
        // north american keyboard
        // this.send('\x1b[?27;1;0;0n');
        break;
      case 53:
        // no dec locator/mouse
        // this.send('\x1b[?50n');
        break;
      }
    }
  };
};
