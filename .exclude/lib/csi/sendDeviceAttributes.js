'use strict';

module.exports = function (Terminal) {

  // CSI Ps c Send Device Attributes (Primary DA).
  // Ps = 0 or omitted -> request attributes from terminal. The
  // response depends on the decTerminalID resource setting.
  // -> CSI ? 1 ; 2 c (``VT100 with Advanced Video Option'')
  // -> CSI ? 1 ; 0 c (``VT101 with No Options'')
  // -> CSI ? 6 c (``VT102'')
  // -> CSI ? 6 0 ; 1 ; 2 ; 6 ; 8 ; 9 ; 1 5 ; c (``VT220'')
  // The VT100-style response parameters do not mean anything by
  // themselves. VT220 parameters do, telling the host what fea-
  // tures the terminal supports:
  // Ps = 1 -> 132-columns.
  // Ps = 2 -> Printer.
  // Ps = 6 -> Selective erase.
  // Ps = 8 -> User-defined keys.
  // Ps = 9 -> National replacement character sets.
  // Ps = 1 5 -> Technical characters.
  // Ps = 2 2 -> ANSI color, e.g., VT525.
  // Ps = 2 9 -> ANSI text locator (i.e., DEC Locator mode).
  // CSI > Ps c
  // Send Device Attributes (Secondary DA).
  // Ps = 0 or omitted -> request the terminal's identification
  // code. The response depends on the decTerminalID resource set-
  // ting. It should apply only to VT220 and up, but xterm extends
  // this to VT100.
  // -> CSI > Pp ; Pv ; Pc c
  // where Pp denotes the terminal type
  // Pp = 0 -> ``VT100''.
  // Pp = 1 -> ``VT220''.
  // and Pv is the firmware version (for xterm, this was originally
  // the XFree86 patch number, starting with 95). In a DEC termi-
  // nal, Pc indicates the ROM cartridge registration number and is
  // always zero.
  // More information:
  // xterm/charproc.c - line 2012, for more information.
  // vim responds with ^[[?0c or ^[[?1c after the terminal's response (?)
  Terminal.prototype.sendDeviceAttributes = function(params) {
    if (params[0] > 0) return;

    if (!this.prefix) {
      if (this.is('xterm') || this.is('rxvt-unicode') || this.is('screen')) {
        this.send('\x1b[?1;2c');
      } else if (this.is('linux')) {
        this.send('\x1b[?6c');
      }
    } else if (this.prefix === '>') {
      // xterm and urxvt
      // seem to spit this
      // out around ~370 times (?).
      if (this.is('xterm')) {
        this.send('\x1b[>0;276;0c');
      } else if (this.is('rxvt-unicode')) {
        this.send('\x1b[>85;95;0c');
      } else if (this.is('linux')) {
        // not supported by linux console.
        // linux console echoes parameters.
        this.send(params[0] + 'c');
      } else if (this.is('screen')) {
        this.send('\x1b[>83;40003;0c');
      }
    }
  };

};
