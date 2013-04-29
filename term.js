'use strict';

var states = require('./lib/states');

/**
* Helpers
*/
var on       =  require('./lib/helpers/on')
  , off      =  require('./lib/helpers/off')
  , cancel   =  require('./lib/helpers/cancel')
  , inherits =  require('./lib/helpers/inherits')
  ;

/**
* Terminal
*/

var EventEmitter = require('events')
    .EventEmitter;

module.exports = Terminal;

function Terminal(cols, rows, opts) {
    if (!(this instanceof Terminal)) return new Terminal(cols, rows, opts);
    EventEmitter.call(this);

    this._options = opts || {};

    this.cols = cols || Terminal.geometry[0];
    this.rows = rows || Terminal.geometry[1];

    if (this._options.handler) {
        this.on('data', this._options.handler);
    }

    this.ybase = 0;
    this.ydisp = 0;
    this.x = 0;
    this.y = 0;
    this.cursorState = 0;
    this.cursorHidden = false;
    this.convertEol = false;
    this.state = states.normal;
    this.queue = '';
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;

    // modes
    this.applicationKeypad = false;
    this.originMode = false;
    this.insertMode = false;
    this.wraparoundMode = false;
    this.normal = null;

    // charset
    this.charset = null;
    this.gcharset = null;
    this.glevel = 0;
    this.charsets = [null];

    // mouse properties
    this.decLocator;
    this.x10Mouse;
    this.vt200Mouse;
    this.vt300Mouse;
    this.normalMouse;
    this.mouseEvents;
    this.sendFocus;
    this.utfMouse;
    this.sgrMouse;
    this.urxvtMouse;

    // misc
    this.element;
    this.children;
    this.refreshStart;
    this.refreshEnd;
    this.savedX;
    this.savedY;
    this.savedCols;

    // stream
    this.readable = true;
    this.writable = true;

    this.defAttr = (257 << 9) | 256;
    this.curAttr = this.defAttr;

    this.params = [];
    this.currentParam = 0;
    this.prefix = '';
    this.postfix = '';

    this.lines = [];
    var i = this.rows;
    while (i--) {
        this.lines.push(this.blankLine());
    }

    this.tabs;
    this.setupStops();

    this.tabspace = this._options.tabspace || '  ';
}

inherits(Terminal, EventEmitter);

require('./lib/colors')(Terminal);
require('./lib/options')(Terminal);
require('./lib/focus')(Terminal);
require('./lib/open')(Terminal);
require('./lib/destroy')(Terminal);
require('./lib/refresh')(Terminal);

// used by write, but most likely can be removed
require('./lib/scroll')(Terminal);

require('./lib/write')(Terminal);

require('./lib/setgLevel');
require('./lib/setgCharset');

require('./lib/setMode')(Terminal);
require('./lib/resetMode')(Terminal);

Terminal.prototype.send = function(data) {
    var self = this;

    if (!this.queue) {
        setTimeout(function() {
            self.handler(self.queue);
            self.queue = '';
        }, 1);
    }

    this.queue += data;
};

Terminal.prototype.log = function() {
    if (!Terminal.debug) return;
    if (!window.console || !window.console.log) return;
    var args = Array.prototype.slice.call(arguments);
    window.console.log.apply(window.console, args);
};

Terminal.prototype.error = function() {
    if (!Terminal.debug) return;
    if (!window.console || !window.console.error) return;
    var args = Array.prototype.slice.call(arguments);
    window.console.error.apply(window.console, args);
};

Terminal.prototype.resize = function(x, y) {
    var line, el, i, j, ch;

    if (x < 1) x = 1;
    if (y < 1) y = 1;

    // resize cols
    j = this.cols;
    if (j < x) {
        ch = [this.defAttr, ' '];
        i = this.lines.length;
        while (i--) {
            while (this.lines[i].length < x) {
                this.lines[i].push(ch);
            }
        }
    } else if (j > x) {
        i = this.lines.length;
        while (i--) {
            while (this.lines[i].length > x) {
                this.lines[i].pop();
            }
        }
    }
    this.setupStops(j);
    this.cols = x;

    // resize rows
    j = this.rows;
    if (j < y) {
        el = this.element;
        while (j++ < y) {
            if (this.lines.length < y + this.ybase) {
                this.lines.push(this.blankLine());
            }
            if (this.children.length < y) {
                line = document.createElement('div');
                el.appendChild(line);
                this.children.push(line);
            }
        }
    } else if (j > y) {
        while (j-- > y) {
            if (this.lines.length > y + this.ybase) {
                this.lines.pop();
            }
            if (this.children.length > y) {
                el = this.children.pop();
                if (!el) continue;
                el.parentNode.removeChild(el);
            }
        }
    }
    this.rows = y;

    // make sure the cursor stays on screen
    if (this.y >= y) this.y = y - 1;
    if (this.x >= x) this.x = x - 1;

    this.scrollTop = 0;
    this.scrollBottom = y - 1;

    this.refresh(0, this.rows - 1);

    // it's a real nightmare trying
    // to resize the original
    // screen buffer. just set it
    // to null for now.
    this.normal = null;
};

Terminal.prototype.updateRange = function(y) {
    if (y < this.refreshStart) this.refreshStart = y;
    if (y > this.refreshEnd) this.refreshEnd = y;
};

Terminal.prototype.maxRange = function() {
    this.refreshStart = 0;
    this.refreshEnd = this.rows - 1;
};

Terminal.prototype.setupStops = function(i) {
    if (i != null) {
        if (!this.tabs[i]) {
            i = this.prevStop(i);
        }
    } else {
        this.tabs = {};
        i = 0;
    }

    for (; i < this.cols; i += 8) {
        this.tabs[i] = true;
    }
};

Terminal.prototype.prevStop = function(x) {
    if (x == null) x = this.x;
    while (!this.tabs[--x] && x > 0);
    return x >= this.cols ? this.cols - 1 : x < 0 ? 0 : x;
};

Terminal.prototype.nextStop = function(x) {
    if (x == null) x = this.x;
    while (!this.tabs[++x] && x < this.cols);
    return x >= this.cols ? this.cols - 1 : x < 0 ? 0 : x;
};

Terminal.prototype.eraseRight = function(x, y) {
    var line = this.lines[this.ybase + y],
        ch = [this.curAttr, ' ']; // xterm

    for (; x < this.cols; x++) {
        line[x] = ch;
    }

    this.updateRange(y);
};

Terminal.prototype.eraseLeft = function(x, y) {
    var line = this.lines[this.ybase + y],
        ch = [this.curAttr, ' ']; // xterm

    x++;
    while (x--) line[x] = ch;

    this.updateRange(y);
};

Terminal.prototype.eraseLine = function(y) {
    this.eraseRight(0, y);
};

Terminal.prototype.blankLine = function(cur) {
    var attr = cur ? this.curAttr : this.defAttr;

    var ch = [attr, ' '],
        line = [],
        i = 0;

    for (; i < this.cols; i++) {
        line[i] = ch;
    }

    return line;
};

Terminal.prototype.ch = function(cur) {
    return cur ? [this.curAttr, ' '] : [this.defAttr, ' '];
};

Terminal.prototype.is = function(term) {
    var name = this.termName || Terminal.termName;
    return (name + '')
        .indexOf(term) === 0;
};

Terminal.prototype.handler = function(data) {
    this.emit('data', data);
};

Terminal.prototype.handleTitle = function(title) {
    this.emit('title', title);
};

/**
* ESC
*/

// ESC D Index (IND is 0x84).
Terminal.prototype.index = function() {
    this.y++;
    if (this.y > this.scrollBottom) {
        this.y--;
        this.scroll();
    }
    this.state = normal;
};

// ESC M Reverse Index (RI is 0x8d).
Terminal.prototype.reverseIndex = function() {
    var j;
    this.y--;
    if (this.y < this.scrollTop) {
        this.y++;
        // possibly move the code below to term.reverseScroll();
        // test: echo -ne '\e[1;1H\e[44m\eM\e[0m'
        // blankLine(true) is xterm/linux behavior
        this.lines.splice(this.y + this.ybase, 0, this.blankLine(true));
        j = this.rows - 1 - this.scrollBottom;
        this.lines.splice(this.rows - 1 + this.ybase - j + 1, 1);
        // this.maxRange();
        this.updateRange(this.scrollTop);
        this.updateRange(this.scrollBottom);
    }
    this.state = normal;
};

// ESC c Full Reset (RIS).
Terminal.prototype.reset = function() {
    Terminal.call(this, this.cols, this.rows);
    this.refresh(0, this.rows - 1);
};

// ESC H Tab Set (HTS is 0x88).
Terminal.prototype.tabSet = function() {
    this.tabs[this.x] = true;
    this.state = normal;
};

/**
* CSI
*/

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

// CSI Ps J Erase in Display (ED).
// Ps = 0 -> Erase Below (default).
// Ps = 1 -> Erase Above.
// Ps = 2 -> Erase All.
// Ps = 3 -> Erase Saved Lines (xterm).
// CSI ? Ps J
// Erase in Display (DECSED).
// Ps = 0 -> Selective Erase Below (default).
// Ps = 1 -> Selective Erase Above.
// Ps = 2 -> Selective Erase All.
Terminal.prototype.eraseInDisplay = function(params) {
    var j;
    switch (params[0]) {
    case 0:
        this.eraseRight(this.x, this.y);
        j = this.y + 1;
        for (; j < this.rows; j++) {
            this.eraseLine(j);
        }
        break;
    case 1:
        this.eraseLeft(this.x, this.y);
        j = this.y;
        while (j--) {
            this.eraseLine(j);
        }
        break;
    case 2:
        j = this.rows;
        while (j--) this.eraseLine(j);
        break;
    case 3:
        ; // no saved lines
        break;
    }
    this.emit('erase', {
        0: 'below',
        1: 'above',
        2: 'all',
        3: 'saved'
    }[params]);
};

// CSI Ps K Erase in Line (EL).
// Ps = 0 -> Erase to Right (default).
// Ps = 1 -> Erase to Left.
// Ps = 2 -> Erase All.
// CSI ? Ps K
// Erase in Line (DECSEL).
// Ps = 0 -> Selective Erase to Right (default).
// Ps = 1 -> Selective Erase to Left.
// Ps = 2 -> Selective Erase All.
Terminal.prototype.eraseInLine = function(params) {
    switch (params[0]) {
    case 0:
        this.eraseRight(this.x, this.y);
        break;
    case 1:
        this.eraseLeft(this.x, this.y);
        break;
    case 2:
        this.eraseLine(this.y);
        break;
    }
};

// CSI Pm m Character Attributes (SGR).
// Ps = 0 -> Normal (default).
// Ps = 1 -> Bold.
// Ps = 4 -> Underlined.
// Ps = 5 -> Blink (appears as Bold).
// Ps = 7 -> Inverse.
// Ps = 8 -> Invisible, i.e., hidden (VT300).
// Ps = 2 2 -> Normal (neither bold nor faint).
// Ps = 2 4 -> Not underlined.
// Ps = 2 5 -> Steady (not blinking).
// Ps = 2 7 -> Positive (not inverse).
// Ps = 2 8 -> Visible, i.e., not hidden (VT300).
// Ps = 3 0 -> Set foreground color to Black.
// Ps = 3 1 -> Set foreground color to Red.
// Ps = 3 2 -> Set foreground color to Green.
// Ps = 3 3 -> Set foreground color to Yellow.
// Ps = 3 4 -> Set foreground color to Blue.
// Ps = 3 5 -> Set foreground color to Magenta.
// Ps = 3 6 -> Set foreground color to Cyan.
// Ps = 3 7 -> Set foreground color to White.
// Ps = 3 9 -> Set foreground color to default (original).
// Ps = 4 0 -> Set background color to Black.
// Ps = 4 1 -> Set background color to Red.
// Ps = 4 2 -> Set background color to Green.
// Ps = 4 3 -> Set background color to Yellow.
// Ps = 4 4 -> Set background color to Blue.
// Ps = 4 5 -> Set background color to Magenta.
// Ps = 4 6 -> Set background color to Cyan.
// Ps = 4 7 -> Set background color to White.
// Ps = 4 9 -> Set background color to default (original).

// If 16-color support is compiled, the following apply. Assume
// that xterm's resources are set so that the ISO color codes are
// the first 8 of a set of 16. Then the aixterm colors are the
// bright versions of the ISO colors:
// Ps = 9 0 -> Set foreground color to Black.
// Ps = 9 1 -> Set foreground color to Red.
// Ps = 9 2 -> Set foreground color to Green.
// Ps = 9 3 -> Set foreground color to Yellow.
// Ps = 9 4 -> Set foreground color to Blue.
// Ps = 9 5 -> Set foreground color to Magenta.
// Ps = 9 6 -> Set foreground color to Cyan.
// Ps = 9 7 -> Set foreground color to White.
// Ps = 1 0 0 -> Set background color to Black.
// Ps = 1 0 1 -> Set background color to Red.
// Ps = 1 0 2 -> Set background color to Green.
// Ps = 1 0 3 -> Set background color to Yellow.
// Ps = 1 0 4 -> Set background color to Blue.
// Ps = 1 0 5 -> Set background color to Magenta.
// Ps = 1 0 6 -> Set background color to Cyan.
// Ps = 1 0 7 -> Set background color to White.

// If xterm is compiled with the 16-color support disabled, it
// supports the following, from rxvt:
// Ps = 1 0 0 -> Set foreground and background color to
// default.

// If 88- or 256-color support is compiled, the following apply.
// Ps = 3 8 ; 5 ; Ps -> Set foreground color to the second
// Ps.
// Ps = 4 8 ; 5 ; Ps -> Set background color to the second
// Ps.
Terminal.prototype.charAttributes = function(params) {
    var l = params.length,
        i = 0,
        bg, fg, p;

    for (; i < l; i++) {
        p = params[i];
        if (p >= 30 && p <= 37) {
            // fg color 8
            this.curAttr = (this.curAttr & ~ (0x1ff << 9)) | ((p - 30) << 9);
        } else if (p >= 40 && p <= 47) {
            // bg color 8
            this.curAttr = (this.curAttr & ~0x1ff) | (p - 40);
        } else if (p >= 90 && p <= 97) {
            // fg color 16
            p += 8;
            this.curAttr = (this.curAttr & ~ (0x1ff << 9)) | ((p - 90) << 9);
        } else if (p >= 100 && p <= 107) {
            // bg color 16
            p += 8;
            this.curAttr = (this.curAttr & ~0x1ff) | (p - 100);
        } else if (p === 0) {
            // default
            this.curAttr = this.defAttr;
        } else if (p === 1) {
            // bold text
            this.curAttr = this.curAttr | (1 << 18);
        } else if (p === 4) {
            // underlined text
            this.curAttr = this.curAttr | (2 << 18);
        } else if (p === 7 || p === 27) {
            // inverse and positive
            // test with: echo -e '\e[31m\e[42mhello\e[7mworld\e[27mhi\e[m'
            if (p === 7) {
                if ((this.curAttr >> 18) & 4) continue;
                this.curAttr = this.curAttr | (4 << 18);
            } else if (p === 27) {
                if (~ (this.curAttr >> 18) & 4) continue;
                this.curAttr = this.curAttr & ~ (4 << 18);
            }

            bg = this.curAttr & 0x1ff;
            fg = (this.curAttr >> 9) & 0x1ff;

            this.curAttr = (this.curAttr & ~0x3ffff) | ((bg << 9) | fg);
        } else if (p === 22) {
            // not bold
            this.curAttr = this.curAttr & ~ (1 << 18);
        } else if (p === 24) {
            // not underlined
            this.curAttr = this.curAttr & ~ (2 << 18);
        } else if (p === 39) {
            // reset fg
            this.curAttr = this.curAttr & ~ (0x1ff << 9);
            this.curAttr = this.curAttr | (((this.defAttr >> 9) & 0x1ff) << 9);
        } else if (p === 49) {
            // reset bg
            this.curAttr = this.curAttr & ~0x1ff;
            this.curAttr = this.curAttr | (this.defAttr & 0x1ff);
        } else if (p === 38) {
            // fg color 256
            if (params[i + 1] !== 5) continue;
            i += 2;
            p = params[i] & 0xff;
            // convert 88 colors to 256
            // if (this.is('rxvt-unicode') && p < 88) p = p * 2.9090 | 0;
            this.curAttr = (this.curAttr & ~ (0x1ff << 9)) | (p << 9);
        } else if (p === 48) {
            // bg color 256
            if (params[i + 1] !== 5) continue;
            i += 2;
            p = params[i] & 0xff;
            // convert 88 colors to 256
            // if (this.is('rxvt-unicode') && p < 88) p = p * 2.9090 | 0;
            this.curAttr = (this.curAttr & ~0x1ff) | p;
        }
    }
};

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

/**
* Additions
*/

// CSI Ps @
// Insert Ps (Blank) Character(s) (default = 1) (ICH).
Terminal.prototype.insertChars = function(params) {
    var param, row, j, ch;

    param = params[0];
    if (param < 1) param = 1;

    row = this.y + this.ybase;
    j = this.x;
    ch = [this.curAttr, ' ']; // xterm

    while (param-- && j < this.cols) {
        this.lines[row].splice(j++, 0, ch);
        this.lines[row].pop();
    }
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

// CSI Ps L
// Insert Ps Line(s) (default = 1) (IL).
Terminal.prototype.insertLines = function(params) {
    var param, row, j;

    param = params[0];
    if (param < 1) param = 1;
    row = this.y + this.ybase;

    j = this.rows - 1 - this.scrollBottom;
    j = this.rows - 1 + this.ybase - j + 1;

    while (param--) {
        // test: echo -e '\e[44m\e[1L\e[0m'
        // blankLine(true) - xterm/linux behavior
        this.lines.splice(row, 0, this.blankLine(true));
        this.lines.splice(j, 1);
    }

    // this.maxRange();
    this.updateRange(this.y);
    this.updateRange(this.scrollBottom);
};

// CSI Ps M
// Delete Ps Line(s) (default = 1) (DL).
Terminal.prototype.deleteLines = function(params) {
    var param, row, j;

    param = params[0];
    if (param < 1) param = 1;
    row = this.y + this.ybase;

    j = this.rows - 1 - this.scrollBottom;
    j = this.rows - 1 + this.ybase - j;

    while (param--) {
        // test: echo -e '\e[44m\e[1M\e[0m'
        // blankLine(true) - xterm/linux behavior
        this.lines.splice(j + 1, 0, this.blankLine(true));
        this.lines.splice(row, 1);
    }

    // this.maxRange();
    this.updateRange(this.y);
    this.updateRange(this.scrollBottom);
};

// CSI Ps P
// Delete Ps Character(s) (default = 1) (DCH).
Terminal.prototype.deleteChars = function(params) {
    var param, row, ch;

    param = params[0];
    if (param < 1) param = 1;

    row = this.y + this.ybase;
    ch = [this.curAttr, ' ']; // xterm

    while (param--) {
        this.lines[row].splice(this.x, 1);
        this.lines[row].push(ch);
    }
};

// CSI Ps X
// Erase Ps Character(s) (default = 1) (ECH).
Terminal.prototype.eraseChars = function(params) {
    var param, row, j, ch;

    param = params[0];
    if (param < 1) param = 1;

    row = this.y + this.ybase;
    j = this.x;
    ch = [this.curAttr, ' ']; // xterm

    while (param-- && j < this.cols) {
        this.lines[row][j++] = ch;
    }
};

// CSI Pm ` Character Position Absolute
// [column] (default = [row,1]) (HPA).
Terminal.prototype.charPosAbsolute = function(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.x = param - 1;
    if (this.x >= this.cols) {
        this.x = this.cols - 1;
    }
};

// 141 61 a * HPR -
// Horizontal Position Relative
// reuse CSI Ps C ?
Terminal.prototype.HPositionRelative = function(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.x += param;
    if (this.x >= this.cols) {
        this.x = this.cols - 1;
    }
};

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

// CSI Pm d
// Line Position Absolute [row] (default = [1,column]) (VPA).
Terminal.prototype.linePosAbsolute = function(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.y = param - 1;
    if (this.y >= this.rows) {
        this.y = this.rows - 1;
    }
};

// 145 65 e * VPR - Vertical Position Relative
// reuse CSI Ps B ?
Terminal.prototype.VPositionRelative = function(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.y += param;
    if (this.y >= this.rows) {
        this.y = this.rows - 1;
    }
};

// CSI Ps ; Ps f
// Horizontal and Vertical Position [row;column] (default =
// [1,1]) (HVP).
Terminal.prototype.HVPosition = function(params) {
    if (params[0] < 1) params[0] = 1;
    if (params[1] < 1) params[1] = 1;

    this.y = params[0] - 1;
    if (this.y >= this.rows) {
        this.y = this.rows - 1;
    }

    this.x = params[1] - 1;
    if (this.x >= this.cols) {
        this.x = this.cols - 1;
    }
};

// CSI Ps ; Ps r
// Set Scrolling Region [top;bottom] (default = full size of win-
// dow) (DECSTBM).
// CSI ? Pm r
Terminal.prototype.setScrollRegion = function(params) {
    if (this.prefix) return;
    this.scrollTop = (params[0] || 1) - 1;
    this.scrollBottom = (params[1] || this.rows) - 1;
    this.x = 0;
    this.y = 0;
};

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

/**
* Lesser Used
*/

// CSI Ps I
// Cursor Forward Tabulation Ps tab stops (default = 1) (CHT).
Terminal.prototype.cursorForwardTab = function(params) {
    var param = params[0] || 1;
    while (param--) {
        this.x = this.nextStop();
    }
};

// CSI Ps S Scroll up Ps lines (default = 1) (SU).
Terminal.prototype.scrollUp = function(params) {
    var param = params[0] || 1;
    while (param--) {
        this.lines.splice(this.ybase + this.scrollTop, 1);
        this.lines.splice(this.ybase + this.scrollBottom, 0, this.blankLine());
    }
    // this.maxRange();
    this.updateRange(this.scrollTop);
    this.updateRange(this.scrollBottom);
};

// CSI Ps T Scroll down Ps lines (default = 1) (SD).
Terminal.prototype.scrollDown = function(params) {
    var param = params[0] || 1;
    while (param--) {
        this.lines.splice(this.ybase + this.scrollBottom, 1);
        this.lines.splice(this.ybase + this.scrollTop, 0, this.blankLine());
    }
    // this.maxRange();
    this.updateRange(this.scrollTop);
    this.updateRange(this.scrollBottom);
};

// CSI Ps ; Ps ; Ps ; Ps ; Ps T
// Initiate highlight mouse tracking. Parameters are
// [func;startx;starty;firstrow;lastrow]. See the section Mouse
// Tracking.
Terminal.prototype.initMouseTracking = function(params) {
    // Relevant: DECSET 1001
};

// CSI > Ps; Ps T
// Reset one or more features of the title modes to the default
// value. Normally, "reset" disables the feature. It is possi-
// ble to disable the ability to reset features by compiling a
// different default for the title modes into xterm.
// Ps = 0 -> Do not set window/icon labels using hexadecimal.
// Ps = 1 -> Do not query window/icon labels using hexadeci-
// mal.
// Ps = 2 -> Do not set window/icon labels using UTF-8.
// Ps = 3 -> Do not query window/icon labels using UTF-8.
// (See discussion of "Title Modes").
Terminal.prototype.resetTitleModes = function(params) {;
};

// CSI Ps Z Cursor Backward Tabulation Ps tab stops (default = 1) (CBT).
Terminal.prototype.cursorBackwardTab = function(params) {
    var param = params[0] || 1;
    while (param--) {
        this.x = this.prevStop();
    }
};

// CSI Ps b Repeat the preceding graphic character Ps times (REP).
Terminal.prototype.repeatPrecedingCharacter = function(params) {
    var param = params[0] || 1,
        line = this.lines[this.ybase + this.y],
        ch = line[this.x - 1] || [this.defAttr, ' '];

    while (param--) line[this.x++] = ch;
};

// CSI Ps g Tab Clear (TBC).
// Ps = 0 -> Clear Current Column (default).
// Ps = 3 -> Clear All.
// Potentially:
// Ps = 2 -> Clear Stops on Line.
// http://vt100.net/annarbor/aaa-ug/section6.html
Terminal.prototype.tabClear = function(params) {
    var param = params[0];
    if (param <= 0) {
        delete this.tabs[this.x];
    } else if (param === 3) {
        this.tabs = {};
    }
};

// CSI Pm i Media Copy (MC).
// Ps = 0 -> Print screen (default).
// Ps = 4 -> Turn off printer controller mode.
// Ps = 5 -> Turn on printer controller mode.
// CSI ? Pm i
// Media Copy (MC, DEC-specific).
// Ps = 1 -> Print line containing cursor.
// Ps = 4 -> Turn off autoprint mode.
// Ps = 5 -> Turn on autoprint mode.
// Ps = 1 0 -> Print composed display, ignores DECPEX.
// Ps = 1 1 -> Print all pages.
Terminal.prototype.mediaCopy = function(params) {;
};

// CSI > Ps; Ps m
// Set or reset resource-values used by xterm to decide whether
// to construct escape sequences holding information about the
// modifiers pressed with a given key. The first parameter iden-
// tifies the resource to set/reset. The second parameter is the
// value to assign to the resource. If the second parameter is
// omitted, the resource is reset to its initial value.
// Ps = 1 -> modifyCursorKeys.
// Ps = 2 -> modifyFunctionKeys.
// Ps = 4 -> modifyOtherKeys.
// If no parameters are given, all resources are reset to their
// initial values.
Terminal.prototype.setResources = function(params) {;
};

// CSI > Ps n
// Disable modifiers which may be enabled via the CSI > Ps; Ps m
// sequence. This corresponds to a resource value of "-1", which
// cannot be set with the other sequence. The parameter identi-
// fies the resource to be disabled:
// Ps = 1 -> modifyCursorKeys.
// Ps = 2 -> modifyFunctionKeys.
// Ps = 4 -> modifyOtherKeys.
// If the parameter is omitted, modifyFunctionKeys is disabled.
// When modifyFunctionKeys is disabled, xterm uses the modifier
// keys to make an extended sequence of functions rather than
// adding a parameter to each function key to denote the modi-
// fiers.
Terminal.prototype.disableModifiers = function(params) {;
};

// CSI > Ps p
// Set resource value pointerMode. This is used by xterm to
// decide whether to hide the pointer cursor as the user types.
// Valid values for the parameter:
// Ps = 0 -> never hide the pointer.
// Ps = 1 -> hide if the mouse tracking mode is not enabled.
// Ps = 2 -> always hide the pointer. If no parameter is
// given, xterm uses the default, which is 1 .
Terminal.prototype.setPointerMode = function(params) {;
};

// CSI ! p Soft terminal reset (DECSTR).
// http://vt100.net/docs/vt220-rm/table4-10.html
Terminal.prototype.softReset = function(params) {
    this.cursorHidden = false;
    this.insertMode = false;
    this.originMode = false;
    this.wraparoundMode = false; // autowrap
    this.applicationKeypad = false; // ?
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.curAttr = this.defAttr;
    this.x = this.y = 0; // ?
    this.charset = null;
    this.glevel = 0; // ??
    this.charsets = [null]; // ??
};

// CSI Ps$ p
// Request ANSI mode (DECRQM). For VT300 and up, reply is
// CSI Ps; Pm$ y
// where Ps is the mode number as in RM, and Pm is the mode
// value:
// 0 - not recognized
// 1 - set
// 2 - reset
// 3 - permanently set
// 4 - permanently reset
Terminal.prototype.requestAnsiMode = function(params) {;
};

// CSI ? Ps$ p
// Request DEC private mode (DECRQM). For VT300 and up, reply is
// CSI ? Ps; Pm$ p
// where Ps is the mode number as in DECSET, Pm is the mode value
// as in the ANSI DECRQM.
Terminal.prototype.requestPrivateMode = function(params) {;
};

// CSI Ps ; Ps " p
// Set conformance level (DECSCL). Valid values for the first
// parameter:
// Ps = 6 1 -> VT100.
// Ps = 6 2 -> VT200.
// Ps = 6 3 -> VT300.
// Valid values for the second parameter:
// Ps = 0 -> 8-bit controls.
// Ps = 1 -> 7-bit controls (always set for VT100).
// Ps = 2 -> 8-bit controls.
Terminal.prototype.setConformanceLevel = function(params) {;
};

// CSI Ps q Load LEDs (DECLL).
// Ps = 0 -> Clear all LEDS (default).
// Ps = 1 -> Light Num Lock.
// Ps = 2 -> Light Caps Lock.
// Ps = 3 -> Light Scroll Lock.
// Ps = 2 1 -> Extinguish Num Lock.
// Ps = 2 2 -> Extinguish Caps Lock.
// Ps = 2 3 -> Extinguish Scroll Lock.
Terminal.prototype.loadLEDs = function(params) {;
};

// CSI Ps SP q
// Set cursor style (DECSCUSR, VT520).
// Ps = 0 -> blinking block.
// Ps = 1 -> blinking block (default).
// Ps = 2 -> steady block.
// Ps = 3 -> blinking underline.
// Ps = 4 -> steady underline.
Terminal.prototype.setCursorStyle = function(params) {;
};

// CSI Ps " q
// Select character protection attribute (DECSCA). Valid values
// for the parameter:
// Ps = 0 -> DECSED and DECSEL can erase (default).
// Ps = 1 -> DECSED and DECSEL cannot erase.
// Ps = 2 -> DECSED and DECSEL can erase.
Terminal.prototype.setCharProtectionAttr = function(params) {;
};

// CSI ? Pm r
// Restore DEC Private Mode Values. The value of Ps previously
// saved is restored. Ps values are the same as for DECSET.
Terminal.prototype.restorePrivateValues = function(params) {;
};

// CSI Pt; Pl; Pb; Pr; Ps$ r
// Change Attributes in Rectangular Area (DECCARA), VT400 and up.
// Pt; Pl; Pb; Pr denotes the rectangle.
// Ps denotes the SGR attributes to change: 0, 1, 4, 5, 7.
// NOTE: xterm doesn't enable this code by default.
Terminal.prototype.setAttrInRectangle = function(params) {
    var t = params[0],
        l = params[1],
        b = params[2],
        r = params[3],
        attr = params[4];

    var line, i;

    for (; t < b + 1; t++) {
        line = this.lines[this.ybase + t];
        for (i = l; i < r; i++) {
            line[i] = [attr, line[i][1]];
        }
    }

    // this.maxRange();
    this.updateRange(params[0]);
    this.updateRange(params[2]);
};

// CSI ? Pm s
// Save DEC Private Mode Values. Ps values are the same as for
// DECSET.
Terminal.prototype.savePrivateValues = function(params) {;
};

// CSI Ps ; Ps ; Ps t
// Window manipulation (from dtterm, as well as extensions).
// These controls may be disabled using the allowWindowOps
// resource. Valid values for the first (and any additional
// parameters) are:
// Ps = 1 -> De-iconify window.
// Ps = 2 -> Iconify window.
// Ps = 3 ; x ; y -> Move window to [x, y].
// Ps = 4 ; height ; width -> Resize the xterm window to
// height and width in pixels.
// Ps = 5 -> Raise the xterm window to the front of the stack-
// ing order.
// Ps = 6 -> Lower the xterm window to the bottom of the
// stacking order.
// Ps = 7 -> Refresh the xterm window.
// Ps = 8 ; height ; width -> Resize the text area to
// [height;width] in characters.
// Ps = 9 ; 0 -> Restore maximized window.
// Ps = 9 ; 1 -> Maximize window (i.e., resize to screen
// size).
// Ps = 1 0 ; 0 -> Undo full-screen mode.
// Ps = 1 0 ; 1 -> Change to full-screen.
// Ps = 1 1 -> Report xterm window state. If the xterm window
// is open (non-iconified), it returns CSI 1 t . If the xterm
// window is iconified, it returns CSI 2 t .
// Ps = 1 3 -> Report xterm window position. Result is CSI 3
// ; x ; y t
// Ps = 1 4 -> Report xterm window in pixels. Result is CSI
// 4 ; height ; width t
// Ps = 1 8 -> Report the size of the text area in characters.
// Result is CSI 8 ; height ; width t
// Ps = 1 9 -> Report the size of the screen in characters.
// Result is CSI 9 ; height ; width t
// Ps = 2 0 -> Report xterm window's icon label. Result is
// OSC L label ST
// Ps = 2 1 -> Report xterm window's title. Result is OSC l
// label ST
// Ps = 2 2 ; 0 -> Save xterm icon and window title on
// stack.
// Ps = 2 2 ; 1 -> Save xterm icon title on stack.
// Ps = 2 2 ; 2 -> Save xterm window title on stack.
// Ps = 2 3 ; 0 -> Restore xterm icon and window title from
// stack.
// Ps = 2 3 ; 1 -> Restore xterm icon title from stack.
// Ps = 2 3 ; 2 -> Restore xterm window title from stack.
// Ps >= 2 4 -> Resize to Ps lines (DECSLPP).
Terminal.prototype.manipulateWindow = function(params) {;
};

// CSI Pt; Pl; Pb; Pr; Ps$ t
// Reverse Attributes in Rectangular Area (DECRARA), VT400 and
// up.
// Pt; Pl; Pb; Pr denotes the rectangle.
// Ps denotes the attributes to reverse, i.e., 1, 4, 5, 7.
// NOTE: xterm doesn't enable this code by default.
Terminal.prototype.reverseAttrInRectangle = function(params) {;
};

// CSI > Ps; Ps t
// Set one or more features of the title modes. Each parameter
// enables a single feature.
// Ps = 0 -> Set window/icon labels using hexadecimal.
// Ps = 1 -> Query window/icon labels using hexadecimal.
// Ps = 2 -> Set window/icon labels using UTF-8.
// Ps = 3 -> Query window/icon labels using UTF-8. (See dis-
// cussion of "Title Modes")
Terminal.prototype.setTitleModeFeature = function(params) {;
};

// CSI Ps SP t
// Set warning-bell volume (DECSWBV, VT520).
// Ps = 0 or 1 -> off.
// Ps = 2 , 3 or 4 -> low.
// Ps = 5 , 6 , 7 , or 8 -> high.
Terminal.prototype.setWarningBellVolume = function(params) {;
};

// CSI Ps SP u
// Set margin-bell volume (DECSMBV, VT520).
// Ps = 1 -> off.
// Ps = 2 , 3 or 4 -> low.
// Ps = 0 , 5 , 6 , 7 , or 8 -> high.
Terminal.prototype.setMarginBellVolume = function(params) {;
};

// CSI Pt; Pl; Pb; Pr; Pp; Pt; Pl; Pp$ v
// Copy Rectangular Area (DECCRA, VT400 and up).
// Pt; Pl; Pb; Pr denotes the rectangle.
// Pp denotes the source page.
// Pt; Pl denotes the target location.
// Pp denotes the target page.
// NOTE: xterm doesn't enable this code by default.
Terminal.prototype.copyRectangle = function(params) {;
};

// CSI Pt ; Pl ; Pb ; Pr ' w
// Enable Filter Rectangle (DECEFR), VT420 and up.
// Parameters are [top;left;bottom;right].
// Defines the coordinates of a filter rectangle and activates
// it. Anytime the locator is detected outside of the filter
// rectangle, an outside rectangle event is generated and the
// rectangle is disabled. Filter rectangles are always treated
// as "one-shot" events. Any parameters that are omitted default
// to the current locator position. If all parameters are omit-
// ted, any locator motion will be reported. DECELR always can-
// cels any prevous rectangle definition.
Terminal.prototype.enableFilterRectangle = function(params) {;
};

// CSI Ps x Request Terminal Parameters (DECREQTPARM).
// if Ps is a "0" (default) or "1", and xterm is emulating VT100,
// the control sequence elicits a response of the same form whose
// parameters describe the terminal:
// Ps -> the given Ps incremented by 2.
// Pn = 1 <- no parity.
// Pn = 1 <- eight bits.
// Pn = 1 <- 2 8 transmit 38.4k baud.
// Pn = 1 <- 2 8 receive 38.4k baud.
// Pn = 1 <- clock multiplier.
// Pn = 0 <- STP flags.
Terminal.prototype.requestParameters = function(params) {;
};

// CSI Ps x Select Attribute Change Extent (DECSACE).
// Ps = 0 -> from start to end position, wrapped.
// Ps = 1 -> from start to end position, wrapped.
// Ps = 2 -> rectangle (exact).
Terminal.prototype.selectChangeExtent = function(params) {;
};

// CSI Pc; Pt; Pl; Pb; Pr$ x
// Fill Rectangular Area (DECFRA), VT420 and up.
// Pc is the character to use.
// Pt; Pl; Pb; Pr denotes the rectangle.
// NOTE: xterm doesn't enable this code by default.
Terminal.prototype.fillRectangle = function(params) {
    var ch = params[0],
        t = params[1],
        l = params[2],
        b = params[3],
        r = params[4];

    var line, i;

    for (; t < b + 1; t++) {
        line = this.lines[this.ybase + t];
        for (i = l; i < r; i++) {
            line[i] = [line[i][0], String.fromCharCode(ch)];
        }
    }

    // this.maxRange();
    this.updateRange(params[1]);
    this.updateRange(params[3]);
};

// CSI Ps ; Pu ' z
// Enable Locator Reporting (DECELR).
// Valid values for the first parameter:
// Ps = 0 -> Locator disabled (default).
// Ps = 1 -> Locator enabled.
// Ps = 2 -> Locator enabled for one report, then disabled.
// The second parameter specifies the coordinate unit for locator
// reports.
// Valid values for the second parameter:
// Pu = 0 <- or omitted -> default to character cells.
// Pu = 1 <- device physical pixels.
// Pu = 2 <- character cells.
Terminal.prototype.enableLocatorReporting = function(params) {
    var val = params[0] > 0;
    //this.mouseEvents = val;
    //this.decLocator = val;
};

// CSI Pt; Pl; Pb; Pr$ z
// Erase Rectangular Area (DECERA), VT400 and up.
// Pt; Pl; Pb; Pr denotes the rectangle.
// NOTE: xterm doesn't enable this code by default.
Terminal.prototype.eraseRectangle = function(params) {
    var t = params[0],
        l = params[1],
        b = params[2],
        r = params[3];

    var line, i, ch;

    ch = [this.curAttr, ' ']; // xterm?

    for (; t < b + 1; t++) {
        line = this.lines[this.ybase + t];
        for (i = l; i < r; i++) {
            line[i] = ch;
        }
    }

    // this.maxRange();
    this.updateRange(params[0]);
    this.updateRange(params[2]);
};

// CSI Pm ' {
// Select Locator Events (DECSLE).
// Valid values for the first (and any additional parameters)
// are:
// Ps = 0 -> only respond to explicit host requests (DECRQLP).
// (This is default). It also cancels any filter
// rectangle.
// Ps = 1 -> report button down transitions.
// Ps = 2 -> do not report button down transitions.
// Ps = 3 -> report button up transitions.
// Ps = 4 -> do not report button up transitions.
Terminal.prototype.setLocatorEvents = function(params) {;
};

// CSI Pt; Pl; Pb; Pr$ {
// Selective Erase Rectangular Area (DECSERA), VT400 and up.
// Pt; Pl; Pb; Pr denotes the rectangle.
Terminal.prototype.selectiveEraseRectangle = function(params) {;
};

// CSI Ps ' |
// Request Locator Position (DECRQLP).
// Valid values for the parameter are:
// Ps = 0 , 1 or omitted -> transmit a single DECLRP locator
// report.

// If Locator Reporting has been enabled by a DECELR, xterm will
// respond with a DECLRP Locator Report. This report is also
// generated on button up and down events if they have been
// enabled with a DECSLE, or when the locator is detected outside
// of a filter rectangle, if filter rectangles have been enabled
// with a DECEFR.

// -> CSI Pe ; Pb ; Pr ; Pc ; Pp & w

// Parameters are [event;button;row;column;page].
// Valid values for the event:
// Pe = 0 -> locator unavailable - no other parameters sent.
// Pe = 1 -> request - xterm received a DECRQLP.
// Pe = 2 -> left button down.
// Pe = 3 -> left button up.
// Pe = 4 -> middle button down.
// Pe = 5 -> middle button up.
// Pe = 6 -> right button down.
// Pe = 7 -> right button up.
// Pe = 8 -> M4 button down.
// Pe = 9 -> M4 button up.
// Pe = 1 0 -> locator outside filter rectangle.
// ``button'' parameter is a bitmask indicating which buttons are
// pressed:
// Pb = 0 <- no buttons down.
// Pb & 1 <- right button down.
// Pb & 2 <- middle button down.
// Pb & 4 <- left button down.
// Pb & 8 <- M4 button down.
// ``row'' and ``column'' parameters are the coordinates of the
// locator position in the xterm window, encoded as ASCII deci-
// mal.
// The ``page'' parameter is not used by xterm, and will be omit-
// ted.
Terminal.prototype.requestLocatorPosition = function(params) {;
};

// CSI P m SP }
// Insert P s Column(s) (default = 1) (DECIC), VT420 and up.
// NOTE: xterm doesn't enable this code by default.
Terminal.prototype.insertColumns = function() {
    var param = params[0],
        l = this.ybase + this.rows,
        ch = [this.curAttr, ' '] // xterm?
        ,
        i;

    while (param--) {
        for (i = this.ybase; i < l; i++) {
            this.lines[i].splice(this.x + 1, 0, ch);
            this.lines[i].pop();
        }
    }

    this.maxRange();
};

// CSI P m SP ~
// Delete P s Column(s) (default = 1) (DECDC), VT420 and up
// NOTE: xterm doesn't enable this code by default.
Terminal.prototype.deleteColumns = function() {
    var param = params[0],
        l = this.ybase + this.rows,
        ch = [this.curAttr, ' '] // xterm?
        ,
        i;

    while (param--) {
        for (i = this.ybase; i < l; i++) {
            this.lines[i].splice(this.x, 1);
            this.lines[i].push(ch);
        }
    }

    this.maxRange();
};

/**
* Character Sets
*/

Terminal.charsets = {};

// DEC Special Character and Line Drawing Set.
// http://vt100.net/docs/vt102-ug/table5-13.html
// A lot of curses apps use this if they see TERM=xterm.
// testing: echo -e '\e(0a\e(B'
// The xterm output sometimes seems to conflict with the
// reference above. xterm seems in line with the reference
// when running vttest however.
// The table below now uses xterm's output from vttest.
Terminal.charsets.SCLD = { // (0
    '`': '\u25c6', // '◆'
    'a': '\u2592', // '▒'
    'b': '\u0009', // '\t'
    'c': '\u000c', // '\f'
    'd': '\u000d', // '\r'
    'e': '\u000a', // '\n'
    'f': '\u00b0', // '°'
    'g': '\u00b1', // '±'
    'h': '\u2424', // '\u2424' (NL)
    'i': '\u000b', // '\v'
    'j': '\u2518', // '┘'
    'k': '\u2510', // '┐'
    'l': '\u250c', // '┌'
    'm': '\u2514', // '└'
    'n': '\u253c', // '┼'
    'o': '\u23ba', // '⎺'
    'p': '\u23bb', // '⎻'
    'q': '\u2500', // '─'
    'r': '\u23bc', // '⎼'
    's': '\u23bd', // '⎽'
    't': '\u251c', // '├'
    'u': '\u2524', // '┤'
    'v': '\u2534', // '┴'
    'w': '\u252c', // '┬'
    'x': '\u2502', // '│'
    'y': '\u2264', // '≤'
    'z': '\u2265', // '≥'
    '{': '\u03c0', // 'π'
    '|': '\u2260', // '≠'
    '}': '\u00a3', // '£'
    '~': '\u00b7' // '·'
};

Terminal.charsets.UK = null; // (A
Terminal.charsets.US = null; // (B (USASCII)
Terminal.charsets.Dutch = null; // (4
Terminal.charsets.Finnish = null; // (C or (5
Terminal.charsets.French = null; // (R
Terminal.charsets.FrenchCanadian = null; // (Q
Terminal.charsets.German = null; // (K
Terminal.charsets.Italian = null; // (Y
Terminal.charsets.NorwegianDanish = null; // (E or (6
Terminal.charsets.Spanish = null; // (Z
Terminal.charsets.Swedish = null; // (H or (7
Terminal.charsets.Swiss = null; // (=
Terminal.charsets.ISOLatin = null; // /A


/**
* Expose
*/

Terminal.EventEmitter = EventEmitter;
Terminal.on = on;
Terminal.off = off;
Terminal.cancel = cancel;
