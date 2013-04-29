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

require('./lib/debug')(Terminal);

require('./lib/send')(Terminal);
require('./lib/resize')(Terminal);
require('./lib/stops')(Terminal);

require('./lib/erase')(Terminal);
require('./lib/blankLine')(Terminal);


Terminal.prototype.updateRange = function(y) {
    if (y < this.refreshStart) this.refreshStart = y;
    if (y > this.refreshEnd) this.refreshEnd = y;
};

Terminal.prototype.maxRange = function() {
    this.refreshStart = 0;
    this.refreshEnd = this.rows - 1;
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

require('./lib/ESC.js')(Terminal);

require('./lib/csi/deviceStatus')(Terminal);
require('./lib/csi/charAttributes')(Terminal);
require('./lib/csi/insert-delete')(Terminal);
require('./lib/csi/position')(Terminal);
require('./lib/csi/sendDeviceAttributes')(Terminal);
require('./lib/csi/cursor')(Terminal);
require('./lib/csi/scroll')(Terminal);
require('./lib/csi/rectangle')(Terminal);
require('./lib/csi/repeatPrecedingCharacter')(Terminal);
require('./lib/csi/tabClear')(Terminal);
require('./lib/csi/softReset')(Terminal);






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
