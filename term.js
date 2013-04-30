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

var EventEmitter = require('events').EventEmitter;

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

require('./lib/open')(Terminal);
require('./lib/destroy')(Terminal);
require('./lib/refresh')(Terminal);

require('./lib/write')(Terminal);

require('./lib/setgLevel');
require('./lib/setgCharset');

require('./lib/debug')(Terminal);

require('./lib/stops')(Terminal);

require('./lib/erase')(Terminal);
require('./lib/blankLine')(Terminal);
require('./lib/range')(Terminal);
require('./lib/util')(Terminal);

require('./lib/handlers')(Terminal);

require('./lib/esc/index.js')(Terminal);
require('./lib/esc/reset.js')(Terminal);
require('./lib/esc/tabSet.js')(Terminal);

require('./lib/csi/charAttributes')(Terminal);
require('./lib/csi/insert-delete')(Terminal);
require('./lib/csi/position')(Terminal);
require('./lib/csi/cursor')(Terminal);
require('./lib/csi/repeatPrecedingCharacter')(Terminal);
require('./lib/csi/tabClear')(Terminal);
require('./lib/csi/softReset')(Terminal);

require('./lib/charsets.js')(Terminal);

Terminal.EventEmitter = EventEmitter;
Terminal.on = on;
Terminal.off = off;
Terminal.cancel = cancel;
