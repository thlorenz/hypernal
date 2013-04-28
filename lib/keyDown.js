'use strict';

var cancel = require('./helpers/cancel');

module.exports = function (Terminal) {
  var isMac = ~navigator.userAgent.indexOf('Mac');

  Terminal.prototype.keyDown = function(ev) {
    var key;

    switch (ev.keyCode) {
      // backspace
    case 8:
      if (ev.shiftKey) {
        key = '\x08'; // ^H
        break;
      }
      key = '\x7f'; // ^?
      break;
      // tab
    case 9:
      if (ev.shiftKey) {
        key = '\x1b[Z';
        break;
      }
      key = '\t';
      break;
      // return/enter
    case 13:
      key = '\r';
      break;
      // escape
    case 27:
      key = '\x1b';
      break;
      // left-arrow
    case 37:
      if (this.applicationKeypad) {
        key = '\x1bOD'; // SS3 as ^[O for 7-bit
        //key = '\x8fD'; // SS3 as 0x8f for 8-bit
        break;
      }
      key = '\x1b[D';
      break;
      // right-arrow
    case 39:
      if (this.applicationKeypad) {
        key = '\x1bOC';
        break;
      }
      key = '\x1b[C';
      break;
      // up-arrow
    case 38:
      if (this.applicationKeypad) {
        key = '\x1bOA';
        break;
      }
      if (ev.ctrlKey) {
        this.scrollDisp(-1);
        return cancel(ev);
      } else {
        key = '\x1b[A';
      }
      break;
      // down-arrow
    case 40:
      if (this.applicationKeypad) {
        key = '\x1bOB';
        break;
      }
      if (ev.ctrlKey) {
        this.scrollDisp(1);
        return cancel(ev);
      } else {
        key = '\x1b[B';
      }
      break;
      // delete
    case 46:
      key = '\x1b[3~';
      break;
      // insert
    case 45:
      key = '\x1b[2~';
      break;
      // home
    case 36:
      if (this.applicationKeypad) {
        key = '\x1bOH';
        break;
      }
      key = '\x1bOH';
      break;
      // end
    case 35:
      if (this.applicationKeypad) {
        key = '\x1bOF';
        break;
      }
      key = '\x1bOF';
      break;
      // page up
    case 33:
      if (ev.shiftKey) {
        this.scrollDisp(-(this.rows - 1));
        return cancel(ev);
      } else {
        key = '\x1b[5~';
      }
      break;
      // page down
    case 34:
      if (ev.shiftKey) {
        this.scrollDisp(this.rows - 1);
        return cancel(ev);
      } else {
        key = '\x1b[6~';
      }
      break;
      // F1
    case 112:
      key = '\x1bOP';
      break;
      // F2
    case 113:
      key = '\x1bOQ';
      break;
      // F3
    case 114:
      key = '\x1bOR';
      break;
      // F4
    case 115:
      key = '\x1bOS';
      break;
      // F5
    case 116:
      key = '\x1b[15~';
      break;
      // F6
    case 117:
      key = '\x1b[17~';
      break;
      // F7
    case 118:
      key = '\x1b[18~';
      break;
      // F8
    case 119:
      key = '\x1b[19~';
      break;
      // F9
    case 120:
      key = '\x1b[20~';
      break;
      // F10
    case 121:
      key = '\x1b[21~';
      break;
      // F11
    case 122:
      key = '\x1b[23~';
      break;
      // F12
    case 123:
      key = '\x1b[24~';
      break;
    default:
      // a-z and space
      if (ev.ctrlKey) {
        if (ev.keyCode >= 65 && ev.keyCode <= 90) {
          key = String.fromCharCode(ev.keyCode - 64);
        } else if (ev.keyCode === 32) {
          // NUL
          key = String.fromCharCode(0);
        } else if (ev.keyCode >= 51 && ev.keyCode <= 55) {
          // escape, file sep, group sep, record sep, unit sep
          key = String.fromCharCode(ev.keyCode - 51 + 27);
        } else if (ev.keyCode === 56) {
          // delete
          key = String.fromCharCode(127);
        } else if (ev.keyCode === 219) {
          // ^[ - escape
          key = String.fromCharCode(27);
        } else if (ev.keyCode === 221) {
          // ^] - group sep
          key = String.fromCharCode(29);
        }
      } else if ((!isMac && ev.altKey) || (isMac && ev.metaKey)) {
        if (ev.keyCode >= 65 && ev.keyCode <= 90) {
          key = '\x1b' + String.fromCharCode(ev.keyCode + 32);
        } else if (ev.keyCode === 192) {
          key = '\x1b`';
        } else if (ev.keyCode >= 48 && ev.keyCode <= 57) {
          key = '\x1b' + (ev.keyCode - 48);
        }
      }
      break;
    }

    this.emit('keydown', ev);

    if (key) {
      this.emit('key', key, ev);

      this.showCursor();
      this.handler(key);

      return cancel(ev);
    }

    return true;
  };
};
