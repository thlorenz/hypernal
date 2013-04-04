;(function(e,t,n){function i(n,s){if(!t[n]){if(!e[n]){var o=typeof require=="function"&&require;if(!s&&o)return o(n,!0);if(r)return r(n,!0);throw new Error("Cannot find module '"+n+"'")}var u=t[n]={exports:{}};e[n][0](function(t){var r=e[n][1][t];return i(r?r:t)},u,u.exports)}return t[n].exports}var r=typeof require=="function"&&require;for(var s=0;s<n.length;s++)i(n[s]);return i})({1:[function(require,module,exports){
(function(){/**
* States
*/
var normal = 0,
    escaped = 1,
    csi = 2,
    osc = 3,
    charset = 4,
    dcs = 5,
    ignore = 6;

/**
* Terminal
*/

var EventEmitter = require('events')
    .EventEmitter;

module.exports = Terminal;

function Terminal(cols, rows, opts) {
    if (!(this instanceof Terminal)) return new Terminal(cols, rows, handler);
    EventEmitter.call(this);

    this._options = opts || {};

    this.cols = cols || Terminal.geometry[0];
    this.rows = rows || Terminal.geometry[1];

    if (this._options.handler) {
        this.on('data', handler);
    }

    this.ybase = 0;
    this.ydisp = 0;
    this.x = 0;
    this.y = 0;
    this.cursorState = 0;
    this.cursorHidden = false;
    this.convertEol = false;
    this.state = 0;
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

/**
* Colors
*/

// Colors 0-15
Terminal.colors = [
// dark:
'#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf',
// bright:
'#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec'];

// Colors 16-255
// Much thanks to TooTallNate for writing this.
Terminal.colors = (function() {
    var colors = Terminal.colors,
        r = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff],
        i;

    // 16-231
    i = 0;
    for (; i < 216; i++) {
        out(r[(i / 36) % 6 | 0], r[(i / 6) % 6 | 0], r[i % 6]);
    }

    // 232-255 (grey)
    i = 0;
    for (; i < 24; i++) {
        r = 8 + i * 10;
        out(r, r, r);
    }

    function out(r, g, b) {
        colors.push('#' + hex(r) + hex(g) + hex(b));
    }

    function hex(c) {
        c = c.toString(16);
        return c.length < 2 ? '0' + c : c;
    }

    return colors;
})();

// Default BG/FG
Terminal.defaultColors = {
    bg: '#000000',
    fg: '#f0f0f0'
};

Terminal.colors[256] = Terminal.defaultColors.bg;
Terminal.colors[257] = Terminal.defaultColors.fg;

/**
* Options
*/

Terminal.termName = 'xterm';
Terminal.geometry = [80, 24];
Terminal.cursorBlink = true;
Terminal.visualBell = false;
Terminal.popOnBell = false;
Terminal.scrollback = 1000;
Terminal.screenKeys = false;
Terminal.programFeatures = false;
Terminal.debug = false;

/**
* Focused Terminal
*/

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

/**
* Open Terminal
*/

Terminal.prototype.open = function() {
    var self = this,
        i = 0,
        div;

    this.element = document.createElement('div');
    this.element.className = 'terminal';
    this.children = [];

    for (; i < this.rows; i++) {
        div = document.createElement('div');
        this.element.appendChild(div);
        this.children.push(div);
    }

    //document.body.appendChild(this.element);

    this.refresh(0, this.rows - 1);

    //Terminal.bindKeys();
    this.focus();

    this.startBlink();

    on(this.element, 'mousedown', function() {
        self.focus();
    });

    // This probably shouldn't work,
    // ... but it does. Firefox's paste
    // event seems to only work for textareas?
    on(this.element, 'mousedown', function(ev) {
        var button = ev.button != null ? +ev.button : ev.which != null ? ev.which - 1 : null;

        // Does IE9 do this?
        if (~navigator.userAgent.indexOf('MSIE')) {
            button = button === 1 ? 0 : button === 4 ? 1 : button;
        }

        if (button !== 2) return;

        self.element.contentEditable = 'true';
        setTimeout(function() {
            self.element.contentEditable = 'inherit'; // 'false';
        }, 1);
    }, true);

    on(this.element, 'paste', function(ev) {
        if (ev.clipboardData) {
            self.send(ev.clipboardData.getData('text/plain'));
        } else if (window.clipboardData) {
            self.send(window.clipboardData.getData('Text'));
        }
        // Not necessary. Do it anyway for good measure.
        self.element.contentEditable = 'inherit';
        return cancel(ev);
    });

    this.bindMouse();

    // XXX - hack, move this somewhere else.
    if (Terminal.brokenBold == null) {
        Terminal.brokenBold = isBoldBroken();
    }

    // sync default bg/fg colors
    this.element.style.backgroundColor = Terminal.defaultColors.bg;
    this.element.style.color = Terminal.defaultColors.fg;

    //this.emit('open');
};

// XTerm mouse events
// http://invisible-island.net/xterm/ctlseqs/ctlseqs.html#Mouse%20Tracking
// To better understand these
// the xterm code is very helpful:
// Relevant files:
// button.c, charproc.c, misc.c
// Relevant functions in xterm/button.c:
// BtnCode, EmitButtonCode, EditorButton, SendMousePosition
Terminal.prototype.bindMouse = function() {
    var el = this.element,
        self = this,
        pressed = 32;

    var wheelEvent = 'onmousewheel' in window ? 'mousewheel' : 'DOMMouseScroll';

    // mouseup, mousedown, mousewheel
    // left click: ^[[M 3<^[[M#3<
    // mousewheel up: ^[[M`3>
    function sendButton(ev) {
        var button, pos;

        // get the xterm-style button
        button = getButton(ev);

        // get mouse coordinates
        pos = getCoords(ev);
        if (!pos) return;

        sendEvent(button, pos);

        switch (ev.type) {
        case 'mousedown':
            pressed = button;
            break;
        case 'mouseup':
            // keep it at the left
            // button, just in case.
            pressed = 32;
            break;
        case wheelEvent:
            // nothing. don't
            // interfere with
            // `pressed`.
            break;
        }
    }

    // motion example of a left click:
    // ^[[M 3<^[[M@4<^[[M@5<^[[M@6<^[[M@7<^[[M#7<
    function sendMove(ev) {
        var button = pressed,
            pos;

        pos = getCoords(ev);
        if (!pos) return;

        // buttons marked as motions
        // are incremented by 32
        button += 32;

        sendEvent(button, pos);
    }

    // encode button and
    // position to characters
    function encode(data, ch) {
        if (!self.utfMouse) {
            if (ch === 255) return data.push(0);
            if (ch > 127) ch = 127;
            data.push(ch);
        } else {
            if (ch === 2047) return data.push(0);
            if (ch < 127) {
                data.push(ch);
            } else {
                if (ch > 2047) ch = 2047;
                data.push(0xC0 | (ch >> 6));
                data.push(0x80 | (ch & 0x3F));
            }
        }
    }

    // send a mouse event:
    // regular/utf8: ^[[M Cb Cx Cy
    // urxvt: ^[[ Cb ; Cx ; Cy M
    // sgr: ^[[ Cb ; Cx ; Cy M/m
    // vt300: ^[[ 24(1/3/5)~ [ Cx , Cy ] \r
    // locator: CSI P e ; P b ; P r ; P c ; P p & w
    function sendEvent(button, pos) {
        // self.emit('mouse', {
        // x: pos.x - 32,
        // y: pos.x - 32,
        // button: button
        // });

        if (self.vt300Mouse) {
            // NOTE: Unstable.
            // http://www.vt100.net/docs/vt3xx-gp/chapter15.html
            button &= 3;
            pos.x -= 32;
            pos.y -= 32;
            var data = '\x1b[24';
            if (button === 0) data += '1';
            else if (button === 1) data += '3';
            else if (button === 2) data += '5';
            else if (button === 3) return;
            else data += '0';
            data += '~[' + pos.x + ',' + pos.y + ']\r';
            self.send(data);
            return;
        }

        if (self.decLocator) {
            // NOTE: Unstable.
            button &= 3;
            pos.x -= 32;
            pos.y -= 32;
            if (button === 0) button = 2;
            else if (button === 1) button = 4;
            else if (button === 2) button = 6;
            else if (button === 3) button = 3;
            self.send('\x1b[' + button + ';' + (button === 3 ? 4 : 0) + ';' + pos.y + ';' + pos.x + ';' + (pos.page || 0) + '&w');
            return;
        }

        if (self.urxvtMouse) {
            pos.x -= 32;
            pos.y -= 32;
            pos.x++;
            pos.y++;
            self.send('\x1b[' + button + ';' + pos.x + ';' + pos.y + 'M');
            return;
        }

        if (self.sgrMouse) {
            pos.x -= 32;
            pos.y -= 32;
            self.send('\x1b[<' + ((button & 3) === 3 ? button & ~3 : button) + ';' + pos.x + ';' + pos.y + ((button & 3) === 3 ? 'm' : 'M'));
            return;
        }

        var data = [];

        encode(data, button);
        encode(data, pos.x);
        encode(data, pos.y);

        self.send('\x1b[M' + String.fromCharCode.apply(String, data));
    }

    function getButton(ev) {
        var button, shift, meta, ctrl, mod;

        // two low bits:
        // 0 = left
        // 1 = middle
        // 2 = right
        // 3 = release
        // wheel up/down:
        // 1, and 2 - with 64 added
        switch (ev.type) {
        case 'mousedown':
            button = ev.button != null ? +ev.button : ev.which != null ? ev.which - 1 : null;

            if (~navigator.userAgent.indexOf('MSIE')) {
                button = button === 1 ? 0 : button === 4 ? 1 : button;
            }
            break;
        case 'mouseup':
            button = 3;
            break;
        case 'DOMMouseScroll':
            button = ev.detail < 0 ? 64 : 65;
            break;
        case 'mousewheel':
            button = ev.wheelDeltaY > 0 ? 64 : 65;
            break;
        }

        // next three bits are the modifiers:
        // 4 = shift, 8 = meta, 16 = control
        shift = ev.shiftKey ? 4 : 0;
        meta = ev.metaKey ? 8 : 0;
        ctrl = ev.ctrlKey ? 16 : 0;
        mod = shift | meta | ctrl;

        // no mods
        if (self.vt200Mouse) {
            // ctrl only
            mod &= ctrl;
        } else if (!self.normalMouse) {
            mod = 0;
        }

        // increment to SP
        button = (32 + (mod << 2)) + button;

        return button;
    }

    // mouse coordinates measured in cols/rows
    function getCoords(ev) {
        var x, y, w, h, el;

        // ignore browsers without pageX for now
        if (ev.pageX == null) return;

        x = ev.pageX;
        y = ev.pageY;
        el = self.element;

        // should probably check offsetParent
        // but this is more portable
        while (el !== document.documentElement) {
            x -= el.offsetLeft;
            y -= el.offsetTop;
            el = el.parentNode;
        }

        // convert to cols/rows
        w = self.element.clientWidth;
        h = self.element.clientHeight;
        x = ((x / w) * self.cols) | 0;
        y = ((y / h) * self.rows) | 0;

        // be sure to avoid sending
        // bad positions to the program
        if (x < 0) x = 0;
        if (x > self.cols) x = self.cols;
        if (y < 0) y = 0;
        if (y > self.rows) y = self.rows;

        // xterm sends raw bytes and
        // starts at 32 (SP) for each.
        x += 32;
        y += 32;

        return {
            x: x,
            y: y,
            down: ev.type === 'mousedown',
            up: ev.type === 'mouseup',
            wheel: ev.type === wheelEvent,
            move: ev.type === 'mousemove'
        };
    }

    on(el, 'mousedown', function(ev) {
        if (!self.mouseEvents) return;

        // send the button
        sendButton(ev);

        // ensure focus
        self.focus();

        // fix for odd bug
        if (self.vt200Mouse) {
            sendButton({
                __proto__: ev,
                type: 'mouseup'
            });
            return cancel(ev);
        }

        // bind events
        if (self.normalMouse) on(document, 'mousemove', sendMove);

        // x10 compatibility mode can't send button releases
        if (!self.x10Mouse) {
            on(document, 'mouseup', function up(ev) {
                sendButton(ev);
                if (self.normalMouse) off(document, 'mousemove', sendMove);
                off(document, 'mouseup', up);
                return cancel(ev);
            });
        }

        return cancel(ev);
    });

    on(el, wheelEvent, function(ev) {
        if (!self.mouseEvents) return;
        if (self.x10Mouse || self.vt300Mouse || self.decLocator) return;
        sendButton(ev);
        return cancel(ev);
    });

    // allow mousewheel scrolling in
    // the shell for example
    on(el, wheelEvent, function(ev) {
        if (self.mouseEvents) return;
        if (self.applicationKeypad) return;
        if (ev.type === 'DOMMouseScroll') {
            self.scrollDisp(ev.detail < 0 ? -5 : 5);
        } else {
            self.scrollDisp(ev.wheelDeltaY > 0 ? -5 : 5);
        }
        return cancel(ev);
    });
};

/**
* Destroy Terminal
*/

Terminal.prototype.destroy = function() {
    this.readable = false;
    this.writable = false;
    this._events = {};
    this.handler = function() {};
    this.write = function() {};
    //this.emit('close');
};

/**
* Rendering Engine
*/

// In the screen buffer, each character
// is stored as a an array with a character
// and a 32-bit integer.
// First value: a utf-16 character.
// Second value:
// Next 9 bits: background color (0-511).
// Next 9 bits: foreground color (0-511).
// Next 14 bits: a mask for misc. flags:
// 1=bold, 2=underline, 4=inverse

Terminal.prototype.refresh = function(start, end) {
    var x, y, i, line, out, ch, width, data, attr, fgColor, bgColor, flags, row, parent;

    if (end - start >= this.rows / 2) {
        parent = this.element.parentNode;
        if (parent) parent.removeChild(this.element);
    }

    width = this.cols;
    y = start;

    // if (end > this.lines.length) {
    // end = this.lines.length;
    // }

    for (; y <= end; y++) {
        row = y + this.ydisp;

        line = this.lines[row];
        out = '';

        if (y === this.y && this.cursorState && this.ydisp === this.ybase && !this.cursorHidden) {
            x = this.x;
        } else {
            x = -1;
        }

        attr = this.defAttr;
        i = 0;

        for (; i < width; i++) {
            data = line[i][0];
            ch = line[i][1];

            if (i === x) data = -1;

            if (data !== attr) {
                if (attr !== this.defAttr) {
                    out += '</span>';
                }
                if (data !== this.defAttr) {
                    if (data === -1) {
                        out += '<span class="reverse-video">';
                    } else {
                        out += '<span style="';

                        bgColor = data & 0x1ff;
                        fgColor = (data >> 9) & 0x1ff;
                        flags = data >> 18;

                        if (flags & 1) {
                            if (!Terminal.brokenBold) {
                                out += 'font-weight:bold;';
                            }
                            // see: XTerm*boldColors
                            if (fgColor < 8) fgColor += 8;
                        }

                        if (flags & 2) {
                            out += 'text-decoration:underline;';
                        }

                        if (bgColor !== 256) {
                            out += 'background-color:' + Terminal.colors[bgColor] + ';';
                        }

                        if (fgColor !== 257) {
                            out += 'color:' + Terminal.colors[fgColor] + ';';
                        }

                        out += '">';
                    }
                }
            }

            switch (ch) {
            case '&':
                out += '&';
                break;
            case '<':
                out += '<';
                break;
            case '>':
                out += '>';
                break;
            default:
                if (ch <= ' ') {
                    out += ' ';
                } else {
                    out += ch;
                }
                break;
            }

            attr = data;
        }

        if (attr !== this.defAttr) {
            out += '</span>';
        }

        this.children[y].innerHTML = out;
    }

    if (parent) parent.appendChild(this.element);
};

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

Terminal.prototype.scroll = function() {
    var row;

    if (++this.ybase === Terminal.scrollback) {
        this.ybase = this.ybase / 2 | 0;
        this.lines = this.lines.slice(-(this.ybase + this.rows) + 1);
    }

    this.ydisp = this.ybase;

    // last line
    row = this.ybase + this.rows - 1;

    // subtract the bottom scroll region
    row -= this.rows - 1 - this.scrollBottom;

    if (row === this.lines.length) {
        // potential optimization:
        // pushing is faster than splicing
        // when they amount to the same
        // behavior.
        this.lines.push(this.blankLine());
    } else {
        // add our new line
        this.lines.splice(row, 0, this.blankLine());
    }

    if (this.scrollTop !== 0) {
        if (this.ybase !== 0) {
            this.ybase--;
            this.ydisp = this.ybase;
        }
        this.lines.splice(this.ybase + this.scrollTop, 1);
    }

    // this.maxRange();
    this.updateRange(this.scrollTop);
    this.updateRange(this.scrollBottom);
};

Terminal.prototype.scrollDisp = function(disp) {
    this.ydisp += disp;

    if (this.ydisp > this.ybase) {
        this.ydisp = this.ybase;
    } else if (this.ydisp < 0) {
        this.ydisp = 0;
    }

    this.refresh(0, this.rows - 1);
};

Terminal.prototype.write = function(data) {
    var l = data.length,
        i = 0,
        cs, ch;

    this.refreshStart = this.y;
    this.refreshEnd = this.y;

    if (this.ybase !== this.ydisp) {
        this.ydisp = this.ybase;
        this.maxRange();
    }

    // this.log(JSON.stringify(data.replace(/\x1b/g, '^[')));

    for (; i < l; i++) {
        ch = data[i];
        switch (this.state) {
        case normal:
            switch (ch) {
                // '\0'
                // case '\0':
                // break;

                // '\a'
            case '\x07':
                this.bell();
                break;

                // '\n', '\v', '\f'
            case '\n':
            case '\x0b':
            case '\x0c':
                if (this.convertEol) {
                    this.x = 0;
                }
                this.y++;
                if (this.y > this.scrollBottom) {
                    this.y--;
                    this.scroll();
                }
                break;

                // '\r'
            case '\r':
                this.x = 0;
                break;

                // '\b'
            case '\x08':
                if (this.x > 0) {
                    this.x--;
                }
                break;

                // '\t'
            case '\t':
                this.x = this.nextStop();
                break;

                // shift out
            case '\x0e':
                this.setgLevel(1);
                break;

                // shift in
            case '\x0f':
                this.setgLevel(0);
                break;

                // '\e'
            case '\x1b':
                this.state = escaped;
                break;

            default:
                // ' '
                if (ch >= ' ') {
                    if (this.charset && this.charset[ch]) {
                        ch = this.charset[ch];
                    }
                    if (this.x >= this.cols) {
                        this.x = 0;
                        this.y++;
                        if (this.y > this.scrollBottom) {
                            this.y--;
                            this.scroll();
                        }
                    }
                    this.lines[this.y + this.ybase][this.x] = [this.curAttr, ch];
                    this.x++;
                    this.updateRange(this.y);
                }
                break;
            }
            break;
        case escaped:
            switch (ch) {
                // ESC [ Control Sequence Introducer ( CSI is 0x9b).
            case '[':
                this.params = [];
                this.currentParam = 0;
                this.state = csi;
                break;

                // ESC ] Operating System Command ( OSC is 0x9d).
            case ']':
                this.params = [];
                this.currentParam = 0;
                this.state = osc;
                break;

                // ESC P Device Control String ( DCS is 0x90).
            case 'P':
                this.params = [];
                this.currentParam = 0;
                this.state = dcs;
                break;

                // ESC _ Application Program Command ( APC is 0x9f).
            case '_':
                this.stateType = 'apc';
                this.state = ignore;
                break;

                // ESC ^ Privacy Message ( PM is 0x9e).
            case '^':
                this.stateType = 'pm';
                this.state = ignore;
                break;

                // ESC c Full Reset (RIS).
            case 'c':
                this.reset();
                break;

                // ESC E Next Line ( NEL is 0x85).
                // ESC D Index ( IND is 0x84).
            case 'E':
                this.x = 0;;
            case 'D':
                this.index();
                break;

                // ESC M Reverse Index ( RI is 0x8d).
            case 'M':
                this.reverseIndex();
                break;

                // ESC % Select default/utf-8 character set.
                // @ = default, G = utf-8
            case '%':
                //this.charset = null;
                this.setgLevel(0);
                this.setgCharset(0, Terminal.charsets.US);
                this.state = normal;
                i++;
                break;

                // ESC (,),*,+,-,. Designate G0-G2 Character Set.
            case '(':
                // <-- this seems to get all the attention
            case ')':
            case '*':
            case '+':
            case '-':
            case '.':
                switch (ch) {
                case '(':
                    this.gcharset = 0;
                    break;
                case ')':
                    this.gcharset = 1;
                    break;
                case '*':
                    this.gcharset = 2;
                    break;
                case '+':
                    this.gcharset = 3;
                    break;
                case '-':
                    this.gcharset = 1;
                    break;
                case '.':
                    this.gcharset = 2;
                    break;
                }
                this.state = charset;
                break;

                // Designate G3 Character Set (VT300).
                // A = ISO Latin-1 Supplemental.
                // Not implemented.
            case '/':
                this.gcharset = 3;
                this.state = charset;
                i--;
                break;

                // ESC N
                // Single Shift Select of G2 Character Set
                // ( SS2 is 0x8e). This affects next character only.
            case 'N':
                break;
                // ESC O
                // Single Shift Select of G3 Character Set
                // ( SS3 is 0x8f). This affects next character only.
            case 'O':
                break;
                // ESC n
                // Invoke the G2 Character Set as GL (LS2).
            case 'n':
                this.setgLevel(2);
                break;
                // ESC o
                // Invoke the G3 Character Set as GL (LS3).
            case 'o':
                this.setgLevel(3);
                break;
                // ESC |
                // Invoke the G3 Character Set as GR (LS3R).
            case '|':
                this.setgLevel(3);
                break;
                // ESC }
                // Invoke the G2 Character Set as GR (LS2R).
            case '}':
                this.setgLevel(2);
                break;
                // ESC ~
                // Invoke the G1 Character Set as GR (LS1R).
            case '~':
                this.setgLevel(1);
                break;

                // ESC 7 Save Cursor (DECSC).
            case '7':
                this.saveCursor();
                this.state = normal;
                break;

                // ESC 8 Restore Cursor (DECRC).
            case '8':
                this.restoreCursor();
                this.state = normal;
                break;

                // ESC # 3 DEC line height/width
            case '#':
                this.state = normal;
                i++;
                break;

                // ESC H Tab Set (HTS is 0x88).
            case 'H':
                this.tabSet();
                break;

                // ESC = Application Keypad (DECPAM).
            case '=':
                this.log('Serial port requested application keypad.');
                this.applicationKeypad = true;
                this.state = normal;
                break;

                // ESC > Normal Keypad (DECPNM).
            case '>':
                this.log('Switching back to normal keypad.');
                this.applicationKeypad = false;
                this.state = normal;
                break;

            default:
                this.state = normal;
                this.error('Unknown ESC control: %s.', ch);
                break;
            }
            break;

        case charset:
            switch (ch) {
            case '0':
                // DEC Special Character and Line Drawing Set.
                cs = Terminal.charsets.SCLD;
                break;
            case 'A':
                // UK
                cs = Terminal.charsets.UK;
                break;
            case 'B':
                // United States (USASCII).
                cs = Terminal.charsets.US;
                break;
            case '4':
                // Dutch
                cs = Terminal.charsets.Dutch;
                break;
            case 'C':
                // Finnish
            case '5':
                cs = Terminal.charsets.Finnish;
                break;
            case 'R':
                // French
                cs = Terminal.charsets.French;
                break;
            case 'Q':
                // FrenchCanadian
                cs = Terminal.charsets.FrenchCanadian;
                break;
            case 'K':
                // German
                cs = Terminal.charsets.German;
                break;
            case 'Y':
                // Italian
                cs = Terminal.charsets.Italian;
                break;
            case 'E':
                // NorwegianDanish
            case '6':
                cs = Terminal.charsets.NorwegianDanish;
                break;
            case 'Z':
                // Spanish
                cs = Terminal.charsets.Spanish;
                break;
            case 'H':
                // Swedish
            case '7':
                cs = Terminal.charsets.Swedish;
                break;
            case '=':
                // Swiss
                cs = Terminal.charsets.Swiss;
                break;
            case '/':
                // ISOLatin (actually /A)
                cs = Terminal.charsets.ISOLatin;
                i++;
                break;
            default:
                // Default
                cs = Terminal.charsets.US;
                break;
            }
            this.setgCharset(this.gcharset, cs);
            this.gcharset = null;
            this.state = normal;
            break;

        case osc:
            // OSC Ps ; Pt ST
            // OSC Ps ; Pt BEL
            // Set Text Parameters.
            if (ch === '\x1b' || ch === '\x07') {
                if (ch === '\x1b') i++;

                this.params.push(this.currentParam);

                switch (this.params[0]) {
                case 0:
                case 1:
                case 2:
                    if (this.params[1]) {
                        this.title = this.params[1];
                        this.handleTitle(this.title);
                    }
                    break;
                case 3:
                    // set X property
                    break;
                case 4:
                case 5:
                    // change dynamic colors
                    break;
                case 10:
                case 11:
                case 12:
                case 13:
                case 14:
                case 15:
                case 16:
                case 17:
                case 18:
                case 19:
                    // change dynamic ui colors
                    break;
                case 46:
                    // change log file
                    break;
                case 50:
                    // dynamic font
                    break;
                case 51:
                    // emacs shell
                    break;
                case 52:
                    // manipulate selection data
                    break;
                case 104:
                case 105:
                case 110:
                case 111:
                case 112:
                case 113:
                case 114:
                case 115:
                case 116:
                case 117:
                case 118:
                    // reset colors
                    break;
                }

                this.params = [];
                this.currentParam = 0;
                this.state = normal;
            } else {
                if (!this.params.length) {
                    if (ch >= '0' && ch <= '9') {
                        this.currentParam = this.currentParam * 10 + ch.charCodeAt(0) - 48;
                    } else if (ch === ';') {
                        this.params.push(this.currentParam);
                        this.currentParam = '';
                    }
                } else {
                    this.currentParam += ch;
                }
            }
            break;

        case csi:
            // '?', '>', '!'
            if (ch === '?' || ch === '>' || ch === '!') {
                this.prefix = ch;
                break;
            }

            // 0 - 9
            if (ch >= '0' && ch <= '9') {
                this.currentParam = this.currentParam * 10 + ch.charCodeAt(0) - 48;
                break;
            }

            // '$', '"', ' ', '\''
            if (ch === '$' || ch === '"' || ch === ' ' || ch === '\'') {
                this.postfix = ch;
                break;
            }

            this.params.push(this.currentParam);
            this.currentParam = 0;

            // ';'
            if (ch === ';') break;

            this.state = normal;

            switch (ch) {
                // CSI Ps A
                // Cursor Up Ps Times (default = 1) (CUU).
            case 'A':
                this.cursorUp(this.params);
                break;

                // CSI Ps B
                // Cursor Down Ps Times (default = 1) (CUD).
            case 'B':
                this.cursorDown(this.params);
                break;

                // CSI Ps C
                // Cursor Forward Ps Times (default = 1) (CUF).
            case 'C':
                this.cursorForward(this.params);
                break;

                // CSI Ps D
                // Cursor Backward Ps Times (default = 1) (CUB).
            case 'D':
                this.cursorBackward(this.params);
                break;

                // CSI Ps ; Ps H
                // Cursor Position [row;column] (default = [1,1]) (CUP).
            case 'H':
                this.cursorPos(this.params);
                break;

                // CSI Ps J Erase in Display (ED).
            case 'J':
                this.eraseInDisplay(this.params);
                break;

                // CSI Ps K Erase in Line (EL).
            case 'K':
                this.eraseInLine(this.params);
                break;

                // CSI Pm m Character Attributes (SGR).
            case 'm':
                this.charAttributes(this.params);
                break;

                // CSI Ps n Device Status Report (DSR).
            case 'n':
                this.deviceStatus(this.params);
                break;

                /**
                 * Additions
                 */

                // CSI Ps @
                // Insert Ps (Blank) Character(s) (default = 1) (ICH).
            case '@':
                this.insertChars(this.params);
                break;

                // CSI Ps E
                // Cursor Next Line Ps Times (default = 1) (CNL).
            case 'E':
                this.cursorNextLine(this.params);
                break;

                // CSI Ps F
                // Cursor Preceding Line Ps Times (default = 1) (CNL).
            case 'F':
                this.cursorPrecedingLine(this.params);
                break;

                // CSI Ps G
                // Cursor Character Absolute [column] (default = [row,1]) (CHA).
            case 'G':
                this.cursorCharAbsolute(this.params);
                break;

                // CSI Ps L
                // Insert Ps Line(s) (default = 1) (IL).
            case 'L':
                this.insertLines(this.params);
                break;

                // CSI Ps M
                // Delete Ps Line(s) (default = 1) (DL).
            case 'M':
                this.deleteLines(this.params);
                break;

                // CSI Ps P
                // Delete Ps Character(s) (default = 1) (DCH).
            case 'P':
                this.deleteChars(this.params);
                break;

                // CSI Ps X
                // Erase Ps Character(s) (default = 1) (ECH).
            case 'X':
                this.eraseChars(this.params);
                break;

                // CSI Pm ` Character Position Absolute
                // [column] (default = [row,1]) (HPA).
            case '`':
                this.charPosAbsolute(this.params);
                break;

                // 141 61 a * HPR -
                // Horizontal Position Relative
            case 'a':
                this.HPositionRelative(this.params);
                break;

                // CSI P s c
                // Send Device Attributes (Primary DA).
                // CSI > P s c
                // Send Device Attributes (Secondary DA)
            case 'c':
                this.sendDeviceAttributes(this.params);
                break;

                // CSI Pm d
                // Line Position Absolute [row] (default = [1,column]) (VPA).
            case 'd':
                this.linePosAbsolute(this.params);
                break;

                // 145 65 e * VPR - Vertical Position Relative
            case 'e':
                this.VPositionRelative(this.params);
                break;

                // CSI Ps ; Ps f
                // Horizontal and Vertical Position [row;column] (default =
                // [1,1]) (HVP).
            case 'f':
                this.HVPosition(this.params);
                break;

                // CSI Pm h Set Mode (SM).
                // CSI ? Pm h - mouse escape codes, cursor escape codes
            case 'h':
                this.setMode(this.params);
                break;

                // CSI Pm l Reset Mode (RM).
                // CSI ? Pm l
            case 'l':
                this.resetMode(this.params);
                break;

                // CSI Ps ; Ps r
                // Set Scrolling Region [top;bottom] (default = full size of win-
                // dow) (DECSTBM).
                // CSI ? Pm r
            case 'r':
                this.setScrollRegion(this.params);
                break;

                // CSI s
                // Save cursor (ANSI.SYS).
            case 's':
                this.saveCursor(this.params);
                break;

                // CSI u
                // Restore cursor (ANSI.SYS).
            case 'u':
                this.restoreCursor(this.params);
                break;

                /**
                 * Lesser Used
                 */

                // CSI Ps I
                // Cursor Forward Tabulation Ps tab stops (default = 1) (CHT).
            case 'I':
                this.cursorForwardTab(this.params);
                break;

                // CSI Ps S Scroll up Ps lines (default = 1) (SU).
            case 'S':
                this.scrollUp(this.params);
                break;

                // CSI Ps T Scroll down Ps lines (default = 1) (SD).
                // CSI Ps ; Ps ; Ps ; Ps ; Ps T
                // CSI > Ps; Ps T
            case 'T':
                if (this.params.length < 2 && !this.prefix) {
                    this.scrollDown(this.params);
                }
                break;

                // CSI Ps Z
                // Cursor Backward Tabulation Ps tab stops (default = 1) (CBT).
            case 'Z':
                this.cursorBackwardTab(this.params);
                break;

                // CSI Ps b Repeat the preceding graphic character Ps times (REP).
            case 'b':
                this.repeatPrecedingCharacter(this.params);
                break;

                // CSI Ps g Tab Clear (TBC).
            case 'g':
                this.tabClear(this.params);
                break;
            case 'p':
                switch (this.prefix) {
                case '!':
                    this.softReset(this.params);
                    break;
                }
                break;

            default:
                this.error('Unknown CSI code: %s.', ch);
                break;
            }

            this.prefix = '';
            this.postfix = '';
            break;

        case dcs:
            if (ch === '\x1b' || ch === '\x07') {
                if (ch === '\x1b') i++;

                switch (this.prefix) {
                    // User-Defined Keys (DECUDK).
                case '':
                    break;

                    // Request Status String (DECRQSS).
                    // test: echo -e '\eP$q"p\e\\'
                case '$q':
                    var pt = this.currentParam,
                        valid = false;

                    switch (pt) {
                        // DECSCA
                    case '"q':
                        pt = '0"q';
                        break;

                        // DECSCL
                    case '"p':
                        pt = '61"p';
                        break;

                        // DECSTBM
                    case 'r':
                        pt = '' + (this.scrollTop + 1) + ';' + (this.scrollBottom + 1) + 'r';
                        break;

                        // SGR
                    case 'm':
                        pt = '0m';
                        break;

                    default:
                        this.error('Unknown DCS Pt: %s.', pt);
                        pt = '';
                        break;
                    }

                    this.send('\x1bP' + +valid + '$r' + pt + '\x1b\\');
                    break;

                    // Set Termcap/Terminfo Data (xterm, experimental).
                case '+p':
                    break;

                default:
                    this.error('Unknown DCS prefix: %s.', this.prefix);
                    break;
                }

                this.currentParam = 0;
                this.prefix = '';
                this.state = normal;
            } else if (!this.currentParam) {
                if (!this.prefix && ch !== '$' && ch !== '+') {
                    this.currentParam = ch;
                } else if (this.prefix.length === 2) {
                    this.currentParam = ch;
                } else {
                    this.prefix += ch;
                }
            } else {
                this.currentParam += ch;
            }
            break;

        case ignore:
            // For PM and APC.
            if (ch === '\x1b' || ch === '\x07') {
                if (ch === '\x1b') i++;
                this.emit(this.stateType, this.stateData || '');
                this.stateData = '';
                this.state = normal;
            } else {
                if (!this.stateData) this.stateData = '';
                this.stateData += ch;
            }
            break;
        }
    }

    this.updateRange(this.y);
    this.refresh(this.refreshStart, this.refreshEnd);
};

Terminal.prototype.writeln = function(data) {
    // properly render empty lines
    if (!data.trim().length) data = '&nbsp;';
    data = data
      .replace('\t', this.tabspace)
      .replace(/ /g, '&nbsp;')
      ;
    this.write(data + '\r\n');
};

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

Terminal.prototype.setgLevel = function(g) {
    this.glevel = g;
    this.charset = this.charsets[g];
};

Terminal.prototype.setgCharset = function(g, charset) {
    this.charsets[g] = charset;
    if (this.glevel === g) {
        this.charset = charset;
    }
};

Terminal.prototype.keyPress = function(ev) {
    var key;

    cancel(ev);

    if (ev.charCode) {
        key = ev.charCode;
    } else if (ev.which == null) {
        key = ev.keyCode;
    } else if (ev.which !== 0 && ev.charCode !== 0) {
        key = ev.which;
    } else {
        return false;
    }

    if (!key || ev.ctrlKey || ev.altKey || ev.metaKey) return false;

    key = String.fromCharCode(key);

    this.emit('keypress', key, ev);
    this.emit('key', key, ev);

    this.showCursor();
    this.handler(key);

    return false;
};

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

Terminal.prototype.bell = function() {
    if (!Terminal.visualBell) return;
    var self = this;
    this.element.style.borderColor = 'white';
    setTimeout(function() {
        self.element.style.borderColor = '';
    }, 10);
    if (Terminal.popOnBell) this.focus();
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

// CSI Pm h Set Mode (SM).
// Ps = 2 -> Keyboard Action Mode (AM).
// Ps = 4 -> Insert Mode (IRM).
// Ps = 1 2 -> Send/receive (SRM).
// Ps = 2 0 -> Automatic Newline (LNM).
// CSI ? Pm h
// DEC Private Mode Set (DECSET).
// Ps = 1 -> Application Cursor Keys (DECCKM).
// Ps = 2 -> Designate USASCII for character sets G0-G3
// (DECANM), and set VT100 mode.
// Ps = 3 -> 132 Column Mode (DECCOLM).
// Ps = 4 -> Smooth (Slow) Scroll (DECSCLM).
// Ps = 5 -> Reverse Video (DECSCNM).
// Ps = 6 -> Origin Mode (DECOM).
// Ps = 7 -> Wraparound Mode (DECAWM).
// Ps = 8 -> Auto-repeat Keys (DECARM).
// Ps = 9 -> Send Mouse X & Y on button press. See the sec-
// tion Mouse Tracking.
// Ps = 1 0 -> Show toolbar (rxvt).
// Ps = 1 2 -> Start Blinking Cursor (att610).
// Ps = 1 8 -> Print form feed (DECPFF).
// Ps = 1 9 -> Set print extent to full screen (DECPEX).
// Ps = 2 5 -> Show Cursor (DECTCEM).
// Ps = 3 0 -> Show scrollbar (rxvt).
// Ps = 3 5 -> Enable font-shifting functions (rxvt).
// Ps = 3 8 -> Enter Tektronix Mode (DECTEK).
// Ps = 4 0 -> Allow 80 -> 132 Mode.
// Ps = 4 1 -> more(1) fix (see curses resource).
// Ps = 4 2 -> Enable Nation Replacement Character sets (DECN-
// RCM).
// Ps = 4 4 -> Turn On Margin Bell.
// Ps = 4 5 -> Reverse-wraparound Mode.
// Ps = 4 6 -> Start Logging. This is normally disabled by a
// compile-time option.
// Ps = 4 7 -> Use Alternate Screen Buffer. (This may be dis-
// abled by the titeInhibit resource).
// Ps = 6 6 -> Application keypad (DECNKM).
// Ps = 6 7 -> Backarrow key sends backspace (DECBKM).
// Ps = 1 0 0 0 -> Send Mouse X & Y on button press and
// release. See the section Mouse Tracking.
// Ps = 1 0 0 1 -> Use Hilite Mouse Tracking.
// Ps = 1 0 0 2 -> Use Cell Motion Mouse Tracking.
// Ps = 1 0 0 3 -> Use All Motion Mouse Tracking.
// Ps = 1 0 0 4 -> Send FocusIn/FocusOut events.
// Ps = 1 0 0 5 -> Enable Extended Mouse Mode.
// Ps = 1 0 1 0 -> Scroll to bottom on tty output (rxvt).
// Ps = 1 0 1 1 -> Scroll to bottom on key press (rxvt).
// Ps = 1 0 3 4 -> Interpret "meta" key, sets eighth bit.
// (enables the eightBitInput resource).
// Ps = 1 0 3 5 -> Enable special modifiers for Alt and Num-
// Lock keys. (This enables the numLock resource).
// Ps = 1 0 3 6 -> Send ESC when Meta modifies a key. (This
// enables the metaSendsEscape resource).
// Ps = 1 0 3 7 -> Send DEL from the editing-keypad Delete
// key.
// Ps = 1 0 3 9 -> Send ESC when Alt modifies a key. (This
// enables the altSendsEscape resource).
// Ps = 1 0 4 0 -> Keep selection even if not highlighted.
// (This enables the keepSelection resource).
// Ps = 1 0 4 1 -> Use the CLIPBOARD selection. (This enables
// the selectToClipboard resource).
// Ps = 1 0 4 2 -> Enable Urgency window manager hint when
// Control-G is received. (This enables the bellIsUrgent
// resource).
// Ps = 1 0 4 3 -> Enable raising of the window when Control-G
// is received. (enables the popOnBell resource).
// Ps = 1 0 4 7 -> Use Alternate Screen Buffer. (This may be
// disabled by the titeInhibit resource).
// Ps = 1 0 4 8 -> Save cursor as in DECSC. (This may be dis-
// abled by the titeInhibit resource).
// Ps = 1 0 4 9 -> Save cursor as in DECSC and use Alternate
// Screen Buffer, clearing it first. (This may be disabled by
// the titeInhibit resource). This combines the effects of the 1
// 0 4 7 and 1 0 4 8 modes. Use this with terminfo-based
// applications rather than the 4 7 mode.
// Ps = 1 0 5 0 -> Set terminfo/termcap function-key mode.
// Ps = 1 0 5 1 -> Set Sun function-key mode.
// Ps = 1 0 5 2 -> Set HP function-key mode.
// Ps = 1 0 5 3 -> Set SCO function-key mode.
// Ps = 1 0 6 0 -> Set legacy keyboard emulation (X11R6).
// Ps = 1 0 6 1 -> Set VT220 keyboard emulation.
// Ps = 2 0 0 4 -> Set bracketed paste mode.
// Modes:
// http://vt100.net/docs/vt220-rm/chapter4.html
Terminal.prototype.setMode = function(params) {
    if (typeof params === 'object') {
        var l = params.length,
            i = 0;

        for (; i < l; i++) {
            this.setMode(params[i]);
        }

        return;
    }

    if (!this.prefix) {
        switch (params) {
        case 4:
            this.insertMode = true;
            break;
        case 20:
            //this.convertEol = true;
            break;
        }
    } else if (this.prefix === '?') {
        switch (params) {
        case 1:
            this.applicationKeypad = true;
            break;
        case 2:
            this.setgCharset(0, Terminal.charsets.US);
            this.setgCharset(1, Terminal.charsets.US);
            this.setgCharset(2, Terminal.charsets.US);
            this.setgCharset(3, Terminal.charsets.US);
            // set VT100 mode here
            break;
        case 3:
            // 132 col mode
            this.savedCols = this.cols;
            this.resize(132, this.rows);
            break;
        case 6:
            this.originMode = true;
            break;
        case 7:
            this.wraparoundMode = true;
            break;
        case 12:
            // this.cursorBlink = true;
            break;
        case 9:
            // X10 Mouse
            // no release, no motion, no wheel, no modifiers.
        case 1000:
            // vt200 mouse
            // no motion.
            // no modifiers, except control on the wheel.
        case 1002:
            // button event mouse
        case 1003:
            // any event mouse
            // any event - sends motion events,
            // even if there is no button held down.
            this.x10Mouse = params === 9;
            this.vt200Mouse = params === 1000;
            this.normalMouse = params > 1000;
            this.mouseEvents = true;
            this.element.style.cursor = 'default';
            this.log('Binding to mouse events.');
            break;
        case 1004:
            // send focusin/focusout events
            // focusin: ^[[I
            // focusout: ^[[O
            this.sendFocus = true;
            break;
        case 1005:
            // utf8 ext mode mouse
            this.utfMouse = true;
            // for wide terminals
            // simply encodes large values as utf8 characters
            break;
        case 1006:
            // sgr ext mode mouse
            this.sgrMouse = true;
            // for wide terminals
            // does not add 32 to fields
            // press: ^[[<b;x;yM
            // release: ^[[<b;x;ym
            break;
        case 1015:
            // urxvt ext mode mouse
            this.urxvtMouse = true;
            // for wide terminals
            // numbers for fields
            // press: ^[[b;x;yM
            // motion: ^[[b;x;yT
            break;
        case 25:
            // show cursor
            this.cursorHidden = false;
            break;
        case 1049:
            // alt screen buffer cursor
            //this.saveCursor();
            ; // FALL-THROUGH
        case 47:
            // alt screen buffer
        case 1047:
            // alt screen buffer
            if (!this.normal) {
                var normal = {
                    lines: this.lines,
                    ybase: this.ybase,
                    ydisp: this.ydisp,
                    x: this.x,
                    y: this.y,
                    scrollTop: this.scrollTop,
                    scrollBottom: this.scrollBottom,
                    tabs: this.tabs
                    // XXX save charset(s) here?
                    // charset: this.charset,
                    // glevel: this.glevel,
                    // charsets: this.charsets
                };
                this.reset();
                this.normal = normal;
                this.showCursor();
            }
            break;
        }
    }
};

// CSI Pm l Reset Mode (RM).
// Ps = 2 -> Keyboard Action Mode (AM).
// Ps = 4 -> Replace Mode (IRM).
// Ps = 1 2 -> Send/receive (SRM).
// Ps = 2 0 -> Normal Linefeed (LNM).
// CSI ? Pm l
// DEC Private Mode Reset (DECRST).
// Ps = 1 -> Normal Cursor Keys (DECCKM).
// Ps = 2 -> Designate VT52 mode (DECANM).
// Ps = 3 -> 80 Column Mode (DECCOLM).
// Ps = 4 -> Jump (Fast) Scroll (DECSCLM).
// Ps = 5 -> Normal Video (DECSCNM).
// Ps = 6 -> Normal Cursor Mode (DECOM).
// Ps = 7 -> No Wraparound Mode (DECAWM).
// Ps = 8 -> No Auto-repeat Keys (DECARM).
// Ps = 9 -> Don't send Mouse X & Y on button press.
// Ps = 1 0 -> Hide toolbar (rxvt).
// Ps = 1 2 -> Stop Blinking Cursor (att610).
// Ps = 1 8 -> Don't print form feed (DECPFF).
// Ps = 1 9 -> Limit print to scrolling region (DECPEX).
// Ps = 2 5 -> Hide Cursor (DECTCEM).
// Ps = 3 0 -> Don't show scrollbar (rxvt).
// Ps = 3 5 -> Disable font-shifting functions (rxvt).
// Ps = 4 0 -> Disallow 80 -> 132 Mode.
// Ps = 4 1 -> No more(1) fix (see curses resource).
// Ps = 4 2 -> Disable Nation Replacement Character sets (DEC-
// NRCM).
// Ps = 4 4 -> Turn Off Margin Bell.
// Ps = 4 5 -> No Reverse-wraparound Mode.
// Ps = 4 6 -> Stop Logging. (This is normally disabled by a
// compile-time option).
// Ps = 4 7 -> Use Normal Screen Buffer.
// Ps = 6 6 -> Numeric keypad (DECNKM).
// Ps = 6 7 -> Backarrow key sends delete (DECBKM).
// Ps = 1 0 0 0 -> Don't send Mouse X & Y on button press and
// release. See the section Mouse Tracking.
// Ps = 1 0 0 1 -> Don't use Hilite Mouse Tracking.
// Ps = 1 0 0 2 -> Don't use Cell Motion Mouse Tracking.
// Ps = 1 0 0 3 -> Don't use All Motion Mouse Tracking.
// Ps = 1 0 0 4 -> Don't send FocusIn/FocusOut events.
// Ps = 1 0 0 5 -> Disable Extended Mouse Mode.
// Ps = 1 0 1 0 -> Don't scroll to bottom on tty output
// (rxvt).
// Ps = 1 0 1 1 -> Don't scroll to bottom on key press (rxvt).
// Ps = 1 0 3 4 -> Don't interpret "meta" key. (This disables
// the eightBitInput resource).
// Ps = 1 0 3 5 -> Disable special modifiers for Alt and Num-
// Lock keys. (This disables the numLock resource).
// Ps = 1 0 3 6 -> Don't send ESC when Meta modifies a key.
// (This disables the metaSendsEscape resource).
// Ps = 1 0 3 7 -> Send VT220 Remove from the editing-keypad
// Delete key.
// Ps = 1 0 3 9 -> Don't send ESC when Alt modifies a key.
// (This disables the altSendsEscape resource).
// Ps = 1 0 4 0 -> Do not keep selection when not highlighted.
// (This disables the keepSelection resource).
// Ps = 1 0 4 1 -> Use the PRIMARY selection. (This disables
// the selectToClipboard resource).
// Ps = 1 0 4 2 -> Disable Urgency window manager hint when
// Control-G is received. (This disables the bellIsUrgent
// resource).
// Ps = 1 0 4 3 -> Disable raising of the window when Control-
// G is received. (This disables the popOnBell resource).
// Ps = 1 0 4 7 -> Use Normal Screen Buffer, clearing screen
// first if in the Alternate Screen. (This may be disabled by
// the titeInhibit resource).
// Ps = 1 0 4 8 -> Restore cursor as in DECRC. (This may be
// disabled by the titeInhibit resource).
// Ps = 1 0 4 9 -> Use Normal Screen Buffer and restore cursor
// as in DECRC. (This may be disabled by the titeInhibit
// resource). This combines the effects of the 1 0 4 7 and 1 0
// 4 8 modes. Use this with terminfo-based applications rather
// than the 4 7 mode.
// Ps = 1 0 5 0 -> Reset terminfo/termcap function-key mode.
// Ps = 1 0 5 1 -> Reset Sun function-key mode.
// Ps = 1 0 5 2 -> Reset HP function-key mode.
// Ps = 1 0 5 3 -> Reset SCO function-key mode.
// Ps = 1 0 6 0 -> Reset legacy keyboard emulation (X11R6).
// Ps = 1 0 6 1 -> Reset keyboard emulation to Sun/PC style.
// Ps = 2 0 0 4 -> Reset bracketed paste mode.
Terminal.prototype.resetMode = function(params) {
    if (typeof params === 'object') {
        var l = params.length,
            i = 0;

        for (; i < l; i++) {
            this.resetMode(params[i]);
        }

        return;
    }

    if (!this.prefix) {
        switch (params) {
        case 4:
            this.insertMode = false;
            break;
        case 20:
            //this.convertEol = false;
            break;
        }
    } else if (this.prefix === '?') {
        switch (params) {
        case 1:
            this.applicationKeypad = false;
            break;
        case 3:
            if (this.cols === 132 && this.savedCols) {
                this.resize(this.savedCols, this.rows);
            }
            delete this.savedCols;
            break;
        case 6:
            this.originMode = false;
            break;
        case 7:
            this.wraparoundMode = false;
            break;
        case 12:
            // this.cursorBlink = false;
            break;
        case 9:
            // X10 Mouse
        case 1000:
            // vt200 mouse
        case 1002:
            // button event mouse
        case 1003:
            // any event mouse
            this.x10Mouse = false;
            this.vt200Mouse = false;
            this.normalMouse = false;
            this.mouseEvents = false;
            this.element.style.cursor = '';
            break;
        case 1004:
            // send focusin/focusout events
            this.sendFocus = false;
            break;
        case 1005:
            // utf8 ext mode mouse
            this.utfMouse = false;
            break;
        case 1006:
            // sgr ext mode mouse
            this.sgrMouse = false;
            break;
        case 1015:
            // urxvt ext mode mouse
            this.urxvtMouse = false;
            break;
        case 25:
            // hide cursor
            this.cursorHidden = true;
            break;
        case 1049:
            // alt screen buffer cursor
            ; // FALL-THROUGH
        case 47:
            // normal screen buffer
        case 1047:
            // normal screen buffer - clearing it first
            if (this.normal) {
                this.lines = this.normal.lines;
                this.ybase = this.normal.ybase;
                this.ydisp = this.normal.ydisp;
                this.x = this.normal.x;
                this.y = this.normal.y;
                this.scrollTop = this.normal.scrollTop;
                this.scrollBottom = this.normal.scrollBottom;
                this.tabs = this.normal.tabs;
                this.normal = null;
                // if (params === 1049) {
                // this.x = this.savedX;
                // this.y = this.savedY;
                // }
                this.refresh(0, this.rows - 1);
                this.showCursor();
            }
            break;
        }
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
* Helpers
*/

function on(el, type, handler, capture) {
    el.addEventListener(type, handler, capture || false);
}

function off(el, type, handler, capture) {
    el.removeEventListener(type, handler, capture || false);
}

function cancel(ev) {
    if (ev.preventDefault) ev.preventDefault();
    ev.returnValue = false;
    if (ev.stopPropagation) ev.stopPropagation();
    ev.cancelBubble = true;
    return false;
}

function inherits(child, parent) {
    function f() {
        this.constructor = child;
    }
    f.prototype = parent.prototype;
    child.prototype = new f;
}

var isMac = ~navigator.userAgent.indexOf('Mac');

// if bold is broken, we can't
// use it in the terminal.
function isBoldBroken() {
    var el = document.createElement('span');
    el.innerHTML = 'hello world';
    document.body.appendChild(el);
    var w1 = el.scrollWidth;
    el.style.fontWeight = 'bold';
    var w2 = el.scrollWidth;
    document.body.removeChild(el);
    return w1 !== w2;
}

var String = this.String;
var setTimeout = this.setTimeout;
var setInterval = this.setInterval;

/**
* Expose
*/

Terminal.EventEmitter = EventEmitter;
Terminal.isMac = isMac;
Terminal.on = on;
Terminal.off = off;
Terminal.cancel = cancel;

})()
},{"events":2}],3:[function(require,module,exports){
'use strict';
/*jshint browser:true */

var term = require('../index')(100, 80);
term.appendTo('#terminal');

var difflet = require('difflet')({
      indent : 2 
    , comma : 'first'
    , comment: true
    });

var diff = difflet.compare({ a : [1, 2, 3 ], c : 5 }, { a : [1, 2, 3, 4 ], b : 4 });
term.write(diff);

var termcode = require('../index')(130, 80);
termcode.appendTo('#terminal-code');

[ '\u001b[92m\'use strict\'\u001b[39m\u001b[90m;\u001b[39m',
  '\u001b[90m/*jshint browser:true */\u001b[39m',
  '',
  '\u001b[32mvar\u001b[39m \u001b[37mTerminal\u001b[39m \u001b[93m=\u001b[39m \u001b[37mrequire\u001b[39m\u001b[90m(\u001b[39m\u001b[92m\'./term\'\u001b[39m\u001b[90m)\u001b[39m',
  '  \u001b[32m,\u001b[39m \u001b[37mthrough\u001b[39m \u001b[93m=\u001b[39m \u001b[37mrequire\u001b[39m\u001b[90m(\u001b[39m\u001b[92m\'through\'\u001b[39m\u001b[90m)\u001b[39m',
  '  \u001b[90m;\u001b[39m',
  '',
  '\u001b[37mmodule\u001b[39m\u001b[32m.\u001b[39m\u001b[37mexports\u001b[39m \u001b[93m=\u001b[39m \u001b[94mfunction\u001b[39m \u001b[90m(\u001b[39m\u001b[37mcols\u001b[39m\u001b[32m,\u001b[39m \u001b[37mrows\u001b[39m\u001b[32m,\u001b[39m \u001b[37mhandler\u001b[39m\u001b[90m)\u001b[39m \u001b[33m{\u001b[39m',
  '  \u001b[32mvar\u001b[39m \u001b[37mterm\u001b[39m \u001b[93m=\u001b[39m \u001b[31mnew\u001b[39m \u001b[37mTerminal\u001b[39m\u001b[90m(\u001b[39m\u001b[37mcols\u001b[39m\u001b[32m,\u001b[39m \u001b[37mrows\u001b[39m\u001b[32m,\u001b[39m \u001b[37mhandler\u001b[39m\u001b[90m)\u001b[39m\u001b[90m;\u001b[39m',
  '  \u001b[37mterm\u001b[39m\u001b[32m.\u001b[39m\u001b[37mopen\u001b[39m\u001b[90m(\u001b[39m\u001b[90m)\u001b[39m\u001b[90m;\u001b[39m',
  '  ',
  '  \u001b[32mvar\u001b[39m \u001b[37mhypernal\u001b[39m \u001b[93m=\u001b[39m \u001b[37mthrough\u001b[39m\u001b[90m(\u001b[39m\u001b[37mterm\u001b[39m\u001b[32m.\u001b[39m\u001b[37mwrite\u001b[39m\u001b[32m.\u001b[39m\u001b[37mbind\u001b[39m\u001b[90m(\u001b[39m\u001b[37mterm\u001b[39m\u001b[90m)\u001b[39m\u001b[90m)\u001b[39m\u001b[90m;\u001b[39m',
  '  \u001b[37mhypernal\u001b[39m\u001b[32m.\u001b[39m\u001b[37mappendTo\u001b[39m \u001b[93m=\u001b[39m \u001b[94mfunction\u001b[39m \u001b[90m(\u001b[39m\u001b[37melem\u001b[39m\u001b[90m)\u001b[39m \u001b[33m{\u001b[39m',
  '    \u001b[94mif\u001b[39m \u001b[90m(\u001b[39m\u001b[94mtypeof\u001b[39m \u001b[37melem\u001b[39m \u001b[93m===\u001b[39m \u001b[92m\'string\'\u001b[39m\u001b[90m)\u001b[39m \u001b[37melem\u001b[39m \u001b[93m=\u001b[39m \u001b[37mdocument\u001b[39m\u001b[32m.\u001b[39m\u001b[37mquerySelector\u001b[39m\u001b[90m(\u001b[39m\u001b[37melem\u001b[39m\u001b[90m)\u001b[39m\u001b[90m;\u001b[39m',
  '',
  '    \u001b[37melem\u001b[39m\u001b[32m.\u001b[39m\u001b[37mappendChild\u001b[39m\u001b[90m(\u001b[39m\u001b[37mterm\u001b[39m\u001b[32m.\u001b[39m\u001b[37melement\u001b[39m\u001b[90m)\u001b[39m\u001b[90m;\u001b[39m',
  '    \u001b[37mterm\u001b[39m\u001b[32m.\u001b[39m\u001b[37melement\u001b[39m\u001b[32m.\u001b[39m\u001b[37mstyle\u001b[39m\u001b[32m.\u001b[39m\u001b[37mposition\u001b[39m \u001b[93m=\u001b[39m \u001b[92m\'relative\'\u001b[39m\u001b[90m;\u001b[39m',
  '  \u001b[33m}\u001b[39m\u001b[90m;\u001b[39m',
  '',
  '  \u001b[37mhypernal\u001b[39m\u001b[32m.\u001b[39m\u001b[37mwriteln\u001b[39m \u001b[93m=\u001b[39m \u001b[94mfunction\u001b[39m \u001b[90m(\u001b[39m\u001b[37mline\u001b[39m\u001b[90m)\u001b[39m \u001b[33m{\u001b[39m',
  '    \u001b[37mterm\u001b[39m\u001b[32m.\u001b[39m\u001b[37mwriteln\u001b[39m\u001b[90m(\u001b[39m\u001b[37mline\u001b[39m\u001b[90m)\u001b[39m\u001b[90m;\u001b[39m',
  '  \u001b[33m}\u001b[39m\u001b[90m;\u001b[39m',
  '',
  '  \u001b[37mhypernal\u001b[39m\u001b[32m.\u001b[39m\u001b[37mwrite\u001b[39m \u001b[93m=\u001b[39m \u001b[37mterm\u001b[39m\u001b[32m.\u001b[39m\u001b[37mwrite\u001b[39m\u001b[32m.\u001b[39m\u001b[37mbind\u001b[39m\u001b[90m(\u001b[39m\u001b[37mterm\u001b[39m\u001b[90m)\u001b[39m\u001b[90m;\u001b[39m',
  '',
  '  \u001b[31mreturn\u001b[39m \u001b[37mhypernal\u001b[39m\u001b[90m;\u001b[39m',
  '\u001b[33m}\u001b[39m\u001b[90m;\u001b[39m',
  '' 
].forEach(function (line) { termcode.writeln(line); });

},{"../index":4,"difflet":5}],4:[function(require,module,exports){
'use strict';
/*jshint browser:true */

var Terminal = require('./term')
  , through = require('through')
  ;

module.exports = function (cols, rows, opts) {
  var term = new Terminal(cols, rows, opts);
  term.open();
  
  var hypernal = through(term.write.bind(term));
  hypernal.appendTo = function (elem) {
    if (typeof elem === 'string') elem = document.querySelector(elem);

    elem.appendChild(term.element);
    term.element.style.position = 'relative';
  };

  hypernal.writeln = function (line) {
    term.writeln(line);
  };

  hypernal.write = term.write.bind(term);

  return hypernal;
};

},{"./term":1,"through":6}],7:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            if (ev.source === window && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],2:[function(require,module,exports){
(function(process){if (!process.EventEmitter) process.EventEmitter = function () {};

var EventEmitter = exports.EventEmitter = process.EventEmitter;
var isArray = typeof Array.isArray === 'function'
    ? Array.isArray
    : function (xs) {
        return Object.prototype.toString.call(xs) === '[object Array]'
    }
;
function indexOf (xs, x) {
    if (xs.indexOf) return xs.indexOf(x);
    for (var i = 0; i < xs.length; i++) {
        if (x === xs[i]) return i;
    }
    return -1;
}

// By default EventEmitters will print a warning if more than
// 10 listeners are added to it. This is a useful default which
// helps finding memory leaks.
//
// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
var defaultMaxListeners = 10;
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!this._events) this._events = {};
  this._events.maxListeners = n;
};


EventEmitter.prototype.emit = function(type) {
  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events || !this._events.error ||
        (isArray(this._events.error) && !this._events.error.length))
    {
      if (arguments[1] instanceof Error) {
        throw arguments[1]; // Unhandled 'error' event
      } else {
        throw new Error("Uncaught, unspecified 'error' event.");
      }
      return false;
    }
  }

  if (!this._events) return false;
  var handler = this._events[type];
  if (!handler) return false;

  if (typeof handler == 'function') {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        var args = Array.prototype.slice.call(arguments, 1);
        handler.apply(this, args);
    }
    return true;

  } else if (isArray(handler)) {
    var args = Array.prototype.slice.call(arguments, 1);

    var listeners = handler.slice();
    for (var i = 0, l = listeners.length; i < l; i++) {
      listeners[i].apply(this, args);
    }
    return true;

  } else {
    return false;
  }
};

// EventEmitter is defined in src/node_events.cc
// EventEmitter.prototype.emit() is also defined there.
EventEmitter.prototype.addListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('addListener only takes instances of Function');
  }

  if (!this._events) this._events = {};

  // To avoid recursion in the case that type == "newListeners"! Before
  // adding it to the listeners, first emit "newListeners".
  this.emit('newListener', type, listener);

  if (!this._events[type]) {
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  } else if (isArray(this._events[type])) {

    // Check for listener leak
    if (!this._events[type].warned) {
      var m;
      if (this._events.maxListeners !== undefined) {
        m = this._events.maxListeners;
      } else {
        m = defaultMaxListeners;
      }

      if (m && m > 0 && this._events[type].length > m) {
        this._events[type].warned = true;
        console.error('(node) warning: possible EventEmitter memory ' +
                      'leak detected. %d listeners added. ' +
                      'Use emitter.setMaxListeners() to increase limit.',
                      this._events[type].length);
        console.trace();
      }
    }

    // If we've already got an array, just append.
    this._events[type].push(listener);
  } else {
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  var self = this;
  self.on(type, function g() {
    self.removeListener(type, g);
    listener.apply(this, arguments);
  });

  return this;
};

EventEmitter.prototype.removeListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('removeListener only takes instances of Function');
  }

  // does not use listeners(), so no side effect of creating _events[type]
  if (!this._events || !this._events[type]) return this;

  var list = this._events[type];

  if (isArray(list)) {
    var i = indexOf(list, listener);
    if (i < 0) return this;
    list.splice(i, 1);
    if (list.length == 0)
      delete this._events[type];
  } else if (this._events[type] === listener) {
    delete this._events[type];
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  if (arguments.length === 0) {
    this._events = {};
    return this;
  }

  // does not use listeners(), so no side effect of creating _events[type]
  if (type && this._events && this._events[type]) this._events[type] = null;
  return this;
};

EventEmitter.prototype.listeners = function(type) {
  if (!this._events) this._events = {};
  if (!this._events[type]) this._events[type] = [];
  if (!isArray(this._events[type])) {
    this._events[type] = [this._events[type]];
  }
  return this._events[type];
};

})(require("__browserify_process"))
},{"__browserify_process":7}],6:[function(require,module,exports){
(function(process){var Stream = require('stream')

// through
//
// a stream that does nothing but re-emit the input.
// useful for aggregating a series of changing but not ending streams into one stream)



exports = module.exports = through
through.through = through

//create a readable writable stream.

function through (write, end) {
  write = write || function (data) { this.queue(data) }
  end = end || function () { this.queue(null) }

  var ended = false, destroyed = false, buffer = []
  var stream = new Stream()
  stream.readable = stream.writable = true
  stream.paused = false

  stream.write = function (data) {
    write.call(this, data)
    return !stream.paused
  }

  function drain() {
    while(buffer.length && !stream.paused) {
      var data = buffer.shift()
      if(null === data)
        return stream.emit('end')
      else
        stream.emit('data', data)
    }
  }

  stream.queue = stream.push = function (data) {
    buffer.push(data)
    drain()
    return stream
  }

  //this will be registered as the first 'end' listener
  //must call destroy next tick, to make sure we're after any
  //stream piped from here.
  //this is only a problem if end is not emitted synchronously.
  //a nicer way to do this is to make sure this is the last listener for 'end'

  stream.on('end', function () {
    stream.readable = false
    if(!stream.writable)
      process.nextTick(function () {
        stream.destroy()
      })
  })

  function _end () {
    stream.writable = false
    end.call(stream)
    if(!stream.readable)
      stream.destroy()
  }

  stream.end = function (data) {
    if(ended) return
    ended = true
    if(arguments.length) stream.write(data)
    _end() // will emit or queue
    return stream
  }

  stream.destroy = function () {
    if(destroyed) return
    destroyed = true
    ended = true
    buffer.length = 0
    stream.writable = stream.readable = false
    stream.emit('close')
    return stream
  }

  stream.pause = function () {
    if(stream.paused) return
    stream.paused = true
    stream.emit('pause')
    return stream
  }
  stream.resume = function () {
    if(stream.paused) {
      stream.paused = false
    }
    drain()
    //may have become paused again,
    //as drain emits 'data'.
    if(!stream.paused)
      stream.emit('drain')
    return stream
  }
  return stream
}


})(require("__browserify_process"))
},{"stream":8,"__browserify_process":7}],8:[function(require,module,exports){
var events = require('events');
var util = require('util');

function Stream() {
  events.EventEmitter.call(this);
}
util.inherits(Stream, events.EventEmitter);
module.exports = Stream;
// Backwards-compat with node 0.4.x
Stream.Stream = Stream;

Stream.prototype.pipe = function(dest, options) {
  var source = this;

  function ondata(chunk) {
    if (dest.writable) {
      if (false === dest.write(chunk) && source.pause) {
        source.pause();
      }
    }
  }

  source.on('data', ondata);

  function ondrain() {
    if (source.readable && source.resume) {
      source.resume();
    }
  }

  dest.on('drain', ondrain);

  // If the 'end' option is not supplied, dest.end() will be called when
  // source gets the 'end' or 'close' events.  Only dest.end() once, and
  // only when all sources have ended.
  if (!dest._isStdio && (!options || options.end !== false)) {
    dest._pipeCount = dest._pipeCount || 0;
    dest._pipeCount++;

    source.on('end', onend);
    source.on('close', onclose);
  }

  var didOnEnd = false;
  function onend() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest._pipeCount--;

    // remove the listeners
    cleanup();

    if (dest._pipeCount > 0) {
      // waiting for other incoming streams to end.
      return;
    }

    dest.end();
  }


  function onclose() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest._pipeCount--;

    // remove the listeners
    cleanup();

    if (dest._pipeCount > 0) {
      // waiting for other incoming streams to end.
      return;
    }

    dest.destroy();
  }

  // don't leave dangling pipes when there are errors.
  function onerror(er) {
    cleanup();
    if (this.listeners('error').length === 0) {
      throw er; // Unhandled stream error in pipe.
    }
  }

  source.on('error', onerror);
  dest.on('error', onerror);

  // remove all the event listeners that were added.
  function cleanup() {
    source.removeListener('data', ondata);
    dest.removeListener('drain', ondrain);

    source.removeListener('end', onend);
    source.removeListener('close', onclose);

    source.removeListener('error', onerror);
    dest.removeListener('error', onerror);

    source.removeListener('end', cleanup);
    source.removeListener('close', cleanup);

    dest.removeListener('end', cleanup);
    dest.removeListener('close', cleanup);
  }

  source.on('end', cleanup);
  source.on('close', cleanup);

  dest.on('end', cleanup);
  dest.on('close', cleanup);

  dest.emit('pipe', source);

  // Allow for unix-like usage: A.pipe(B).pipe(C)
  return dest;
};

},{"events":2,"util":9}],9:[function(require,module,exports){
var events = require('events');

exports.isArray = isArray;
exports.isDate = function(obj){return Object.prototype.toString.call(obj) === '[object Date]'};
exports.isRegExp = function(obj){return Object.prototype.toString.call(obj) === '[object RegExp]'};


exports.print = function () {};
exports.puts = function () {};
exports.debug = function() {};

exports.inspect = function(obj, showHidden, depth, colors) {
  var seen = [];

  var stylize = function(str, styleType) {
    // http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
    var styles =
        { 'bold' : [1, 22],
          'italic' : [3, 23],
          'underline' : [4, 24],
          'inverse' : [7, 27],
          'white' : [37, 39],
          'grey' : [90, 39],
          'black' : [30, 39],
          'blue' : [34, 39],
          'cyan' : [36, 39],
          'green' : [32, 39],
          'magenta' : [35, 39],
          'red' : [31, 39],
          'yellow' : [33, 39] };

    var style =
        { 'special': 'cyan',
          'number': 'blue',
          'boolean': 'yellow',
          'undefined': 'grey',
          'null': 'bold',
          'string': 'green',
          'date': 'magenta',
          // "name": intentionally not styling
          'regexp': 'red' }[styleType];

    if (style) {
      return '\033[' + styles[style][0] + 'm' + str +
             '\033[' + styles[style][1] + 'm';
    } else {
      return str;
    }
  };
  if (! colors) {
    stylize = function(str, styleType) { return str; };
  }

  function format(value, recurseTimes) {
    // Provide a hook for user-specified inspect functions.
    // Check that value is an object with an inspect function on it
    if (value && typeof value.inspect === 'function' &&
        // Filter out the util module, it's inspect function is special
        value !== exports &&
        // Also filter out any prototype objects using the circular check.
        !(value.constructor && value.constructor.prototype === value)) {
      return value.inspect(recurseTimes);
    }

    // Primitive types cannot have properties
    switch (typeof value) {
      case 'undefined':
        return stylize('undefined', 'undefined');

      case 'string':
        var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                                 .replace(/'/g, "\\'")
                                                 .replace(/\\"/g, '"') + '\'';
        return stylize(simple, 'string');

      case 'number':
        return stylize('' + value, 'number');

      case 'boolean':
        return stylize('' + value, 'boolean');
    }
    // For some reason typeof null is "object", so special case here.
    if (value === null) {
      return stylize('null', 'null');
    }

    // Look up the keys of the object.
    var visible_keys = Object_keys(value);
    var keys = showHidden ? Object_getOwnPropertyNames(value) : visible_keys;

    // Functions without properties can be shortcutted.
    if (typeof value === 'function' && keys.length === 0) {
      if (isRegExp(value)) {
        return stylize('' + value, 'regexp');
      } else {
        var name = value.name ? ': ' + value.name : '';
        return stylize('[Function' + name + ']', 'special');
      }
    }

    // Dates without properties can be shortcutted
    if (isDate(value) && keys.length === 0) {
      return stylize(value.toUTCString(), 'date');
    }

    var base, type, braces;
    // Determine the object type
    if (isArray(value)) {
      type = 'Array';
      braces = ['[', ']'];
    } else {
      type = 'Object';
      braces = ['{', '}'];
    }

    // Make functions say that they are functions
    if (typeof value === 'function') {
      var n = value.name ? ': ' + value.name : '';
      base = (isRegExp(value)) ? ' ' + value : ' [Function' + n + ']';
    } else {
      base = '';
    }

    // Make dates with properties first say the date
    if (isDate(value)) {
      base = ' ' + value.toUTCString();
    }

    if (keys.length === 0) {
      return braces[0] + base + braces[1];
    }

    if (recurseTimes < 0) {
      if (isRegExp(value)) {
        return stylize('' + value, 'regexp');
      } else {
        return stylize('[Object]', 'special');
      }
    }

    seen.push(value);

    var output = keys.map(function(key) {
      var name, str;
      if (value.__lookupGetter__) {
        if (value.__lookupGetter__(key)) {
          if (value.__lookupSetter__(key)) {
            str = stylize('[Getter/Setter]', 'special');
          } else {
            str = stylize('[Getter]', 'special');
          }
        } else {
          if (value.__lookupSetter__(key)) {
            str = stylize('[Setter]', 'special');
          }
        }
      }
      if (visible_keys.indexOf(key) < 0) {
        name = '[' + key + ']';
      }
      if (!str) {
        if (seen.indexOf(value[key]) < 0) {
          if (recurseTimes === null) {
            str = format(value[key]);
          } else {
            str = format(value[key], recurseTimes - 1);
          }
          if (str.indexOf('\n') > -1) {
            if (isArray(value)) {
              str = str.split('\n').map(function(line) {
                return '  ' + line;
              }).join('\n').substr(2);
            } else {
              str = '\n' + str.split('\n').map(function(line) {
                return '   ' + line;
              }).join('\n');
            }
          }
        } else {
          str = stylize('[Circular]', 'special');
        }
      }
      if (typeof name === 'undefined') {
        if (type === 'Array' && key.match(/^\d+$/)) {
          return str;
        }
        name = JSON.stringify('' + key);
        if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
          name = name.substr(1, name.length - 2);
          name = stylize(name, 'name');
        } else {
          name = name.replace(/'/g, "\\'")
                     .replace(/\\"/g, '"')
                     .replace(/(^"|"$)/g, "'");
          name = stylize(name, 'string');
        }
      }

      return name + ': ' + str;
    });

    seen.pop();

    var numLinesEst = 0;
    var length = output.reduce(function(prev, cur) {
      numLinesEst++;
      if (cur.indexOf('\n') >= 0) numLinesEst++;
      return prev + cur.length + 1;
    }, 0);

    if (length > 50) {
      output = braces[0] +
               (base === '' ? '' : base + '\n ') +
               ' ' +
               output.join(',\n  ') +
               ' ' +
               braces[1];

    } else {
      output = braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
    }

    return output;
  }
  return format(obj, (typeof depth === 'undefined' ? 2 : depth));
};


function isArray(ar) {
  return ar instanceof Array ||
         Array.isArray(ar) ||
         (ar && ar !== Object.prototype && isArray(ar.__proto__));
}


function isRegExp(re) {
  return re instanceof RegExp ||
    (typeof re === 'object' && Object.prototype.toString.call(re) === '[object RegExp]');
}


function isDate(d) {
  if (d instanceof Date) return true;
  if (typeof d !== 'object') return false;
  var properties = Date.prototype && Object_getOwnPropertyNames(Date.prototype);
  var proto = d.__proto__ && Object_getOwnPropertyNames(d.__proto__);
  return JSON.stringify(proto) === JSON.stringify(properties);
}

function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}

var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}

exports.log = function (msg) {};

exports.pump = null;

var Object_keys = Object.keys || function (obj) {
    var res = [];
    for (var key in obj) res.push(key);
    return res;
};

var Object_getOwnPropertyNames = Object.getOwnPropertyNames || function (obj) {
    var res = [];
    for (var key in obj) {
        if (Object.hasOwnProperty.call(obj, key)) res.push(key);
    }
    return res;
};

var Object_create = Object.create || function (prototype, properties) {
    // from es5-shim
    var object;
    if (prototype === null) {
        object = { '__proto__' : null };
    }
    else {
        if (typeof prototype !== 'object') {
            throw new TypeError(
                'typeof prototype[' + (typeof prototype) + '] != \'object\''
            );
        }
        var Type = function () {};
        Type.prototype = prototype;
        object = new Type();
        object.__proto__ = prototype;
    }
    if (typeof properties !== 'undefined' && Object.defineProperties) {
        Object.defineProperties(object, properties);
    }
    return object;
};

exports.inherits = function(ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = Object_create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
};

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (typeof f !== 'string') {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(exports.inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j': return JSON.stringify(args[i++]);
      default:
        return x;
    }
  });
  for(var x = args[i]; i < len; x = args[++i]){
    if (x === null || typeof x !== 'object') {
      str += ' ' + x;
    } else {
      str += ' ' + exports.inspect(x);
    }
  }
  return str;
};

},{"events":2}],5:[function(require,module,exports){
(function(process){var traverse = require('traverse');
var Stream = require('stream').Stream;
var charm = require('charm');
var deepEqual = require('deep-equal');

var exports = module.exports = function (opts_) {
    var fn = difflet.bind(null, opts_);
    fn.compare = function (prev, next) {
        var opts = Object.keys(opts_ || {}).reduce(function (acc, key) {
            acc[key] = opts_[key];
            return acc;
        }, {});
        var s = opts.stream = new Stream;
        var data = '';
        s.write = function (buf) { data += buf };
        s.end = function () {};
        s.readable = true;
        s.writable = true;
        
        difflet(opts, prev, next);
        return data;
    };
    return fn;
};

exports.compare = function (prev, next) {
    return exports({}).compare(prev, next);
};

function difflet (opts, prev, next) {
    var stream = opts.stream || new Stream;
    if (!opts.stream) {
        stream.readable = true;
        stream.writable = true;
        stream.write = function (buf) { this.emit('data', buf) };
        stream.end = function () { this.emit('end') };
    }
    
    if (!opts) opts = {};
    if (opts.start === undefined && opts.stop === undefined) {
        var c = charm(stream);
        opts.start = function (type) {
            c.foreground({
                inserted : 'green',
                updated : 'blue',
                deleted : 'red',
                comment : 'cyan',
            }[type]);
            c.display('bright');
        };
        opts.stop = function (type) {
            c.display('reset');
        };
    }
    var write = function (buf) {
        if (opts.write) opts.write(buf, stream)
        else stream.write(buf)
    };
    
    var commaFirst = opts.comma === 'first';
    
    var stringify = function (node, params) {
        return stringifier.call(this, true, node, params || opts);
    };
    var plainStringify = function (node, params) {
        return stringifier.call(this, false, node, params || opts);
    };
    
    var levels = 0;
    function set (type) {
        if (levels === 0) opts.start(type, stream);
        levels ++;
    }
    
    function unset (type) {
        if (--levels === 0) opts.stop(type, stream);
    }
    
    function stringifier (insertable, node, opts) {
        var indent = opts.indent;
        
        if (insertable) {
            var prevNode = traverse.get(prev, this.path || []);
        }
        var inserted = insertable && prevNode === undefined;
        
        var indentx = indent ? Array(
            ((this.path || []).length + 1) * indent + 1
        ).join(' ') : '';
        if (commaFirst) indentx = indentx.slice(indent);
        
        if (Array.isArray(node)) {
            var updated = (prevNode || traverse.has(prev, this.path))
                && !Array.isArray(prevNode);
            if (updated) {
                set('updated');
            }
            
            if (opts.comment && !Array.isArray(prevNode)) {
                indent = 0;
            }
            
            this.before(function () {
                if (inserted) set('inserted');
                if (indent && commaFirst) {
                    if ((this.path || []).length === 0
                    || Array.isArray(this.parent.node)) {
                        write('[ ');
                    }
                    else write('\n' + indentx + '[ ');
                }
                else if (indent) {
                    write('[\n' + indentx);
                }
                else {
                    write('[');
                }
            });
            
            this.post(function (child) {
                if (!child.isLast && !(indent && commaFirst)) {
                    write(',');
                }
                
                var prev = prevNode && prevNode[child.key];
                if (indent && opts.comment && child.node !== prev
                && (typeof child.node !== 'object' || typeof prev !== 'object')
                ) {
                    set('comment');
                    write(' // != ');
                    traverse(prev).forEach(function (x) {
                        plainStringify.call(this, x, { indent : 0 });
                    });
                    unset('comment');
                }
                
                if (!child.isLast) {
                    if (indent && commaFirst) {
                        write('\n' + indentx + ', ');
                    }
                    else if (indent) {
                        write('\n' + indentx);
                    }
                }
            });
            
            this.after(function () {
                if (indent && commaFirst) write('\n' + indentx);
                else if (indent) write('\n' + indentx.slice(indent));
                
                write(']');
                if (updated) unset('updated');
                if (inserted) unset('inserted');
            });
        }
        else if (isRegExp(node)) {
            this.block();
            
            if (inserted) {
                set('inserted');
                write(node.toString());
                unset('inserted');
            }
            else if (insertable && prevNode !== node) {
                set('updated');
                write(node.toString());
                unset('updated');
            }
            else write(node.toString());
        }
        else if (typeof node === 'object'
        && node && typeof node.inspect === 'function') {
            this.block();
            if (inserted) {
                set('inserted');
                write(node.inspect());
                unset('inserted');
            }
            else if (!(prevNode && typeof prevNode.inspect === 'function'
            && prevNode.inspect() === node.inspect())) {
                set('updated');
                write(node.inspect());
                unset('updated');
            }
            else write(node.inspect());
        }
        else if (typeof node == 'object' && node !== null) {
            var insertedKey = false;
            var deleted = insertable && typeof prevNode === 'object' && prevNode
                ? Object.keys(prevNode).filter(function (key) {
                    return !Object.hasOwnProperty.call(node, key);
                })
                : []
            ;
            
            this.before(function () {
                if (inserted) set('inserted');
                write(indent && commaFirst && !this.isRoot
                    ? '\n' + indentx + '{ '
                    : '{'
                );
            });
            
            this.pre(function (x, key) {
                if (insertable) {
                    var obj = traverse.get(prev, this.path.concat(key));
                    if (obj === undefined) {
                        insertedKey = true;
                        set('inserted');
                    }
                }
                
                if (indent && !commaFirst) write('\n' + indentx);
                
                plainStringify(key);
                write(indent ? ' : ' : ':');
            });
            
            this.post(function (child) {
                if (!child.isLast && !(indent && commaFirst)) {
                    write(',');
                }
                
                if (child.isLast && deleted.length) {
                    if (insertedKey) unset('inserted');
                    insertedKey = false;
                }
                else if (insertedKey) {
                    unset('inserted');
                    insertedKey = false;
                }
                
                var prev = prevNode && prevNode[child.key];
                if (indent && opts.comment && child.node !== prev
                && (typeof child.node !== 'object' || typeof prev !== 'object')
                ) {
                    set('comment');
                    write(' // != ');
                    traverse(prev).forEach(function (x) {
                        plainStringify.call(this, x, { indent : 0 });
                    });
                    unset('comment');
                }
                
                if (child.isLast && deleted.length) {
                    if (insertedKey) unset('inserted');
                    insertedKey = false;
                    
                    if (indent && commaFirst) {
                        write('\n' + indentx + ', ')
                    }
                    else if (opts.comment && indent) {
                        write('\n' + indentx);
                    }
                    else if (indent) {
                        write(',\n' + indentx);
                    }
                    else write(',');
                }
                else {
                    if (!child.isLast) {
                        if (indent && commaFirst) {
                            write('\n' + indentx + ', ');
                        }
                    }
                }
            });
            
            this.after(function () {
                if (inserted) unset('inserted');
                
                if (deleted.length) {
                    if (indent && !commaFirst
                    && Object.keys(node).length === 0) {
                        write('\n' + indentx);
                    }
                    
                    set('deleted');
                    deleted.forEach(function (key, ix) {
                        if (indent && opts.comment) {
                            unset('deleted');
                            set('comment');
                            write('// ');
                            unset('comment');
                            set('deleted');
                        }
                        
                        plainStringify(key);
                        write(indent ? ' : ' : ':');
                        traverse(prevNode[key]).forEach(function (x) {
                            plainStringify.call(this, x, { indent : 0 });
                        });
                        
                        var last = ix === deleted.length - 1;
                        if (insertable && !last) {
                            if (indent && commaFirst) {
                                write('\n' + indentx + ', ');
                            }
                            else if (indent) {
                                write(',\n' + indentx);
                            }
                            else write(',');
                        }
                    });
                    unset('deleted');
                }
                
                if (commaFirst && indent) {
                    write(indentx.slice(indent) + ' }');
                }
                else if (indent) {
                    write('\n' + indentx.slice(indent) + '}');
                }
                else write('}');
            });
        }
        else {
            var changed = false;
            
            if (inserted) set('inserted');
            else if (insertable && !deepEqual(prevNode, node)) {
                changed = true;
                set('updated');
            }
            
            if (typeof node === 'string') {
                write('"' + node.toString().replace(/"/g, '\\"') + '"');
            }
            else if (isRegExp(node)) {
                write(node.toString());
            }
            else if (typeof node === 'function') {
                write(node.name
                    ? '[Function: ' + node.name + ']'
                    : '[Function]'
                );
            }
            else if (node === undefined) {
                write('undefined');
            }
            else if (node === null) {
                write('null');
            }
            else {
                write(node.toString());
            }
            
            if (inserted) unset('inserted');
            else if (changed) unset('updated');
        }
    }
    
    if (opts.stream) {
        traverse(next).forEach(stringify);
    }
    else process.nextTick(function () {
        traverse(next).forEach(stringify);
        stream.emit('end');
    });
    
    return stream;
}

function isRegExp (node) {
    return node instanceof RegExp || (node
        && typeof node.test === 'function' 
        && typeof node.exec === 'function'
        && typeof node.compile === 'function'
        && node.constructor && node.constructor.name === 'RegExp'
    );
}

})(require("__browserify_process"))
},{"stream":8,"traverse":10,"charm":11,"deep-equal":12,"__browserify_process":7}],10:[function(require,module,exports){
var traverse = module.exports = function (obj) {
    return new Traverse(obj);
};

function Traverse (obj) {
    this.value = obj;
}

Traverse.prototype.get = function (ps) {
    var node = this.value;
    for (var i = 0; i < ps.length; i ++) {
        var key = ps[i];
        if (!Object.hasOwnProperty.call(node, key)) {
            node = undefined;
            break;
        }
        node = node[key];
    }
    return node;
};

Traverse.prototype.has = function (ps) {
    var node = this.value;
    for (var i = 0; i < ps.length; i ++) {
        var key = ps[i];
        if (!Object.hasOwnProperty.call(node, key)) {
            return false;
        }
        node = node[key];
    }
    return true;
};

Traverse.prototype.set = function (ps, value) {
    var node = this.value;
    for (var i = 0; i < ps.length - 1; i ++) {
        var key = ps[i];
        if (!Object.hasOwnProperty.call(node, key)) node[key] = {};
        node = node[key];
    }
    node[ps[i]] = value;
    return value;
};

Traverse.prototype.map = function (cb) {
    return walk(this.value, cb, true);
};

Traverse.prototype.forEach = function (cb) {
    this.value = walk(this.value, cb, false);
    return this.value;
};

Traverse.prototype.reduce = function (cb, init) {
    var skip = arguments.length === 1;
    var acc = skip ? this.value : init;
    this.forEach(function (x) {
        if (!this.isRoot || !skip) {
            acc = cb.call(this, acc, x);
        }
    });
    return acc;
};

Traverse.prototype.paths = function () {
    var acc = [];
    this.forEach(function (x) {
        acc.push(this.path); 
    });
    return acc;
};

Traverse.prototype.nodes = function () {
    var acc = [];
    this.forEach(function (x) {
        acc.push(this.node);
    });
    return acc;
};

Traverse.prototype.clone = function () {
    var parents = [], nodes = [];
    
    return (function clone (src) {
        for (var i = 0; i < parents.length; i++) {
            if (parents[i] === src) {
                return nodes[i];
            }
        }
        
        if (typeof src === 'object' && src !== null) {
            var dst = copy(src);
            
            parents.push(src);
            nodes.push(dst);
            
            forEach(objectKeys(src), function (key) {
                dst[key] = clone(src[key]);
            });
            
            parents.pop();
            nodes.pop();
            return dst;
        }
        else {
            return src;
        }
    })(this.value);
};

function walk (root, cb, immutable) {
    var path = [];
    var parents = [];
    var alive = true;
    
    return (function walker (node_) {
        var node = immutable ? copy(node_) : node_;
        var modifiers = {};
        
        var keepGoing = true;
        
        var state = {
            node : node,
            node_ : node_,
            path : [].concat(path),
            parent : parents[parents.length - 1],
            parents : parents,
            key : path.slice(-1)[0],
            isRoot : path.length === 0,
            level : path.length,
            circular : null,
            update : function (x, stopHere) {
                if (!state.isRoot) {
                    state.parent.node[state.key] = x;
                }
                state.node = x;
                if (stopHere) keepGoing = false;
            },
            'delete' : function (stopHere) {
                delete state.parent.node[state.key];
                if (stopHere) keepGoing = false;
            },
            remove : function (stopHere) {
                if (isArray(state.parent.node)) {
                    state.parent.node.splice(state.key, 1);
                }
                else {
                    delete state.parent.node[state.key];
                }
                if (stopHere) keepGoing = false;
            },
            keys : null,
            before : function (f) { modifiers.before = f },
            after : function (f) { modifiers.after = f },
            pre : function (f) { modifiers.pre = f },
            post : function (f) { modifiers.post = f },
            stop : function () { alive = false },
            block : function () { keepGoing = false }
        };
        
        if (!alive) return state;
        
        function updateState() {
            if (typeof state.node === 'object' && state.node !== null) {
                if (!state.keys || state.node_ !== state.node) {
                    state.keys = objectKeys(state.node)
                }
                
                state.isLeaf = state.keys.length == 0;
                
                for (var i = 0; i < parents.length; i++) {
                    if (parents[i].node_ === node_) {
                        state.circular = parents[i];
                        break;
                    }
                }
            }
            else {
                state.isLeaf = true;
                state.keys = null;
            }
            
            state.notLeaf = !state.isLeaf;
            state.notRoot = !state.isRoot;
        }
        
        updateState();
        
        // use return values to update if defined
        var ret = cb.call(state, state.node);
        if (ret !== undefined && state.update) state.update(ret);
        
        if (modifiers.before) modifiers.before.call(state, state.node);
        
        if (!keepGoing) return state;
        
        if (typeof state.node == 'object'
        && state.node !== null && !state.circular) {
            parents.push(state);
            
            updateState();
            
            forEach(state.keys, function (key, i) {
                path.push(key);
                
                if (modifiers.pre) modifiers.pre.call(state, state.node[key], key);
                
                var child = walker(state.node[key]);
                if (immutable && Object.hasOwnProperty.call(state.node, key)) {
                    state.node[key] = child.node;
                }
                
                child.isLast = i == state.keys.length - 1;
                child.isFirst = i == 0;
                
                if (modifiers.post) modifiers.post.call(state, child);
                
                path.pop();
            });
            parents.pop();
        }
        
        if (modifiers.after) modifiers.after.call(state, state.node);
        
        return state;
    })(root).node;
}

function copy (src) {
    if (typeof src === 'object' && src !== null) {
        var dst;
        
        if (isArray(src)) {
            dst = [];
        }
        else if (isDate(src)) {
            dst = new Date(src);
        }
        else if (isRegExp(src)) {
            dst = new RegExp(src);
        }
        else if (isError(src)) {
            dst = { message: src.message };
        }
        else if (isBoolean(src)) {
            dst = new Boolean(src);
        }
        else if (isNumber(src)) {
            dst = new Number(src);
        }
        else if (isString(src)) {
            dst = new String(src);
        }
        else if (Object.create && Object.getPrototypeOf) {
            dst = Object.create(Object.getPrototypeOf(src));
        }
        else if (src.constructor === Object) {
            dst = {};
        }
        else {
            var proto =
                (src.constructor && src.constructor.prototype)
                || src.__proto__
                || {}
            ;
            var T = function () {};
            T.prototype = proto;
            dst = new T;
        }
        
        forEach(objectKeys(src), function (key) {
            dst[key] = src[key];
        });
        return dst;
    }
    else return src;
}

var objectKeys = Object.keys || function keys (obj) {
    var res = [];
    for (var key in obj) res.push(key)
    return res;
};

function toS (obj) { return Object.prototype.toString.call(obj) }
function isDate (obj) { return toS(obj) === '[object Date]' }
function isRegExp (obj) { return toS(obj) === '[object RegExp]' }
function isError (obj) { return toS(obj) === '[object Error]' }
function isBoolean (obj) { return toS(obj) === '[object Boolean]' }
function isNumber (obj) { return toS(obj) === '[object Number]' }
function isString (obj) { return toS(obj) === '[object String]' }

var isArray = Array.isArray || function isArray (xs) {
    return Object.prototype.toString.call(xs) === '[object Array]';
};

var forEach = function (xs, fn) {
    if (xs.forEach) return xs.forEach(fn)
    else for (var i = 0; i < xs.length; i++) {
        fn(xs[i], i, xs);
    }
};

forEach(objectKeys(Traverse.prototype), function (key) {
    traverse[key] = function (obj) {
        var args = [].slice.call(arguments, 1);
        var t = new Traverse(obj);
        return t[key].apply(t, args);
    };
});

},{}],12:[function(require,module,exports){
var pSlice = Array.prototype.slice;
var Object_keys = typeof Object.keys === 'function'
    ? Object.keys
    : function (obj) {
        var keys = [];
        for (var key in obj) keys.push(key);
        return keys;
    }
;

var deepEqual = module.exports = function (actual, expected) {
  // 7.1. All identical values are equivalent, as determined by ===.
  if (actual === expected) {
    return true;

  } else if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();

  // 7.3. Other pairs that do not both pass typeof value == 'object',
  // equivalence is determined by ==.
  } else if (typeof actual != 'object' && typeof expected != 'object') {
    return actual == expected;

  // 7.4. For all other Object pairs, including Array objects, equivalence is
  // determined by having the same number of owned properties (as verified
  // with Object.prototype.hasOwnProperty.call), the same set of keys
  // (although not necessarily the same order), equivalent values for every
  // corresponding key, and an identical 'prototype' property. Note: this
  // accounts for both named and indexed properties on Arrays.
  } else {
    return objEquiv(actual, expected);
  }
}

function isUndefinedOrNull(value) {
  return value === null || value === undefined;
}

function isArguments(object) {
  return Object.prototype.toString.call(object) == '[object Arguments]';
}

function objEquiv(a, b) {
  if (isUndefinedOrNull(a) || isUndefinedOrNull(b))
    return false;
  // an identical 'prototype' property.
  if (a.prototype !== b.prototype) return false;
  //~~~I've managed to break Object.keys through screwy arguments passing.
  //   Converting to array solves the problem.
  if (isArguments(a)) {
    if (!isArguments(b)) {
      return false;
    }
    a = pSlice.call(a);
    b = pSlice.call(b);
    return deepEqual(a, b);
  }
  try {
    var ka = Object_keys(a),
        kb = Object_keys(b),
        key, i;
  } catch (e) {//happens when one is a string literal and the other isn't
    return false;
  }
  // having the same number of owned properties (keys incorporates
  // hasOwnProperty)
  if (ka.length != kb.length)
    return false;
  //the same set of keys (although not necessarily the same order),
  ka.sort();
  kb.sort();
  //~~~cheap key test
  for (i = ka.length - 1; i >= 0; i--) {
    if (ka[i] != kb[i])
      return false;
  }
  //equivalent values for every corresponding key, and
  //~~~possibly expensive deep test
  for (i = ka.length - 1; i >= 0; i--) {
    key = ka[i];
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

},{}],13:[function(require,module,exports){
exports.isatty = function () {};
exports.setRawMode = function () {};

},{}],11:[function(require,module,exports){
(function(process){var tty = require('tty');
var encode = require('./lib/encode');
var EventEmitter = require('events').EventEmitter;

var exports = module.exports = function () {
    var input = null;
    function setInput (s) {
        if (input) throw new Error('multiple inputs specified')
        else input = s
    }
    
    var output = null;
    function setOutput (s) {
        if (output) throw new Error('multiple outputs specified')
        else output = s
    }
    
    for (var i = 0; i < arguments.length; i++) {
        var arg = arguments[i];
        if (!arg) continue;
        if (arg.readable) setInput(arg)
        else if (arg.stdin || arg.input) setInput(arg.stdin || arg.input)
        
        if (arg.writable) setOutput(arg)
        else if (arg.stdout || arg.output) setOutput(arg.stdout || arg.output)
        
    }
    
    return new Charm(input, output);
};

var Charm = exports.Charm = function (input, output) {
    var self = this;
    self.input = input;
    self.output = output;
    self.pending = [];
    
    if (!output) {
        self.emit('error', new Error('output stream required'));
    }
    
    if (input && typeof input.fd === 'number' && tty.isatty(input.fd)) {
        if (process.stdin.setRawMode) {
            process.stdin.setRawMode(true);
        }
        else tty.setRawMode(true);
        input.resume();
    }
    
    if (input) {
        input.on('data', function (buf) {
            if (self.pending.length) {
                var codes = extractCodes(buf);
                var matched = false;
                
                for (var i = 0; i < codes.length; i++) {
                    for (var j = 0; j < self.pending.length; j++) {
                        var cb = self.pending[j];
                        if (cb(codes[i])) {
                            matched = true;
                            self.pending.splice(j, 1);
                            break;
                        }
                    }
                }
                
                if (matched) return;
            }
            
            self.emit('data', buf)
            
            if (buf.length === 1) {
                if (buf[0] === 3) self.emit('^C');
                if (buf[0] === 4) self.emit('^D');
            }
        });
    }
}

Charm.prototype = new EventEmitter;

Charm.prototype.destroy = function () {
    if (this.input) this.input.destroy()
};

Charm.prototype.write = function (msg) {
    this.output.write(msg);
    return this;
};

Charm.prototype.reset = function (cb) {
    this.write(encode('c'));
    return this;
};

Charm.prototype.position = function (x, y) {
    // get/set absolute coordinates
    if (typeof x === 'function') {
        var cb = x;
        this.pending.push(function (buf) {
            if (buf[0] === 27 && buf[1] === encode.ord('[')
            && buf[buf.length-1] === encode.ord('R')) {
                var pos = buf.toString()
                    .slice(2,-1)
                    .split(';')
                    .map(Number)
                ;
                cb(pos[1], pos[0]);
                return true;
            }
        });
        this.write(encode('[6n'));
    }
    else {
        this.write(encode(
            '[' + Math.floor(y) + ';' + Math.floor(x) + 'f'
        ));
    }
    return this;
};

Charm.prototype.move = function (x, y) {
    // set relative coordinates
    var bufs = [];
    
    if (y < 0) this.up(-y)
    else if (y > 0) this.down(y)
    
    if (x > 0) this.right(x)
    else if (x < 0) this.left(-x)
    
    return this;
};

Charm.prototype.up = function (y) {
    if (y === undefined) y = 1;
    this.write(encode('[' + Math.floor(y) + 'A'));
    return this;
};

Charm.prototype.down = function (y) {
    if (y === undefined) y = 1;
    this.write(encode('[' + Math.floor(y) + 'B'));
    return this;
};

Charm.prototype.right = function (x) {
    if (x === undefined) x = 1;
    this.write(encode('[' + Math.floor(x) + 'C'));
    return this;
};

Charm.prototype.left = function (x) {
    if (x === undefined) x = 1;
    this.write(encode('[' + Math.floor(x) + 'D'));
    return this;
};

Charm.prototype.column = function (x) {
    this.write(encode('[' + Math.floor(x) + 'G'));
    return this;
};

Charm.prototype.push = function (withAttributes) {
    this.write(encode(withAttributes ? '7' : '[s'));
    return this;
};

Charm.prototype.pop = function (withAttributes) {
    this.write(encode(withAttributes ? '8' : '[u'));
    return this;
};

Charm.prototype.erase = function (s) {
    if (s === 'end' || s === '$') {
        this.write(encode('[K'));
    }
    else if (s === 'start' || s === '^') {
        this.write(encode('[1K'));
    }
    else if (s === 'line') {
        this.write(encode('[2K'));
    }
    else if (s === 'down') {
        this.write(encode('[J'));
    }
    else if (s === 'up') {
        this.write(encode('[1J'));
    }
    else if (s === 'screen') {
        this.write(encode('[1J'));
    }
    else {
        this.emit('error', new Error('Unknown erase type: ' + s));
    }
    return this;
};

Charm.prototype.display = function (attr) {
    var c = {
        reset : 0,
        bright : 1,
        dim : 2,
        underscore : 4,
        blink : 5,
        reverse : 7,
        hidden : 8
    }[attr];
    if (c === undefined) {
        this.emit('error', new Error('Unknown attribute: ' + attr));
    }
    this.write(encode('[' + c + 'm'));
    return this;
};

Charm.prototype.foreground = function (color) {
    if (typeof color === 'number') {
        if (color < 0 || color >= 256) {
            this.emit('error', new Error('Color out of range: ' + color));
        }
        this.write(encode('[38;5;' + color + 'm'));
    }
    else {
        var c = {
            black : 30,
            red : 31,
            green : 32,
            yellow : 33,
            blue : 34,
            magenta : 35,
            cyan : 36,
            white : 37
        }[color.toLowerCase()];
        
        if (!c) this.emit('error', new Error('Unknown color: ' + color));
        this.write(encode('[' + c + 'm'));
    }
    return this;
};

Charm.prototype.background = function (color) {
    if (typeof color === 'number') {
        if (color < 0 || color >= 256) {
            this.emit('error', new Error('Color out of range: ' + color));
        }
        this.write(encode('[48;5;' + color + 'm'));
    }
    else {
        var c = {
          black : 40,
          red : 41,
          green : 42,
          yellow : 43,
          blue : 44,
          magenta : 45,
          cyan : 46,
          white : 47
        }[color.toLowerCase()];
        
        if (!c) this.emit('error', new Error('Unknown color: ' + color));
        this.write(encode('[' + c + 'm'));
    }
    return this;
};

Charm.prototype.cursor = function (visible) {
    this.write(encode(visible ? '[?25h' : '[?25l'));
    return this;
};

var extractCodes = exports.extractCodes = function (buf) {
    var codes = [];
    var start = -1;
    
    for (var i = 0; i < buf.length; i++) {
        if (buf[i] === 27) {
            if (start >= 0) codes.push(buf.slice(start, i));
            start = i;
        }
        else if (start >= 0 && i === buf.length - 1) {
            codes.push(buf.slice(start));
        }
    }
    
    return codes;
}

})(require("__browserify_process"))
},{"tty":13,"events":2,"./lib/encode":14,"__browserify_process":7}],15:[function(require,module,exports){
require=(function(e,t,n,r){function i(r){if(!n[r]){if(!t[r]){if(e)return e(r);throw new Error("Cannot find module '"+r+"'")}var s=n[r]={exports:{}};t[r][0](function(e){var n=t[r][1][e];return i(n?n:e)},s,s.exports)}return n[r].exports}for(var s=0;s<r.length;s++)i(r[s]);return i})(typeof require!=="undefined"&&require,{1:[function(require,module,exports){
exports.readIEEE754 = function(buffer, offset, isBE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isBE ? 0 : (nBytes - 1),
      d = isBE ? 1 : -1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.writeIEEE754 = function(buffer, value, offset, isBE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isBE ? (nBytes - 1) : 0,
      d = isBE ? -1 : 1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

},{}],2:[function(require,module,exports){
(function(){// UTILITY
var util = require('util');
var Buffer = require("buffer").Buffer;
var pSlice = Array.prototype.slice;

function objectKeys(object) {
  if (Object.keys) return Object.keys(object);
  var result = [];
  for (var name in object) {
    if (Object.prototype.hasOwnProperty.call(object, name)) {
      result.push(name);
    }
  }
  return result;
}

// 1. The assert module provides functions that throw
// AssertionError's when particular conditions are not met. The
// assert module must conform to the following interface.

var assert = module.exports = ok;

// 2. The AssertionError is defined in assert.
// new assert.AssertionError({ message: message,
//                             actual: actual,
//                             expected: expected })

assert.AssertionError = function AssertionError(options) {
  this.name = 'AssertionError';
  this.message = options.message;
  this.actual = options.actual;
  this.expected = options.expected;
  this.operator = options.operator;
  var stackStartFunction = options.stackStartFunction || fail;

  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, stackStartFunction);
  }
};
util.inherits(assert.AssertionError, Error);

function replacer(key, value) {
  if (value === undefined) {
    return '' + value;
  }
  if (typeof value === 'number' && (isNaN(value) || !isFinite(value))) {
    return value.toString();
  }
  if (typeof value === 'function' || value instanceof RegExp) {
    return value.toString();
  }
  return value;
}

function truncate(s, n) {
  if (typeof s == 'string') {
    return s.length < n ? s : s.slice(0, n);
  } else {
    return s;
  }
}

assert.AssertionError.prototype.toString = function() {
  if (this.message) {
    return [this.name + ':', this.message].join(' ');
  } else {
    return [
      this.name + ':',
      truncate(JSON.stringify(this.actual, replacer), 128),
      this.operator,
      truncate(JSON.stringify(this.expected, replacer), 128)
    ].join(' ');
  }
};

// assert.AssertionError instanceof Error

assert.AssertionError.__proto__ = Error.prototype;

// At present only the three keys mentioned above are used and
// understood by the spec. Implementations or sub modules can pass
// other keys to the AssertionError's constructor - they will be
// ignored.

// 3. All of the following functions must throw an AssertionError
// when a corresponding condition is not met, with a message that
// may be undefined if not provided.  All assertion methods provide
// both the actual and expected values to the assertion error for
// display purposes.

function fail(actual, expected, message, operator, stackStartFunction) {
  throw new assert.AssertionError({
    message: message,
    actual: actual,
    expected: expected,
    operator: operator,
    stackStartFunction: stackStartFunction
  });
}

// EXTENSION! allows for well behaved errors defined elsewhere.
assert.fail = fail;

// 4. Pure assertion tests whether a value is truthy, as determined
// by !!guard.
// assert.ok(guard, message_opt);
// This statement is equivalent to assert.equal(true, guard,
// message_opt);. To test strictly for the value true, use
// assert.strictEqual(true, guard, message_opt);.

function ok(value, message) {
  if (!!!value) fail(value, true, message, '==', assert.ok);
}
assert.ok = ok;

// 5. The equality assertion tests shallow, coercive equality with
// ==.
// assert.equal(actual, expected, message_opt);

assert.equal = function equal(actual, expected, message) {
  if (actual != expected) fail(actual, expected, message, '==', assert.equal);
};

// 6. The non-equality assertion tests for whether two objects are not equal
// with != assert.notEqual(actual, expected, message_opt);

assert.notEqual = function notEqual(actual, expected, message) {
  if (actual == expected) {
    fail(actual, expected, message, '!=', assert.notEqual);
  }
};

// 7. The equivalence assertion tests a deep equality relation.
// assert.deepEqual(actual, expected, message_opt);

assert.deepEqual = function deepEqual(actual, expected, message) {
  if (!_deepEqual(actual, expected)) {
    fail(actual, expected, message, 'deepEqual', assert.deepEqual);
  }
};

function _deepEqual(actual, expected) {
  // 7.1. All identical values are equivalent, as determined by ===.
  if (actual === expected) {
    return true;

  } else if (Buffer.isBuffer(actual) && Buffer.isBuffer(expected)) {
    if (actual.length != expected.length) return false;

    for (var i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) return false;
    }

    return true;

  // 7.2. If the expected value is a Date object, the actual value is
  // equivalent if it is also a Date object that refers to the same time.
  } else if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();

  // 7.3. Other pairs that do not both pass typeof value == 'object',
  // equivalence is determined by ==.
  } else if (typeof actual != 'object' && typeof expected != 'object') {
    return actual == expected;

  // 7.4. For all other Object pairs, including Array objects, equivalence is
  // determined by having the same number of owned properties (as verified
  // with Object.prototype.hasOwnProperty.call), the same set of keys
  // (although not necessarily the same order), equivalent values for every
  // corresponding key, and an identical 'prototype' property. Note: this
  // accounts for both named and indexed properties on Arrays.
  } else {
    return objEquiv(actual, expected);
  }
}

function isUndefinedOrNull(value) {
  return value === null || value === undefined;
}

function isArguments(object) {
  return Object.prototype.toString.call(object) == '[object Arguments]';
}

function objEquiv(a, b) {
  if (isUndefinedOrNull(a) || isUndefinedOrNull(b))
    return false;
  // an identical 'prototype' property.
  if (a.prototype !== b.prototype) return false;
  //~~~I've managed to break Object.keys through screwy arguments passing.
  //   Converting to array solves the problem.
  if (isArguments(a)) {
    if (!isArguments(b)) {
      return false;
    }
    a = pSlice.call(a);
    b = pSlice.call(b);
    return _deepEqual(a, b);
  }
  try {
    var ka = objectKeys(a),
        kb = objectKeys(b),
        key, i;
  } catch (e) {//happens when one is a string literal and the other isn't
    return false;
  }
  // having the same number of owned properties (keys incorporates
  // hasOwnProperty)
  if (ka.length != kb.length)
    return false;
  //the same set of keys (although not necessarily the same order),
  ka.sort();
  kb.sort();
  //~~~cheap key test
  for (i = ka.length - 1; i >= 0; i--) {
    if (ka[i] != kb[i])
      return false;
  }
  //equivalent values for every corresponding key, and
  //~~~possibly expensive deep test
  for (i = ka.length - 1; i >= 0; i--) {
    key = ka[i];
    if (!_deepEqual(a[key], b[key])) return false;
  }
  return true;
}

// 8. The non-equivalence assertion tests for any deep inequality.
// assert.notDeepEqual(actual, expected, message_opt);

assert.notDeepEqual = function notDeepEqual(actual, expected, message) {
  if (_deepEqual(actual, expected)) {
    fail(actual, expected, message, 'notDeepEqual', assert.notDeepEqual);
  }
};

// 9. The strict equality assertion tests strict equality, as determined by ===.
// assert.strictEqual(actual, expected, message_opt);

assert.strictEqual = function strictEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(actual, expected, message, '===', assert.strictEqual);
  }
};

// 10. The strict non-equality assertion tests for strict inequality, as
// determined by !==.  assert.notStrictEqual(actual, expected, message_opt);

assert.notStrictEqual = function notStrictEqual(actual, expected, message) {
  if (actual === expected) {
    fail(actual, expected, message, '!==', assert.notStrictEqual);
  }
};

function expectedException(actual, expected) {
  if (!actual || !expected) {
    return false;
  }

  if (expected instanceof RegExp) {
    return expected.test(actual);
  } else if (actual instanceof expected) {
    return true;
  } else if (expected.call({}, actual) === true) {
    return true;
  }

  return false;
}

function _throws(shouldThrow, block, expected, message) {
  var actual;

  if (typeof expected === 'string') {
    message = expected;
    expected = null;
  }

  try {
    block();
  } catch (e) {
    actual = e;
  }

  message = (expected && expected.name ? ' (' + expected.name + ').' : '.') +
            (message ? ' ' + message : '.');

  if (shouldThrow && !actual) {
    fail('Missing expected exception' + message);
  }

  if (!shouldThrow && expectedException(actual, expected)) {
    fail('Got unwanted exception' + message);
  }

  if ((shouldThrow && actual && expected &&
      !expectedException(actual, expected)) || (!shouldThrow && actual)) {
    throw actual;
  }
}

// 11. Expected to throw an error:
// assert.throws(block, Error_opt, message_opt);

assert.throws = function(block, /*optional*/error, /*optional*/message) {
  _throws.apply(this, [true].concat(pSlice.call(arguments)));
};

// EXTENSION! This is annoying to write outside this module.
assert.doesNotThrow = function(block, /*optional*/error, /*optional*/message) {
  _throws.apply(this, [false].concat(pSlice.call(arguments)));
};

assert.ifError = function(err) { if (err) {throw err;}};

})()
},{"util":3,"buffer":4}],"buffer-browserify":[function(require,module,exports){
module.exports=require('q9TxCC');
},{}],"q9TxCC":[function(require,module,exports){
(function(){function SlowBuffer (size) {
    this.length = size;
};

var assert = require('assert');

exports.INSPECT_MAX_BYTES = 50;


function toHex(n) {
  if (n < 16) return '0' + n.toString(16);
  return n.toString(16);
}

function utf8ToBytes(str) {
  var byteArray = [];
  for (var i = 0; i < str.length; i++)
    if (str.charCodeAt(i) <= 0x7F)
      byteArray.push(str.charCodeAt(i));
    else {
      var h = encodeURIComponent(str.charAt(i)).substr(1).split('%');
      for (var j = 0; j < h.length; j++)
        byteArray.push(parseInt(h[j], 16));
    }

  return byteArray;
}

function asciiToBytes(str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++ )
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push( str.charCodeAt(i) & 0xFF );

  return byteArray;
}

function base64ToBytes(str) {
  return require("base64-js").toByteArray(str);
}

SlowBuffer.byteLength = function (str, encoding) {
  switch (encoding || "utf8") {
    case 'hex':
      return str.length / 2;

    case 'utf8':
    case 'utf-8':
      return utf8ToBytes(str).length;

    case 'ascii':
    case 'binary':
      return str.length;

    case 'base64':
      return base64ToBytes(str).length;

    default:
      throw new Error('Unknown encoding');
  }
};

function blitBuffer(src, dst, offset, length) {
  var pos, i = 0;
  while (i < length) {
    if ((i+offset >= dst.length) || (i >= src.length))
      break;

    dst[i + offset] = src[i];
    i++;
  }
  return i;
}

SlowBuffer.prototype.utf8Write = function (string, offset, length) {
  var bytes, pos;
  return SlowBuffer._charsWritten =  blitBuffer(utf8ToBytes(string), this, offset, length);
};

SlowBuffer.prototype.asciiWrite = function (string, offset, length) {
  var bytes, pos;
  return SlowBuffer._charsWritten =  blitBuffer(asciiToBytes(string), this, offset, length);
};

SlowBuffer.prototype.binaryWrite = SlowBuffer.prototype.asciiWrite;

SlowBuffer.prototype.base64Write = function (string, offset, length) {
  var bytes, pos;
  return SlowBuffer._charsWritten = blitBuffer(base64ToBytes(string), this, offset, length);
};

SlowBuffer.prototype.base64Slice = function (start, end) {
  var bytes = Array.prototype.slice.apply(this, arguments)
  return require("base64-js").fromByteArray(bytes);
}

function decodeUtf8Char(str) {
  try {
    return decodeURIComponent(str);
  } catch (err) {
    return String.fromCharCode(0xFFFD); // UTF 8 invalid char
  }
}

SlowBuffer.prototype.utf8Slice = function () {
  var bytes = Array.prototype.slice.apply(this, arguments);
  var res = "";
  var tmp = "";
  var i = 0;
  while (i < bytes.length) {
    if (bytes[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(bytes[i]);
      tmp = "";
    } else
      tmp += "%" + bytes[i].toString(16);

    i++;
  }

  return res + decodeUtf8Char(tmp);
}

SlowBuffer.prototype.asciiSlice = function () {
  var bytes = Array.prototype.slice.apply(this, arguments);
  var ret = "";
  for (var i = 0; i < bytes.length; i++)
    ret += String.fromCharCode(bytes[i]);
  return ret;
}

SlowBuffer.prototype.binarySlice = SlowBuffer.prototype.asciiSlice;

SlowBuffer.prototype.inspect = function() {
  var out = [],
      len = this.length;
  for (var i = 0; i < len; i++) {
    out[i] = toHex(this[i]);
    if (i == exports.INSPECT_MAX_BYTES) {
      out[i + 1] = '...';
      break;
    }
  }
  return '<SlowBuffer ' + out.join(' ') + '>';
};


SlowBuffer.prototype.hexSlice = function(start, end) {
  var len = this.length;

  if (!start || start < 0) start = 0;
  if (!end || end < 0 || end > len) end = len;

  var out = '';
  for (var i = start; i < end; i++) {
    out += toHex(this[i]);
  }
  return out;
};


SlowBuffer.prototype.toString = function(encoding, start, end) {
  encoding = String(encoding || 'utf8').toLowerCase();
  start = +start || 0;
  if (typeof end == 'undefined') end = this.length;

  // Fastpath empty strings
  if (+end == start) {
    return '';
  }

  switch (encoding) {
    case 'hex':
      return this.hexSlice(start, end);

    case 'utf8':
    case 'utf-8':
      return this.utf8Slice(start, end);

    case 'ascii':
      return this.asciiSlice(start, end);

    case 'binary':
      return this.binarySlice(start, end);

    case 'base64':
      return this.base64Slice(start, end);

    case 'ucs2':
    case 'ucs-2':
      return this.ucs2Slice(start, end);

    default:
      throw new Error('Unknown encoding');
  }
};


SlowBuffer.prototype.hexWrite = function(string, offset, length) {
  offset = +offset || 0;
  var remaining = this.length - offset;
  if (!length) {
    length = remaining;
  } else {
    length = +length;
    if (length > remaining) {
      length = remaining;
    }
  }

  // must be an even number of digits
  var strLen = string.length;
  if (strLen % 2) {
    throw new Error('Invalid hex string');
  }
  if (length > strLen / 2) {
    length = strLen / 2;
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16);
    if (isNaN(byte)) throw new Error('Invalid hex string');
    this[offset + i] = byte;
  }
  SlowBuffer._charsWritten = i * 2;
  return i;
};


SlowBuffer.prototype.write = function(string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length;
      length = undefined;
    }
  } else {  // legacy
    var swap = encoding;
    encoding = offset;
    offset = length;
    length = swap;
  }

  offset = +offset || 0;
  var remaining = this.length - offset;
  if (!length) {
    length = remaining;
  } else {
    length = +length;
    if (length > remaining) {
      length = remaining;
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase();

  switch (encoding) {
    case 'hex':
      return this.hexWrite(string, offset, length);

    case 'utf8':
    case 'utf-8':
      return this.utf8Write(string, offset, length);

    case 'ascii':
      return this.asciiWrite(string, offset, length);

    case 'binary':
      return this.binaryWrite(string, offset, length);

    case 'base64':
      return this.base64Write(string, offset, length);

    case 'ucs2':
    case 'ucs-2':
      return this.ucs2Write(string, offset, length);

    default:
      throw new Error('Unknown encoding');
  }
};


// slice(start, end)
SlowBuffer.prototype.slice = function(start, end) {
  if (end === undefined) end = this.length;

  if (end > this.length) {
    throw new Error('oob');
  }
  if (start > end) {
    throw new Error('oob');
  }

  return new Buffer(this, end - start, +start);
};

SlowBuffer.prototype.copy = function(target, targetstart, sourcestart, sourceend) {
  var temp = [];
  for (var i=sourcestart; i<sourceend; i++) {
    assert.ok(typeof this[i] !== 'undefined', "copying undefined buffer bytes!");
    temp.push(this[i]);
  }

  for (var i=targetstart; i<targetstart+temp.length; i++) {
    target[i] = temp[i-targetstart];
  }
};

SlowBuffer.prototype.fill = function(value, start, end) {
  if (end > this.length) {
    throw new Error('oob');
  }
  if (start > end) {
    throw new Error('oob');
  }

  for (var i = start; i < end; i++) {
    this[i] = value;
  }
}

function coerce(length) {
  // Coerce length to a number (possibly NaN), round up
  // in case it's fractional (e.g. 123.456) then do a
  // double negate to coerce a NaN to 0. Easy, right?
  length = ~~Math.ceil(+length);
  return length < 0 ? 0 : length;
}


// Buffer

function Buffer(subject, encoding, offset) {
  if (!(this instanceof Buffer)) {
    return new Buffer(subject, encoding, offset);
  }

  var type;

  // Are we slicing?
  if (typeof offset === 'number') {
    this.length = coerce(encoding);
    this.parent = subject;
    this.offset = offset;
  } else {
    // Find the length
    switch (type = typeof subject) {
      case 'number':
        this.length = coerce(subject);
        break;

      case 'string':
        this.length = Buffer.byteLength(subject, encoding);
        break;

      case 'object': // Assume object is an array
        this.length = coerce(subject.length);
        break;

      default:
        throw new Error('First argument needs to be a number, ' +
                        'array or string.');
    }

    if (this.length > Buffer.poolSize) {
      // Big buffer, just alloc one.
      this.parent = new SlowBuffer(this.length);
      this.offset = 0;

    } else {
      // Small buffer.
      if (!pool || pool.length - pool.used < this.length) allocPool();
      this.parent = pool;
      this.offset = pool.used;
      pool.used += this.length;
    }

    // Treat array-ish objects as a byte array.
    if (isArrayIsh(subject)) {
      for (var i = 0; i < this.length; i++) {
        if (subject instanceof Buffer) {
          this.parent[i + this.offset] = subject.readUInt8(i);
        }
        else {
          this.parent[i + this.offset] = subject[i];
        }
      }
    } else if (type == 'string') {
      // We are a string
      this.length = this.write(subject, 0, encoding);
    }
  }

}

function isArrayIsh(subject) {
  return Array.isArray(subject) || Buffer.isBuffer(subject) ||
         subject && typeof subject === 'object' &&
         typeof subject.length === 'number';
}

exports.SlowBuffer = SlowBuffer;
exports.Buffer = Buffer;

Buffer.poolSize = 8 * 1024;
var pool;

function allocPool() {
  pool = new SlowBuffer(Buffer.poolSize);
  pool.used = 0;
}


// Static methods
Buffer.isBuffer = function isBuffer(b) {
  return b instanceof Buffer || b instanceof SlowBuffer;
};

Buffer.concat = function (list, totalLength) {
  if (!Array.isArray(list)) {
    throw new Error("Usage: Buffer.concat(list, [totalLength])\n \
      list should be an Array.");
  }

  if (list.length === 0) {
    return new Buffer(0);
  } else if (list.length === 1) {
    return list[0];
  }

  if (typeof totalLength !== 'number') {
    totalLength = 0;
    for (var i = 0; i < list.length; i++) {
      var buf = list[i];
      totalLength += buf.length;
    }
  }

  var buffer = new Buffer(totalLength);
  var pos = 0;
  for (var i = 0; i < list.length; i++) {
    var buf = list[i];
    buf.copy(buffer, pos);
    pos += buf.length;
  }
  return buffer;
};

// Inspect
Buffer.prototype.inspect = function inspect() {
  var out = [],
      len = this.length;

  for (var i = 0; i < len; i++) {
    out[i] = toHex(this.parent[i + this.offset]);
    if (i == exports.INSPECT_MAX_BYTES) {
      out[i + 1] = '...';
      break;
    }
  }

  return '<Buffer ' + out.join(' ') + '>';
};


Buffer.prototype.get = function get(i) {
  if (i < 0 || i >= this.length) throw new Error('oob');
  return this.parent[this.offset + i];
};


Buffer.prototype.set = function set(i, v) {
  if (i < 0 || i >= this.length) throw new Error('oob');
  return this.parent[this.offset + i] = v;
};


// write(string, offset = 0, length = buffer.length-offset, encoding = 'utf8')
Buffer.prototype.write = function(string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length;
      length = undefined;
    }
  } else {  // legacy
    var swap = encoding;
    encoding = offset;
    offset = length;
    length = swap;
  }

  offset = +offset || 0;
  var remaining = this.length - offset;
  if (!length) {
    length = remaining;
  } else {
    length = +length;
    if (length > remaining) {
      length = remaining;
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase();

  var ret;
  switch (encoding) {
    case 'hex':
      ret = this.parent.hexWrite(string, this.offset + offset, length);
      break;

    case 'utf8':
    case 'utf-8':
      ret = this.parent.utf8Write(string, this.offset + offset, length);
      break;

    case 'ascii':
      ret = this.parent.asciiWrite(string, this.offset + offset, length);
      break;

    case 'binary':
      ret = this.parent.binaryWrite(string, this.offset + offset, length);
      break;

    case 'base64':
      // Warning: maxLength not taken into account in base64Write
      ret = this.parent.base64Write(string, this.offset + offset, length);
      break;

    case 'ucs2':
    case 'ucs-2':
      ret = this.parent.ucs2Write(string, this.offset + offset, length);
      break;

    default:
      throw new Error('Unknown encoding');
  }

  Buffer._charsWritten = SlowBuffer._charsWritten;

  return ret;
};


// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function(encoding, start, end) {
  encoding = String(encoding || 'utf8').toLowerCase();

  if (typeof start == 'undefined' || start < 0) {
    start = 0;
  } else if (start > this.length) {
    start = this.length;
  }

  if (typeof end == 'undefined' || end > this.length) {
    end = this.length;
  } else if (end < 0) {
    end = 0;
  }

  start = start + this.offset;
  end = end + this.offset;

  switch (encoding) {
    case 'hex':
      return this.parent.hexSlice(start, end);

    case 'utf8':
    case 'utf-8':
      return this.parent.utf8Slice(start, end);

    case 'ascii':
      return this.parent.asciiSlice(start, end);

    case 'binary':
      return this.parent.binarySlice(start, end);

    case 'base64':
      return this.parent.base64Slice(start, end);

    case 'ucs2':
    case 'ucs-2':
      return this.parent.ucs2Slice(start, end);

    default:
      throw new Error('Unknown encoding');
  }
};


// byteLength
Buffer.byteLength = SlowBuffer.byteLength;


// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill(value, start, end) {
  value || (value = 0);
  start || (start = 0);
  end || (end = this.length);

  if (typeof value === 'string') {
    value = value.charCodeAt(0);
  }
  if (!(typeof value === 'number') || isNaN(value)) {
    throw new Error('value is not a number');
  }

  if (end < start) throw new Error('end < start');

  // Fill 0 bytes; we're done
  if (end === start) return 0;
  if (this.length == 0) return 0;

  if (start < 0 || start >= this.length) {
    throw new Error('start out of bounds');
  }

  if (end < 0 || end > this.length) {
    throw new Error('end out of bounds');
  }

  return this.parent.fill(value,
                          start + this.offset,
                          end + this.offset);
};


// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function(target, target_start, start, end) {
  var source = this;
  start || (start = 0);
  end || (end = this.length);
  target_start || (target_start = 0);

  if (end < start) throw new Error('sourceEnd < sourceStart');

  // Copy 0 bytes; we're done
  if (end === start) return 0;
  if (target.length == 0 || source.length == 0) return 0;

  if (target_start < 0 || target_start >= target.length) {
    throw new Error('targetStart out of bounds');
  }

  if (start < 0 || start >= source.length) {
    throw new Error('sourceStart out of bounds');
  }

  if (end < 0 || end > source.length) {
    throw new Error('sourceEnd out of bounds');
  }

  // Are we oob?
  if (end > this.length) {
    end = this.length;
  }

  if (target.length - target_start < end - start) {
    end = target.length - target_start + start;
  }

  return this.parent.copy(target.parent,
                          target_start + target.offset,
                          start + this.offset,
                          end + this.offset);
};


// slice(start, end)
Buffer.prototype.slice = function(start, end) {
  if (end === undefined) end = this.length;
  if (end > this.length) throw new Error('oob');
  if (start > end) throw new Error('oob');

  return new Buffer(this.parent, end - start, +start + this.offset);
};


// Legacy methods for backwards compatibility.

Buffer.prototype.utf8Slice = function(start, end) {
  return this.toString('utf8', start, end);
};

Buffer.prototype.binarySlice = function(start, end) {
  return this.toString('binary', start, end);
};

Buffer.prototype.asciiSlice = function(start, end) {
  return this.toString('ascii', start, end);
};

Buffer.prototype.utf8Write = function(string, offset) {
  return this.write(string, offset, 'utf8');
};

Buffer.prototype.binaryWrite = function(string, offset) {
  return this.write(string, offset, 'binary');
};

Buffer.prototype.asciiWrite = function(string, offset) {
  return this.write(string, offset, 'ascii');
};

Buffer.prototype.readUInt8 = function(offset, noAssert) {
  var buffer = this;

  if (!noAssert) {
    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset < buffer.length,
        'Trying to read beyond buffer length');
  }

  if (offset >= buffer.length) return;

  return buffer.parent[buffer.offset + offset];
};

function readUInt16(buffer, offset, isBigEndian, noAssert) {
  var val = 0;


  if (!noAssert) {
    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 1 < buffer.length,
        'Trying to read beyond buffer length');
  }

  if (offset >= buffer.length) return 0;

  if (isBigEndian) {
    val = buffer.parent[buffer.offset + offset] << 8;
    if (offset + 1 < buffer.length) {
      val |= buffer.parent[buffer.offset + offset + 1];
    }
  } else {
    val = buffer.parent[buffer.offset + offset];
    if (offset + 1 < buffer.length) {
      val |= buffer.parent[buffer.offset + offset + 1] << 8;
    }
  }

  return val;
}

Buffer.prototype.readUInt16LE = function(offset, noAssert) {
  return readUInt16(this, offset, false, noAssert);
};

Buffer.prototype.readUInt16BE = function(offset, noAssert) {
  return readUInt16(this, offset, true, noAssert);
};

function readUInt32(buffer, offset, isBigEndian, noAssert) {
  var val = 0;

  if (!noAssert) {
    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 3 < buffer.length,
        'Trying to read beyond buffer length');
  }

  if (offset >= buffer.length) return 0;

  if (isBigEndian) {
    if (offset + 1 < buffer.length)
      val = buffer.parent[buffer.offset + offset + 1] << 16;
    if (offset + 2 < buffer.length)
      val |= buffer.parent[buffer.offset + offset + 2] << 8;
    if (offset + 3 < buffer.length)
      val |= buffer.parent[buffer.offset + offset + 3];
    val = val + (buffer.parent[buffer.offset + offset] << 24 >>> 0);
  } else {
    if (offset + 2 < buffer.length)
      val = buffer.parent[buffer.offset + offset + 2] << 16;
    if (offset + 1 < buffer.length)
      val |= buffer.parent[buffer.offset + offset + 1] << 8;
    val |= buffer.parent[buffer.offset + offset];
    if (offset + 3 < buffer.length)
      val = val + (buffer.parent[buffer.offset + offset + 3] << 24 >>> 0);
  }

  return val;
}

Buffer.prototype.readUInt32LE = function(offset, noAssert) {
  return readUInt32(this, offset, false, noAssert);
};

Buffer.prototype.readUInt32BE = function(offset, noAssert) {
  return readUInt32(this, offset, true, noAssert);
};


/*
 * Signed integer types, yay team! A reminder on how two's complement actually
 * works. The first bit is the signed bit, i.e. tells us whether or not the
 * number should be positive or negative. If the two's complement value is
 * positive, then we're done, as it's equivalent to the unsigned representation.
 *
 * Now if the number is positive, you're pretty much done, you can just leverage
 * the unsigned translations and return those. Unfortunately, negative numbers
 * aren't quite that straightforward.
 *
 * At first glance, one might be inclined to use the traditional formula to
 * translate binary numbers between the positive and negative values in two's
 * complement. (Though it doesn't quite work for the most negative value)
 * Mainly:
 *  - invert all the bits
 *  - add one to the result
 *
 * Of course, this doesn't quite work in Javascript. Take for example the value
 * of -128. This could be represented in 16 bits (big-endian) as 0xff80. But of
 * course, Javascript will do the following:
 *
 * > ~0xff80
 * -65409
 *
 * Whoh there, Javascript, that's not quite right. But wait, according to
 * Javascript that's perfectly correct. When Javascript ends up seeing the
 * constant 0xff80, it has no notion that it is actually a signed number. It
 * assumes that we've input the unsigned value 0xff80. Thus, when it does the
 * binary negation, it casts it into a signed value, (positive 0xff80). Then
 * when you perform binary negation on that, it turns it into a negative number.
 *
 * Instead, we're going to have to use the following general formula, that works
 * in a rather Javascript friendly way. I'm glad we don't support this kind of
 * weird numbering scheme in the kernel.
 *
 * (BIT-MAX - (unsigned)val + 1) * -1
 *
 * The astute observer, may think that this doesn't make sense for 8-bit numbers
 * (really it isn't necessary for them). However, when you get 16-bit numbers,
 * you do. Let's go back to our prior example and see how this will look:
 *
 * (0xffff - 0xff80 + 1) * -1
 * (0x007f + 1) * -1
 * (0x0080) * -1
 */
Buffer.prototype.readInt8 = function(offset, noAssert) {
  var buffer = this;
  var neg;

  if (!noAssert) {
    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset < buffer.length,
        'Trying to read beyond buffer length');
  }

  if (offset >= buffer.length) return;

  neg = buffer.parent[buffer.offset + offset] & 0x80;
  if (!neg) {
    return (buffer.parent[buffer.offset + offset]);
  }

  return ((0xff - buffer.parent[buffer.offset + offset] + 1) * -1);
};

function readInt16(buffer, offset, isBigEndian, noAssert) {
  var neg, val;

  if (!noAssert) {
    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 1 < buffer.length,
        'Trying to read beyond buffer length');
  }

  val = readUInt16(buffer, offset, isBigEndian, noAssert);
  neg = val & 0x8000;
  if (!neg) {
    return val;
  }

  return (0xffff - val + 1) * -1;
}

Buffer.prototype.readInt16LE = function(offset, noAssert) {
  return readInt16(this, offset, false, noAssert);
};

Buffer.prototype.readInt16BE = function(offset, noAssert) {
  return readInt16(this, offset, true, noAssert);
};

function readInt32(buffer, offset, isBigEndian, noAssert) {
  var neg, val;

  if (!noAssert) {
    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 3 < buffer.length,
        'Trying to read beyond buffer length');
  }

  val = readUInt32(buffer, offset, isBigEndian, noAssert);
  neg = val & 0x80000000;
  if (!neg) {
    return (val);
  }

  return (0xffffffff - val + 1) * -1;
}

Buffer.prototype.readInt32LE = function(offset, noAssert) {
  return readInt32(this, offset, false, noAssert);
};

Buffer.prototype.readInt32BE = function(offset, noAssert) {
  return readInt32(this, offset, true, noAssert);
};

function readFloat(buffer, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset + 3 < buffer.length,
        'Trying to read beyond buffer length');
  }

  return require('./buffer_ieee754').readIEEE754(buffer, offset, isBigEndian,
      23, 4);
}

Buffer.prototype.readFloatLE = function(offset, noAssert) {
  return readFloat(this, offset, false, noAssert);
};

Buffer.prototype.readFloatBE = function(offset, noAssert) {
  return readFloat(this, offset, true, noAssert);
};

function readDouble(buffer, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset + 7 < buffer.length,
        'Trying to read beyond buffer length');
  }

  return require('./buffer_ieee754').readIEEE754(buffer, offset, isBigEndian,
      52, 8);
}

Buffer.prototype.readDoubleLE = function(offset, noAssert) {
  return readDouble(this, offset, false, noAssert);
};

Buffer.prototype.readDoubleBE = function(offset, noAssert) {
  return readDouble(this, offset, true, noAssert);
};


/*
 * We have to make sure that the value is a valid integer. This means that it is
 * non-negative. It has no fractional component and that it does not exceed the
 * maximum allowed value.
 *
 *      value           The number to check for validity
 *
 *      max             The maximum value
 */
function verifuint(value, max) {
  assert.ok(typeof (value) == 'number',
      'cannot write a non-number as a number');

  assert.ok(value >= 0,
      'specified a negative value for writing an unsigned value');

  assert.ok(value <= max, 'value is larger than maximum value for type');

  assert.ok(Math.floor(value) === value, 'value has a fractional component');
}

Buffer.prototype.writeUInt8 = function(value, offset, noAssert) {
  var buffer = this;

  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset < buffer.length,
        'trying to write beyond buffer length');

    verifuint(value, 0xff);
  }

  if (offset < buffer.length) {
    buffer.parent[buffer.offset + offset] = value;
  }
};

function writeUInt16(buffer, value, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 1 < buffer.length,
        'trying to write beyond buffer length');

    verifuint(value, 0xffff);
  }

  for (var i = 0; i < Math.min(buffer.length - offset, 2); i++) {
    buffer.parent[buffer.offset + offset + i] =
        (value & (0xff << (8 * (isBigEndian ? 1 - i : i)))) >>>
            (isBigEndian ? 1 - i : i) * 8;
  }

}

Buffer.prototype.writeUInt16LE = function(value, offset, noAssert) {
  writeUInt16(this, value, offset, false, noAssert);
};

Buffer.prototype.writeUInt16BE = function(value, offset, noAssert) {
  writeUInt16(this, value, offset, true, noAssert);
};

function writeUInt32(buffer, value, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 3 < buffer.length,
        'trying to write beyond buffer length');

    verifuint(value, 0xffffffff);
  }

  for (var i = 0; i < Math.min(buffer.length - offset, 4); i++) {
    buffer.parent[buffer.offset + offset + i] =
        (value >>> (isBigEndian ? 3 - i : i) * 8) & 0xff;
  }
}

Buffer.prototype.writeUInt32LE = function(value, offset, noAssert) {
  writeUInt32(this, value, offset, false, noAssert);
};

Buffer.prototype.writeUInt32BE = function(value, offset, noAssert) {
  writeUInt32(this, value, offset, true, noAssert);
};


/*
 * We now move onto our friends in the signed number category. Unlike unsigned
 * numbers, we're going to have to worry a bit more about how we put values into
 * arrays. Since we are only worrying about signed 32-bit values, we're in
 * slightly better shape. Unfortunately, we really can't do our favorite binary
 * & in this system. It really seems to do the wrong thing. For example:
 *
 * > -32 & 0xff
 * 224
 *
 * What's happening above is really: 0xe0 & 0xff = 0xe0. However, the results of
 * this aren't treated as a signed number. Ultimately a bad thing.
 *
 * What we're going to want to do is basically create the unsigned equivalent of
 * our representation and pass that off to the wuint* functions. To do that
 * we're going to do the following:
 *
 *  - if the value is positive
 *      we can pass it directly off to the equivalent wuint
 *  - if the value is negative
 *      we do the following computation:
 *         mb + val + 1, where
 *         mb   is the maximum unsigned value in that byte size
 *         val  is the Javascript negative integer
 *
 *
 * As a concrete value, take -128. In signed 16 bits this would be 0xff80. If
 * you do out the computations:
 *
 * 0xffff - 128 + 1
 * 0xffff - 127
 * 0xff80
 *
 * You can then encode this value as the signed version. This is really rather
 * hacky, but it should work and get the job done which is our goal here.
 */

/*
 * A series of checks to make sure we actually have a signed 32-bit number
 */
function verifsint(value, max, min) {
  assert.ok(typeof (value) == 'number',
      'cannot write a non-number as a number');

  assert.ok(value <= max, 'value larger than maximum allowed value');

  assert.ok(value >= min, 'value smaller than minimum allowed value');

  assert.ok(Math.floor(value) === value, 'value has a fractional component');
}

function verifIEEE754(value, max, min) {
  assert.ok(typeof (value) == 'number',
      'cannot write a non-number as a number');

  assert.ok(value <= max, 'value larger than maximum allowed value');

  assert.ok(value >= min, 'value smaller than minimum allowed value');
}

Buffer.prototype.writeInt8 = function(value, offset, noAssert) {
  var buffer = this;

  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset < buffer.length,
        'Trying to write beyond buffer length');

    verifsint(value, 0x7f, -0x80);
  }

  if (value >= 0) {
    buffer.writeUInt8(value, offset, noAssert);
  } else {
    buffer.writeUInt8(0xff + value + 1, offset, noAssert);
  }
};

function writeInt16(buffer, value, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 1 < buffer.length,
        'Trying to write beyond buffer length');

    verifsint(value, 0x7fff, -0x8000);
  }

  if (value >= 0) {
    writeUInt16(buffer, value, offset, isBigEndian, noAssert);
  } else {
    writeUInt16(buffer, 0xffff + value + 1, offset, isBigEndian, noAssert);
  }
}

Buffer.prototype.writeInt16LE = function(value, offset, noAssert) {
  writeInt16(this, value, offset, false, noAssert);
};

Buffer.prototype.writeInt16BE = function(value, offset, noAssert) {
  writeInt16(this, value, offset, true, noAssert);
};

function writeInt32(buffer, value, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 3 < buffer.length,
        'Trying to write beyond buffer length');

    verifsint(value, 0x7fffffff, -0x80000000);
  }

  if (value >= 0) {
    writeUInt32(buffer, value, offset, isBigEndian, noAssert);
  } else {
    writeUInt32(buffer, 0xffffffff + value + 1, offset, isBigEndian, noAssert);
  }
}

Buffer.prototype.writeInt32LE = function(value, offset, noAssert) {
  writeInt32(this, value, offset, false, noAssert);
};

Buffer.prototype.writeInt32BE = function(value, offset, noAssert) {
  writeInt32(this, value, offset, true, noAssert);
};

function writeFloat(buffer, value, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 3 < buffer.length,
        'Trying to write beyond buffer length');

    verifIEEE754(value, 3.4028234663852886e+38, -3.4028234663852886e+38);
  }

  require('./buffer_ieee754').writeIEEE754(buffer, value, offset, isBigEndian,
      23, 4);
}

Buffer.prototype.writeFloatLE = function(value, offset, noAssert) {
  writeFloat(this, value, offset, false, noAssert);
};

Buffer.prototype.writeFloatBE = function(value, offset, noAssert) {
  writeFloat(this, value, offset, true, noAssert);
};

function writeDouble(buffer, value, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 7 < buffer.length,
        'Trying to write beyond buffer length');

    verifIEEE754(value, 1.7976931348623157E+308, -1.7976931348623157E+308);
  }

  require('./buffer_ieee754').writeIEEE754(buffer, value, offset, isBigEndian,
      52, 8);
}

Buffer.prototype.writeDoubleLE = function(value, offset, noAssert) {
  writeDouble(this, value, offset, false, noAssert);
};

Buffer.prototype.writeDoubleBE = function(value, offset, noAssert) {
  writeDouble(this, value, offset, true, noAssert);
};

SlowBuffer.prototype.readUInt8 = Buffer.prototype.readUInt8;
SlowBuffer.prototype.readUInt16LE = Buffer.prototype.readUInt16LE;
SlowBuffer.prototype.readUInt16BE = Buffer.prototype.readUInt16BE;
SlowBuffer.prototype.readUInt32LE = Buffer.prototype.readUInt32LE;
SlowBuffer.prototype.readUInt32BE = Buffer.prototype.readUInt32BE;
SlowBuffer.prototype.readInt8 = Buffer.prototype.readInt8;
SlowBuffer.prototype.readInt16LE = Buffer.prototype.readInt16LE;
SlowBuffer.prototype.readInt16BE = Buffer.prototype.readInt16BE;
SlowBuffer.prototype.readInt32LE = Buffer.prototype.readInt32LE;
SlowBuffer.prototype.readInt32BE = Buffer.prototype.readInt32BE;
SlowBuffer.prototype.readFloatLE = Buffer.prototype.readFloatLE;
SlowBuffer.prototype.readFloatBE = Buffer.prototype.readFloatBE;
SlowBuffer.prototype.readDoubleLE = Buffer.prototype.readDoubleLE;
SlowBuffer.prototype.readDoubleBE = Buffer.prototype.readDoubleBE;
SlowBuffer.prototype.writeUInt8 = Buffer.prototype.writeUInt8;
SlowBuffer.prototype.writeUInt16LE = Buffer.prototype.writeUInt16LE;
SlowBuffer.prototype.writeUInt16BE = Buffer.prototype.writeUInt16BE;
SlowBuffer.prototype.writeUInt32LE = Buffer.prototype.writeUInt32LE;
SlowBuffer.prototype.writeUInt32BE = Buffer.prototype.writeUInt32BE;
SlowBuffer.prototype.writeInt8 = Buffer.prototype.writeInt8;
SlowBuffer.prototype.writeInt16LE = Buffer.prototype.writeInt16LE;
SlowBuffer.prototype.writeInt16BE = Buffer.prototype.writeInt16BE;
SlowBuffer.prototype.writeInt32LE = Buffer.prototype.writeInt32LE;
SlowBuffer.prototype.writeInt32BE = Buffer.prototype.writeInt32BE;
SlowBuffer.prototype.writeFloatLE = Buffer.prototype.writeFloatLE;
SlowBuffer.prototype.writeFloatBE = Buffer.prototype.writeFloatBE;
SlowBuffer.prototype.writeDoubleLE = Buffer.prototype.writeDoubleLE;
SlowBuffer.prototype.writeDoubleBE = Buffer.prototype.writeDoubleBE;

})()
},{"assert":2,"./buffer_ieee754":1,"base64-js":5}],3:[function(require,module,exports){
var events = require('events');

exports.isArray = isArray;
exports.isDate = function(obj){return Object.prototype.toString.call(obj) === '[object Date]'};
exports.isRegExp = function(obj){return Object.prototype.toString.call(obj) === '[object RegExp]'};


exports.print = function () {};
exports.puts = function () {};
exports.debug = function() {};

exports.inspect = function(obj, showHidden, depth, colors) {
  var seen = [];

  var stylize = function(str, styleType) {
    // http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
    var styles =
        { 'bold' : [1, 22],
          'italic' : [3, 23],
          'underline' : [4, 24],
          'inverse' : [7, 27],
          'white' : [37, 39],
          'grey' : [90, 39],
          'black' : [30, 39],
          'blue' : [34, 39],
          'cyan' : [36, 39],
          'green' : [32, 39],
          'magenta' : [35, 39],
          'red' : [31, 39],
          'yellow' : [33, 39] };

    var style =
        { 'special': 'cyan',
          'number': 'blue',
          'boolean': 'yellow',
          'undefined': 'grey',
          'null': 'bold',
          'string': 'green',
          'date': 'magenta',
          // "name": intentionally not styling
          'regexp': 'red' }[styleType];

    if (style) {
      return '\033[' + styles[style][0] + 'm' + str +
             '\033[' + styles[style][1] + 'm';
    } else {
      return str;
    }
  };
  if (! colors) {
    stylize = function(str, styleType) { return str; };
  }

  function format(value, recurseTimes) {
    // Provide a hook for user-specified inspect functions.
    // Check that value is an object with an inspect function on it
    if (value && typeof value.inspect === 'function' &&
        // Filter out the util module, it's inspect function is special
        value !== exports &&
        // Also filter out any prototype objects using the circular check.
        !(value.constructor && value.constructor.prototype === value)) {
      return value.inspect(recurseTimes);
    }

    // Primitive types cannot have properties
    switch (typeof value) {
      case 'undefined':
        return stylize('undefined', 'undefined');

      case 'string':
        var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                                 .replace(/'/g, "\\'")
                                                 .replace(/\\"/g, '"') + '\'';
        return stylize(simple, 'string');

      case 'number':
        return stylize('' + value, 'number');

      case 'boolean':
        return stylize('' + value, 'boolean');
    }
    // For some reason typeof null is "object", so special case here.
    if (value === null) {
      return stylize('null', 'null');
    }

    // Look up the keys of the object.
    var visible_keys = Object_keys(value);
    var keys = showHidden ? Object_getOwnPropertyNames(value) : visible_keys;

    // Functions without properties can be shortcutted.
    if (typeof value === 'function' && keys.length === 0) {
      if (isRegExp(value)) {
        return stylize('' + value, 'regexp');
      } else {
        var name = value.name ? ': ' + value.name : '';
        return stylize('[Function' + name + ']', 'special');
      }
    }

    // Dates without properties can be shortcutted
    if (isDate(value) && keys.length === 0) {
      return stylize(value.toUTCString(), 'date');
    }

    var base, type, braces;
    // Determine the object type
    if (isArray(value)) {
      type = 'Array';
      braces = ['[', ']'];
    } else {
      type = 'Object';
      braces = ['{', '}'];
    }

    // Make functions say that they are functions
    if (typeof value === 'function') {
      var n = value.name ? ': ' + value.name : '';
      base = (isRegExp(value)) ? ' ' + value : ' [Function' + n + ']';
    } else {
      base = '';
    }

    // Make dates with properties first say the date
    if (isDate(value)) {
      base = ' ' + value.toUTCString();
    }

    if (keys.length === 0) {
      return braces[0] + base + braces[1];
    }

    if (recurseTimes < 0) {
      if (isRegExp(value)) {
        return stylize('' + value, 'regexp');
      } else {
        return stylize('[Object]', 'special');
      }
    }

    seen.push(value);

    var output = keys.map(function(key) {
      var name, str;
      if (value.__lookupGetter__) {
        if (value.__lookupGetter__(key)) {
          if (value.__lookupSetter__(key)) {
            str = stylize('[Getter/Setter]', 'special');
          } else {
            str = stylize('[Getter]', 'special');
          }
        } else {
          if (value.__lookupSetter__(key)) {
            str = stylize('[Setter]', 'special');
          }
        }
      }
      if (visible_keys.indexOf(key) < 0) {
        name = '[' + key + ']';
      }
      if (!str) {
        if (seen.indexOf(value[key]) < 0) {
          if (recurseTimes === null) {
            str = format(value[key]);
          } else {
            str = format(value[key], recurseTimes - 1);
          }
          if (str.indexOf('\n') > -1) {
            if (isArray(value)) {
              str = str.split('\n').map(function(line) {
                return '  ' + line;
              }).join('\n').substr(2);
            } else {
              str = '\n' + str.split('\n').map(function(line) {
                return '   ' + line;
              }).join('\n');
            }
          }
        } else {
          str = stylize('[Circular]', 'special');
        }
      }
      if (typeof name === 'undefined') {
        if (type === 'Array' && key.match(/^\d+$/)) {
          return str;
        }
        name = JSON.stringify('' + key);
        if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
          name = name.substr(1, name.length - 2);
          name = stylize(name, 'name');
        } else {
          name = name.replace(/'/g, "\\'")
                     .replace(/\\"/g, '"')
                     .replace(/(^"|"$)/g, "'");
          name = stylize(name, 'string');
        }
      }

      return name + ': ' + str;
    });

    seen.pop();

    var numLinesEst = 0;
    var length = output.reduce(function(prev, cur) {
      numLinesEst++;
      if (cur.indexOf('\n') >= 0) numLinesEst++;
      return prev + cur.length + 1;
    }, 0);

    if (length > 50) {
      output = braces[0] +
               (base === '' ? '' : base + '\n ') +
               ' ' +
               output.join(',\n  ') +
               ' ' +
               braces[1];

    } else {
      output = braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
    }

    return output;
  }
  return format(obj, (typeof depth === 'undefined' ? 2 : depth));
};


function isArray(ar) {
  return ar instanceof Array ||
         Array.isArray(ar) ||
         (ar && ar !== Object.prototype && isArray(ar.__proto__));
}


function isRegExp(re) {
  return re instanceof RegExp ||
    (typeof re === 'object' && Object.prototype.toString.call(re) === '[object RegExp]');
}


function isDate(d) {
  if (d instanceof Date) return true;
  if (typeof d !== 'object') return false;
  var properties = Date.prototype && Object_getOwnPropertyNames(Date.prototype);
  var proto = d.__proto__ && Object_getOwnPropertyNames(d.__proto__);
  return JSON.stringify(proto) === JSON.stringify(properties);
}

function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}

var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}

exports.log = function (msg) {};

exports.pump = null;

var Object_keys = Object.keys || function (obj) {
    var res = [];
    for (var key in obj) res.push(key);
    return res;
};

var Object_getOwnPropertyNames = Object.getOwnPropertyNames || function (obj) {
    var res = [];
    for (var key in obj) {
        if (Object.hasOwnProperty.call(obj, key)) res.push(key);
    }
    return res;
};

var Object_create = Object.create || function (prototype, properties) {
    // from es5-shim
    var object;
    if (prototype === null) {
        object = { '__proto__' : null };
    }
    else {
        if (typeof prototype !== 'object') {
            throw new TypeError(
                'typeof prototype[' + (typeof prototype) + '] != \'object\''
            );
        }
        var Type = function () {};
        Type.prototype = prototype;
        object = new Type();
        object.__proto__ = prototype;
    }
    if (typeof properties !== 'undefined' && Object.defineProperties) {
        Object.defineProperties(object, properties);
    }
    return object;
};

exports.inherits = function(ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = Object_create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
};

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (typeof f !== 'string') {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(exports.inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j': return JSON.stringify(args[i++]);
      default:
        return x;
    }
  });
  for(var x = args[i]; i < len; x = args[++i]){
    if (x === null || typeof x !== 'object') {
      str += ' ' + x;
    } else {
      str += ' ' + exports.inspect(x);
    }
  }
  return str;
};

},{"events":6}],5:[function(require,module,exports){
(function (exports) {
	'use strict';

	var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

	function b64ToByteArray(b64) {
		var i, j, l, tmp, placeHolders, arr;
	
		if (b64.length % 4 > 0) {
			throw 'Invalid string. Length must be a multiple of 4';
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		placeHolders = b64.indexOf('=');
		placeHolders = placeHolders > 0 ? b64.length - placeHolders : 0;

		// base64 is 4/3 + up to two characters of the original data
		arr = [];//new Uint8Array(b64.length * 3 / 4 - placeHolders);

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length;

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (lookup.indexOf(b64[i]) << 18) | (lookup.indexOf(b64[i + 1]) << 12) | (lookup.indexOf(b64[i + 2]) << 6) | lookup.indexOf(b64[i + 3]);
			arr.push((tmp & 0xFF0000) >> 16);
			arr.push((tmp & 0xFF00) >> 8);
			arr.push(tmp & 0xFF);
		}

		if (placeHolders === 2) {
			tmp = (lookup.indexOf(b64[i]) << 2) | (lookup.indexOf(b64[i + 1]) >> 4);
			arr.push(tmp & 0xFF);
		} else if (placeHolders === 1) {
			tmp = (lookup.indexOf(b64[i]) << 10) | (lookup.indexOf(b64[i + 1]) << 4) | (lookup.indexOf(b64[i + 2]) >> 2);
			arr.push((tmp >> 8) & 0xFF);
			arr.push(tmp & 0xFF);
		}

		return arr;
	}

	function uint8ToBase64(uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length;

		function tripletToBase64 (num) {
			return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F];
		};

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2]);
			output += tripletToBase64(temp);
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1];
				output += lookup[temp >> 2];
				output += lookup[(temp << 4) & 0x3F];
				output += '==';
				break;
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1]);
				output += lookup[temp >> 10];
				output += lookup[(temp >> 4) & 0x3F];
				output += lookup[(temp << 2) & 0x3F];
				output += '=';
				break;
		}

		return output;
	}

	module.exports.toByteArray = b64ToByteArray;
	module.exports.fromByteArray = uint8ToBase64;
}());

},{}],7:[function(require,module,exports){
exports.readIEEE754 = function(buffer, offset, isBE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isBE ? 0 : (nBytes - 1),
      d = isBE ? 1 : -1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.writeIEEE754 = function(buffer, value, offset, isBE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isBE ? (nBytes - 1) : 0,
      d = isBE ? -1 : 1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

},{}],8:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            if (ev.source === window && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],6:[function(require,module,exports){
(function(process){if (!process.EventEmitter) process.EventEmitter = function () {};

var EventEmitter = exports.EventEmitter = process.EventEmitter;
var isArray = typeof Array.isArray === 'function'
    ? Array.isArray
    : function (xs) {
        return Object.prototype.toString.call(xs) === '[object Array]'
    }
;
function indexOf (xs, x) {
    if (xs.indexOf) return xs.indexOf(x);
    for (var i = 0; i < xs.length; i++) {
        if (x === xs[i]) return i;
    }
    return -1;
}

// By default EventEmitters will print a warning if more than
// 10 listeners are added to it. This is a useful default which
// helps finding memory leaks.
//
// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
var defaultMaxListeners = 10;
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!this._events) this._events = {};
  this._events.maxListeners = n;
};


EventEmitter.prototype.emit = function(type) {
  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events || !this._events.error ||
        (isArray(this._events.error) && !this._events.error.length))
    {
      if (arguments[1] instanceof Error) {
        throw arguments[1]; // Unhandled 'error' event
      } else {
        throw new Error("Uncaught, unspecified 'error' event.");
      }
      return false;
    }
  }

  if (!this._events) return false;
  var handler = this._events[type];
  if (!handler) return false;

  if (typeof handler == 'function') {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        var args = Array.prototype.slice.call(arguments, 1);
        handler.apply(this, args);
    }
    return true;

  } else if (isArray(handler)) {
    var args = Array.prototype.slice.call(arguments, 1);

    var listeners = handler.slice();
    for (var i = 0, l = listeners.length; i < l; i++) {
      listeners[i].apply(this, args);
    }
    return true;

  } else {
    return false;
  }
};

// EventEmitter is defined in src/node_events.cc
// EventEmitter.prototype.emit() is also defined there.
EventEmitter.prototype.addListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('addListener only takes instances of Function');
  }

  if (!this._events) this._events = {};

  // To avoid recursion in the case that type == "newListeners"! Before
  // adding it to the listeners, first emit "newListeners".
  this.emit('newListener', type, listener);

  if (!this._events[type]) {
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  } else if (isArray(this._events[type])) {

    // Check for listener leak
    if (!this._events[type].warned) {
      var m;
      if (this._events.maxListeners !== undefined) {
        m = this._events.maxListeners;
      } else {
        m = defaultMaxListeners;
      }

      if (m && m > 0 && this._events[type].length > m) {
        this._events[type].warned = true;
        console.error('(node) warning: possible EventEmitter memory ' +
                      'leak detected. %d listeners added. ' +
                      'Use emitter.setMaxListeners() to increase limit.',
                      this._events[type].length);
        console.trace();
      }
    }

    // If we've already got an array, just append.
    this._events[type].push(listener);
  } else {
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  var self = this;
  self.on(type, function g() {
    self.removeListener(type, g);
    listener.apply(this, arguments);
  });

  return this;
};

EventEmitter.prototype.removeListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('removeListener only takes instances of Function');
  }

  // does not use listeners(), so no side effect of creating _events[type]
  if (!this._events || !this._events[type]) return this;

  var list = this._events[type];

  if (isArray(list)) {
    var i = indexOf(list, listener);
    if (i < 0) return this;
    list.splice(i, 1);
    if (list.length == 0)
      delete this._events[type];
  } else if (this._events[type] === listener) {
    delete this._events[type];
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  if (arguments.length === 0) {
    this._events = {};
    return this;
  }

  // does not use listeners(), so no side effect of creating _events[type]
  if (type && this._events && this._events[type]) this._events[type] = null;
  return this;
};

EventEmitter.prototype.listeners = function(type) {
  if (!this._events) this._events = {};
  if (!this._events[type]) this._events[type] = [];
  if (!isArray(this._events[type])) {
    this._events[type] = [this._events[type]];
  }
  return this._events[type];
};

})(require("__browserify_process"))
},{"__browserify_process":8}],4:[function(require,module,exports){
(function(){function SlowBuffer (size) {
    this.length = size;
};

var assert = require('assert');

exports.INSPECT_MAX_BYTES = 50;


function toHex(n) {
  if (n < 16) return '0' + n.toString(16);
  return n.toString(16);
}

function utf8ToBytes(str) {
  var byteArray = [];
  for (var i = 0; i < str.length; i++)
    if (str.charCodeAt(i) <= 0x7F)
      byteArray.push(str.charCodeAt(i));
    else {
      var h = encodeURIComponent(str.charAt(i)).substr(1).split('%');
      for (var j = 0; j < h.length; j++)
        byteArray.push(parseInt(h[j], 16));
    }

  return byteArray;
}

function asciiToBytes(str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++ )
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push( str.charCodeAt(i) & 0xFF );

  return byteArray;
}

function base64ToBytes(str) {
  return require("base64-js").toByteArray(str);
}

SlowBuffer.byteLength = function (str, encoding) {
  switch (encoding || "utf8") {
    case 'hex':
      return str.length / 2;

    case 'utf8':
    case 'utf-8':
      return utf8ToBytes(str).length;

    case 'ascii':
      return str.length;

    case 'base64':
      return base64ToBytes(str).length;

    default:
      throw new Error('Unknown encoding');
  }
};

function blitBuffer(src, dst, offset, length) {
  var pos, i = 0;
  while (i < length) {
    if ((i+offset >= dst.length) || (i >= src.length))
      break;

    dst[i + offset] = src[i];
    i++;
  }
  return i;
}

SlowBuffer.prototype.utf8Write = function (string, offset, length) {
  var bytes, pos;
  return SlowBuffer._charsWritten =  blitBuffer(utf8ToBytes(string), this, offset, length);
};

SlowBuffer.prototype.asciiWrite = function (string, offset, length) {
  var bytes, pos;
  return SlowBuffer._charsWritten =  blitBuffer(asciiToBytes(string), this, offset, length);
};

SlowBuffer.prototype.base64Write = function (string, offset, length) {
  var bytes, pos;
  return SlowBuffer._charsWritten = blitBuffer(base64ToBytes(string), this, offset, length);
};

SlowBuffer.prototype.base64Slice = function (start, end) {
  var bytes = Array.prototype.slice.apply(this, arguments)
  return require("base64-js").fromByteArray(bytes);
}

function decodeUtf8Char(str) {
  try {
    return decodeURIComponent(str);
  } catch (err) {
    return String.fromCharCode(0xFFFD); // UTF 8 invalid char
  }
}

SlowBuffer.prototype.utf8Slice = function () {
  var bytes = Array.prototype.slice.apply(this, arguments);
  var res = "";
  var tmp = "";
  var i = 0;
  while (i < bytes.length) {
    if (bytes[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(bytes[i]);
      tmp = "";
    } else
      tmp += "%" + bytes[i].toString(16);

    i++;
  }

  return res + decodeUtf8Char(tmp);
}

SlowBuffer.prototype.asciiSlice = function () {
  var bytes = Array.prototype.slice.apply(this, arguments);
  var ret = "";
  for (var i = 0; i < bytes.length; i++)
    ret += String.fromCharCode(bytes[i]);
  return ret;
}

SlowBuffer.prototype.inspect = function() {
  var out = [],
      len = this.length;
  for (var i = 0; i < len; i++) {
    out[i] = toHex(this[i]);
    if (i == exports.INSPECT_MAX_BYTES) {
      out[i + 1] = '...';
      break;
    }
  }
  return '<SlowBuffer ' + out.join(' ') + '>';
};


SlowBuffer.prototype.hexSlice = function(start, end) {
  var len = this.length;

  if (!start || start < 0) start = 0;
  if (!end || end < 0 || end > len) end = len;

  var out = '';
  for (var i = start; i < end; i++) {
    out += toHex(this[i]);
  }
  return out;
};


SlowBuffer.prototype.toString = function(encoding, start, end) {
  encoding = String(encoding || 'utf8').toLowerCase();
  start = +start || 0;
  if (typeof end == 'undefined') end = this.length;

  // Fastpath empty strings
  if (+end == start) {
    return '';
  }

  switch (encoding) {
    case 'hex':
      return this.hexSlice(start, end);

    case 'utf8':
    case 'utf-8':
      return this.utf8Slice(start, end);

    case 'ascii':
      return this.asciiSlice(start, end);

    case 'binary':
      return this.binarySlice(start, end);

    case 'base64':
      return this.base64Slice(start, end);

    case 'ucs2':
    case 'ucs-2':
      return this.ucs2Slice(start, end);

    default:
      throw new Error('Unknown encoding');
  }
};


SlowBuffer.prototype.hexWrite = function(string, offset, length) {
  offset = +offset || 0;
  var remaining = this.length - offset;
  if (!length) {
    length = remaining;
  } else {
    length = +length;
    if (length > remaining) {
      length = remaining;
    }
  }

  // must be an even number of digits
  var strLen = string.length;
  if (strLen % 2) {
    throw new Error('Invalid hex string');
  }
  if (length > strLen / 2) {
    length = strLen / 2;
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16);
    if (isNaN(byte)) throw new Error('Invalid hex string');
    this[offset + i] = byte;
  }
  SlowBuffer._charsWritten = i * 2;
  return i;
};


SlowBuffer.prototype.write = function(string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length;
      length = undefined;
    }
  } else {  // legacy
    var swap = encoding;
    encoding = offset;
    offset = length;
    length = swap;
  }

  offset = +offset || 0;
  var remaining = this.length - offset;
  if (!length) {
    length = remaining;
  } else {
    length = +length;
    if (length > remaining) {
      length = remaining;
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase();

  switch (encoding) {
    case 'hex':
      return this.hexWrite(string, offset, length);

    case 'utf8':
    case 'utf-8':
      return this.utf8Write(string, offset, length);

    case 'ascii':
      return this.asciiWrite(string, offset, length);

    case 'binary':
      return this.binaryWrite(string, offset, length);

    case 'base64':
      return this.base64Write(string, offset, length);

    case 'ucs2':
    case 'ucs-2':
      return this.ucs2Write(string, offset, length);

    default:
      throw new Error('Unknown encoding');
  }
};


// slice(start, end)
SlowBuffer.prototype.slice = function(start, end) {
  if (end === undefined) end = this.length;

  if (end > this.length) {
    throw new Error('oob');
  }
  if (start > end) {
    throw new Error('oob');
  }

  return new Buffer(this, end - start, +start);
};

SlowBuffer.prototype.copy = function(target, targetstart, sourcestart, sourceend) {
  var temp = [];
  for (var i=sourcestart; i<sourceend; i++) {
    assert.ok(typeof this[i] !== 'undefined', "copying undefined buffer bytes!");
    temp.push(this[i]);
  }

  for (var i=targetstart; i<targetstart+temp.length; i++) {
    target[i] = temp[i-targetstart];
  }
};

function coerce(length) {
  // Coerce length to a number (possibly NaN), round up
  // in case it's fractional (e.g. 123.456) then do a
  // double negate to coerce a NaN to 0. Easy, right?
  length = ~~Math.ceil(+length);
  return length < 0 ? 0 : length;
}


// Buffer

function Buffer(subject, encoding, offset) {
  if (!(this instanceof Buffer)) {
    return new Buffer(subject, encoding, offset);
  }

  var type;

  // Are we slicing?
  if (typeof offset === 'number') {
    this.length = coerce(encoding);
    this.parent = subject;
    this.offset = offset;
  } else {
    // Find the length
    switch (type = typeof subject) {
      case 'number':
        this.length = coerce(subject);
        break;

      case 'string':
        this.length = Buffer.byteLength(subject, encoding);
        break;

      case 'object': // Assume object is an array
        this.length = coerce(subject.length);
        break;

      default:
        throw new Error('First argument needs to be a number, ' +
                        'array or string.');
    }

    if (this.length > Buffer.poolSize) {
      // Big buffer, just alloc one.
      this.parent = new SlowBuffer(this.length);
      this.offset = 0;

    } else {
      // Small buffer.
      if (!pool || pool.length - pool.used < this.length) allocPool();
      this.parent = pool;
      this.offset = pool.used;
      pool.used += this.length;
    }

    // Treat array-ish objects as a byte array.
    if (isArrayIsh(subject)) {
      for (var i = 0; i < this.length; i++) {
        this.parent[i + this.offset] = subject[i];
      }
    } else if (type == 'string') {
      // We are a string
      this.length = this.write(subject, 0, encoding);
    }
  }

}

function isArrayIsh(subject) {
  return Array.isArray(subject) || Buffer.isBuffer(subject) ||
         subject && typeof subject === 'object' &&
         typeof subject.length === 'number';
}

exports.SlowBuffer = SlowBuffer;
exports.Buffer = Buffer;

Buffer.poolSize = 8 * 1024;
var pool;

function allocPool() {
  pool = new SlowBuffer(Buffer.poolSize);
  pool.used = 0;
}


// Static methods
Buffer.isBuffer = function isBuffer(b) {
  return b instanceof Buffer || b instanceof SlowBuffer;
};

Buffer.concat = function (list, totalLength) {
  if (!Array.isArray(list)) {
    throw new Error("Usage: Buffer.concat(list, [totalLength])\n \
      list should be an Array.");
  }

  if (list.length === 0) {
    return new Buffer(0);
  } else if (list.length === 1) {
    return list[0];
  }

  if (typeof totalLength !== 'number') {
    totalLength = 0;
    for (var i = 0; i < list.length; i++) {
      var buf = list[i];
      totalLength += buf.length;
    }
  }

  var buffer = new Buffer(totalLength);
  var pos = 0;
  for (var i = 0; i < list.length; i++) {
    var buf = list[i];
    buf.copy(buffer, pos);
    pos += buf.length;
  }
  return buffer;
};

// Inspect
Buffer.prototype.inspect = function inspect() {
  var out = [],
      len = this.length;

  for (var i = 0; i < len; i++) {
    out[i] = toHex(this.parent[i + this.offset]);
    if (i == exports.INSPECT_MAX_BYTES) {
      out[i + 1] = '...';
      break;
    }
  }

  return '<Buffer ' + out.join(' ') + '>';
};


Buffer.prototype.get = function get(i) {
  if (i < 0 || i >= this.length) throw new Error('oob');
  return this.parent[this.offset + i];
};


Buffer.prototype.set = function set(i, v) {
  if (i < 0 || i >= this.length) throw new Error('oob');
  return this.parent[this.offset + i] = v;
};


// write(string, offset = 0, length = buffer.length-offset, encoding = 'utf8')
Buffer.prototype.write = function(string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length;
      length = undefined;
    }
  } else {  // legacy
    var swap = encoding;
    encoding = offset;
    offset = length;
    length = swap;
  }

  offset = +offset || 0;
  var remaining = this.length - offset;
  if (!length) {
    length = remaining;
  } else {
    length = +length;
    if (length > remaining) {
      length = remaining;
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase();

  var ret;
  switch (encoding) {
    case 'hex':
      ret = this.parent.hexWrite(string, this.offset + offset, length);
      break;

    case 'utf8':
    case 'utf-8':
      ret = this.parent.utf8Write(string, this.offset + offset, length);
      break;

    case 'ascii':
      ret = this.parent.asciiWrite(string, this.offset + offset, length);
      break;

    case 'binary':
      ret = this.parent.binaryWrite(string, this.offset + offset, length);
      break;

    case 'base64':
      // Warning: maxLength not taken into account in base64Write
      ret = this.parent.base64Write(string, this.offset + offset, length);
      break;

    case 'ucs2':
    case 'ucs-2':
      ret = this.parent.ucs2Write(string, this.offset + offset, length);
      break;

    default:
      throw new Error('Unknown encoding');
  }

  Buffer._charsWritten = SlowBuffer._charsWritten;

  return ret;
};


// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function(encoding, start, end) {
  encoding = String(encoding || 'utf8').toLowerCase();

  if (typeof start == 'undefined' || start < 0) {
    start = 0;
  } else if (start > this.length) {
    start = this.length;
  }

  if (typeof end == 'undefined' || end > this.length) {
    end = this.length;
  } else if (end < 0) {
    end = 0;
  }

  start = start + this.offset;
  end = end + this.offset;

  switch (encoding) {
    case 'hex':
      return this.parent.hexSlice(start, end);

    case 'utf8':
    case 'utf-8':
      return this.parent.utf8Slice(start, end);

    case 'ascii':
      return this.parent.asciiSlice(start, end);

    case 'binary':
      return this.parent.binarySlice(start, end);

    case 'base64':
      return this.parent.base64Slice(start, end);

    case 'ucs2':
    case 'ucs-2':
      return this.parent.ucs2Slice(start, end);

    default:
      throw new Error('Unknown encoding');
  }
};


// byteLength
Buffer.byteLength = SlowBuffer.byteLength;


// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill(value, start, end) {
  value || (value = 0);
  start || (start = 0);
  end || (end = this.length);

  if (typeof value === 'string') {
    value = value.charCodeAt(0);
  }
  if (!(typeof value === 'number') || isNaN(value)) {
    throw new Error('value is not a number');
  }

  if (end < start) throw new Error('end < start');

  // Fill 0 bytes; we're done
  if (end === start) return 0;
  if (this.length == 0) return 0;

  if (start < 0 || start >= this.length) {
    throw new Error('start out of bounds');
  }

  if (end < 0 || end > this.length) {
    throw new Error('end out of bounds');
  }

  return this.parent.fill(value,
                          start + this.offset,
                          end + this.offset);
};


// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function(target, target_start, start, end) {
  var source = this;
  start || (start = 0);
  end || (end = this.length);
  target_start || (target_start = 0);

  if (end < start) throw new Error('sourceEnd < sourceStart');

  // Copy 0 bytes; we're done
  if (end === start) return 0;
  if (target.length == 0 || source.length == 0) return 0;

  if (target_start < 0 || target_start >= target.length) {
    throw new Error('targetStart out of bounds');
  }

  if (start < 0 || start >= source.length) {
    throw new Error('sourceStart out of bounds');
  }

  if (end < 0 || end > source.length) {
    throw new Error('sourceEnd out of bounds');
  }

  // Are we oob?
  if (end > this.length) {
    end = this.length;
  }

  if (target.length - target_start < end - start) {
    end = target.length - target_start + start;
  }

  return this.parent.copy(target.parent,
                          target_start + target.offset,
                          start + this.offset,
                          end + this.offset);
};


// slice(start, end)
Buffer.prototype.slice = function(start, end) {
  if (end === undefined) end = this.length;
  if (end > this.length) throw new Error('oob');
  if (start > end) throw new Error('oob');

  return new Buffer(this.parent, end - start, +start + this.offset);
};


// Legacy methods for backwards compatibility.

Buffer.prototype.utf8Slice = function(start, end) {
  return this.toString('utf8', start, end);
};

Buffer.prototype.binarySlice = function(start, end) {
  return this.toString('binary', start, end);
};

Buffer.prototype.asciiSlice = function(start, end) {
  return this.toString('ascii', start, end);
};

Buffer.prototype.utf8Write = function(string, offset) {
  return this.write(string, offset, 'utf8');
};

Buffer.prototype.binaryWrite = function(string, offset) {
  return this.write(string, offset, 'binary');
};

Buffer.prototype.asciiWrite = function(string, offset) {
  return this.write(string, offset, 'ascii');
};

Buffer.prototype.readUInt8 = function(offset, noAssert) {
  var buffer = this;

  if (!noAssert) {
    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset < buffer.length,
        'Trying to read beyond buffer length');
  }

  return buffer.parent[buffer.offset + offset];
};

function readUInt16(buffer, offset, isBigEndian, noAssert) {
  var val = 0;


  if (!noAssert) {
    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 1 < buffer.length,
        'Trying to read beyond buffer length');
  }

  if (isBigEndian) {
    val = buffer.parent[buffer.offset + offset] << 8;
    val |= buffer.parent[buffer.offset + offset + 1];
  } else {
    val = buffer.parent[buffer.offset + offset];
    val |= buffer.parent[buffer.offset + offset + 1] << 8;
  }

  return val;
}

Buffer.prototype.readUInt16LE = function(offset, noAssert) {
  return readUInt16(this, offset, false, noAssert);
};

Buffer.prototype.readUInt16BE = function(offset, noAssert) {
  return readUInt16(this, offset, true, noAssert);
};

function readUInt32(buffer, offset, isBigEndian, noAssert) {
  var val = 0;

  if (!noAssert) {
    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 3 < buffer.length,
        'Trying to read beyond buffer length');
  }

  if (isBigEndian) {
    val = buffer.parent[buffer.offset + offset + 1] << 16;
    val |= buffer.parent[buffer.offset + offset + 2] << 8;
    val |= buffer.parent[buffer.offset + offset + 3];
    val = val + (buffer.parent[buffer.offset + offset] << 24 >>> 0);
  } else {
    val = buffer.parent[buffer.offset + offset + 2] << 16;
    val |= buffer.parent[buffer.offset + offset + 1] << 8;
    val |= buffer.parent[buffer.offset + offset];
    val = val + (buffer.parent[buffer.offset + offset + 3] << 24 >>> 0);
  }

  return val;
}

Buffer.prototype.readUInt32LE = function(offset, noAssert) {
  return readUInt32(this, offset, false, noAssert);
};

Buffer.prototype.readUInt32BE = function(offset, noAssert) {
  return readUInt32(this, offset, true, noAssert);
};


/*
 * Signed integer types, yay team! A reminder on how two's complement actually
 * works. The first bit is the signed bit, i.e. tells us whether or not the
 * number should be positive or negative. If the two's complement value is
 * positive, then we're done, as it's equivalent to the unsigned representation.
 *
 * Now if the number is positive, you're pretty much done, you can just leverage
 * the unsigned translations and return those. Unfortunately, negative numbers
 * aren't quite that straightforward.
 *
 * At first glance, one might be inclined to use the traditional formula to
 * translate binary numbers between the positive and negative values in two's
 * complement. (Though it doesn't quite work for the most negative value)
 * Mainly:
 *  - invert all the bits
 *  - add one to the result
 *
 * Of course, this doesn't quite work in Javascript. Take for example the value
 * of -128. This could be represented in 16 bits (big-endian) as 0xff80. But of
 * course, Javascript will do the following:
 *
 * > ~0xff80
 * -65409
 *
 * Whoh there, Javascript, that's not quite right. But wait, according to
 * Javascript that's perfectly correct. When Javascript ends up seeing the
 * constant 0xff80, it has no notion that it is actually a signed number. It
 * assumes that we've input the unsigned value 0xff80. Thus, when it does the
 * binary negation, it casts it into a signed value, (positive 0xff80). Then
 * when you perform binary negation on that, it turns it into a negative number.
 *
 * Instead, we're going to have to use the following general formula, that works
 * in a rather Javascript friendly way. I'm glad we don't support this kind of
 * weird numbering scheme in the kernel.
 *
 * (BIT-MAX - (unsigned)val + 1) * -1
 *
 * The astute observer, may think that this doesn't make sense for 8-bit numbers
 * (really it isn't necessary for them). However, when you get 16-bit numbers,
 * you do. Let's go back to our prior example and see how this will look:
 *
 * (0xffff - 0xff80 + 1) * -1
 * (0x007f + 1) * -1
 * (0x0080) * -1
 */
Buffer.prototype.readInt8 = function(offset, noAssert) {
  var buffer = this;
  var neg;

  if (!noAssert) {
    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset < buffer.length,
        'Trying to read beyond buffer length');
  }

  neg = buffer.parent[buffer.offset + offset] & 0x80;
  if (!neg) {
    return (buffer.parent[buffer.offset + offset]);
  }

  return ((0xff - buffer.parent[buffer.offset + offset] + 1) * -1);
};

function readInt16(buffer, offset, isBigEndian, noAssert) {
  var neg, val;

  if (!noAssert) {
    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 1 < buffer.length,
        'Trying to read beyond buffer length');
  }

  val = readUInt16(buffer, offset, isBigEndian, noAssert);
  neg = val & 0x8000;
  if (!neg) {
    return val;
  }

  return (0xffff - val + 1) * -1;
}

Buffer.prototype.readInt16LE = function(offset, noAssert) {
  return readInt16(this, offset, false, noAssert);
};

Buffer.prototype.readInt16BE = function(offset, noAssert) {
  return readInt16(this, offset, true, noAssert);
};

function readInt32(buffer, offset, isBigEndian, noAssert) {
  var neg, val;

  if (!noAssert) {
    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 3 < buffer.length,
        'Trying to read beyond buffer length');
  }

  val = readUInt32(buffer, offset, isBigEndian, noAssert);
  neg = val & 0x80000000;
  if (!neg) {
    return (val);
  }

  return (0xffffffff - val + 1) * -1;
}

Buffer.prototype.readInt32LE = function(offset, noAssert) {
  return readInt32(this, offset, false, noAssert);
};

Buffer.prototype.readInt32BE = function(offset, noAssert) {
  return readInt32(this, offset, true, noAssert);
};

function readFloat(buffer, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset + 3 < buffer.length,
        'Trying to read beyond buffer length');
  }

  return require('./buffer_ieee754').readIEEE754(buffer, offset, isBigEndian,
      23, 4);
}

Buffer.prototype.readFloatLE = function(offset, noAssert) {
  return readFloat(this, offset, false, noAssert);
};

Buffer.prototype.readFloatBE = function(offset, noAssert) {
  return readFloat(this, offset, true, noAssert);
};

function readDouble(buffer, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset + 7 < buffer.length,
        'Trying to read beyond buffer length');
  }

  return require('./buffer_ieee754').readIEEE754(buffer, offset, isBigEndian,
      52, 8);
}

Buffer.prototype.readDoubleLE = function(offset, noAssert) {
  return readDouble(this, offset, false, noAssert);
};

Buffer.prototype.readDoubleBE = function(offset, noAssert) {
  return readDouble(this, offset, true, noAssert);
};


/*
 * We have to make sure that the value is a valid integer. This means that it is
 * non-negative. It has no fractional component and that it does not exceed the
 * maximum allowed value.
 *
 *      value           The number to check for validity
 *
 *      max             The maximum value
 */
function verifuint(value, max) {
  assert.ok(typeof (value) == 'number',
      'cannot write a non-number as a number');

  assert.ok(value >= 0,
      'specified a negative value for writing an unsigned value');

  assert.ok(value <= max, 'value is larger than maximum value for type');

  assert.ok(Math.floor(value) === value, 'value has a fractional component');
}

Buffer.prototype.writeUInt8 = function(value, offset, noAssert) {
  var buffer = this;

  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset < buffer.length,
        'trying to write beyond buffer length');

    verifuint(value, 0xff);
  }

  buffer.parent[buffer.offset + offset] = value;
};

function writeUInt16(buffer, value, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 1 < buffer.length,
        'trying to write beyond buffer length');

    verifuint(value, 0xffff);
  }

  if (isBigEndian) {
    buffer.parent[buffer.offset + offset] = (value & 0xff00) >>> 8;
    buffer.parent[buffer.offset + offset + 1] = value & 0x00ff;
  } else {
    buffer.parent[buffer.offset + offset + 1] = (value & 0xff00) >>> 8;
    buffer.parent[buffer.offset + offset] = value & 0x00ff;
  }
}

Buffer.prototype.writeUInt16LE = function(value, offset, noAssert) {
  writeUInt16(this, value, offset, false, noAssert);
};

Buffer.prototype.writeUInt16BE = function(value, offset, noAssert) {
  writeUInt16(this, value, offset, true, noAssert);
};

function writeUInt32(buffer, value, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 3 < buffer.length,
        'trying to write beyond buffer length');

    verifuint(value, 0xffffffff);
  }

  if (isBigEndian) {
    buffer.parent[buffer.offset + offset] = (value >>> 24) & 0xff;
    buffer.parent[buffer.offset + offset + 1] = (value >>> 16) & 0xff;
    buffer.parent[buffer.offset + offset + 2] = (value >>> 8) & 0xff;
    buffer.parent[buffer.offset + offset + 3] = value & 0xff;
  } else {
    buffer.parent[buffer.offset + offset + 3] = (value >>> 24) & 0xff;
    buffer.parent[buffer.offset + offset + 2] = (value >>> 16) & 0xff;
    buffer.parent[buffer.offset + offset + 1] = (value >>> 8) & 0xff;
    buffer.parent[buffer.offset + offset] = value & 0xff;
  }
}

Buffer.prototype.writeUInt32LE = function(value, offset, noAssert) {
  writeUInt32(this, value, offset, false, noAssert);
};

Buffer.prototype.writeUInt32BE = function(value, offset, noAssert) {
  writeUInt32(this, value, offset, true, noAssert);
};


/*
 * We now move onto our friends in the signed number category. Unlike unsigned
 * numbers, we're going to have to worry a bit more about how we put values into
 * arrays. Since we are only worrying about signed 32-bit values, we're in
 * slightly better shape. Unfortunately, we really can't do our favorite binary
 * & in this system. It really seems to do the wrong thing. For example:
 *
 * > -32 & 0xff
 * 224
 *
 * What's happening above is really: 0xe0 & 0xff = 0xe0. However, the results of
 * this aren't treated as a signed number. Ultimately a bad thing.
 *
 * What we're going to want to do is basically create the unsigned equivalent of
 * our representation and pass that off to the wuint* functions. To do that
 * we're going to do the following:
 *
 *  - if the value is positive
 *      we can pass it directly off to the equivalent wuint
 *  - if the value is negative
 *      we do the following computation:
 *         mb + val + 1, where
 *         mb   is the maximum unsigned value in that byte size
 *         val  is the Javascript negative integer
 *
 *
 * As a concrete value, take -128. In signed 16 bits this would be 0xff80. If
 * you do out the computations:
 *
 * 0xffff - 128 + 1
 * 0xffff - 127
 * 0xff80
 *
 * You can then encode this value as the signed version. This is really rather
 * hacky, but it should work and get the job done which is our goal here.
 */

/*
 * A series of checks to make sure we actually have a signed 32-bit number
 */
function verifsint(value, max, min) {
  assert.ok(typeof (value) == 'number',
      'cannot write a non-number as a number');

  assert.ok(value <= max, 'value larger than maximum allowed value');

  assert.ok(value >= min, 'value smaller than minimum allowed value');

  assert.ok(Math.floor(value) === value, 'value has a fractional component');
}

function verifIEEE754(value, max, min) {
  assert.ok(typeof (value) == 'number',
      'cannot write a non-number as a number');

  assert.ok(value <= max, 'value larger than maximum allowed value');

  assert.ok(value >= min, 'value smaller than minimum allowed value');
}

Buffer.prototype.writeInt8 = function(value, offset, noAssert) {
  var buffer = this;

  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset < buffer.length,
        'Trying to write beyond buffer length');

    verifsint(value, 0x7f, -0x80);
  }

  if (value >= 0) {
    buffer.writeUInt8(value, offset, noAssert);
  } else {
    buffer.writeUInt8(0xff + value + 1, offset, noAssert);
  }
};

function writeInt16(buffer, value, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 1 < buffer.length,
        'Trying to write beyond buffer length');

    verifsint(value, 0x7fff, -0x8000);
  }

  if (value >= 0) {
    writeUInt16(buffer, value, offset, isBigEndian, noAssert);
  } else {
    writeUInt16(buffer, 0xffff + value + 1, offset, isBigEndian, noAssert);
  }
}

Buffer.prototype.writeInt16LE = function(value, offset, noAssert) {
  writeInt16(this, value, offset, false, noAssert);
};

Buffer.prototype.writeInt16BE = function(value, offset, noAssert) {
  writeInt16(this, value, offset, true, noAssert);
};

function writeInt32(buffer, value, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 3 < buffer.length,
        'Trying to write beyond buffer length');

    verifsint(value, 0x7fffffff, -0x80000000);
  }

  if (value >= 0) {
    writeUInt32(buffer, value, offset, isBigEndian, noAssert);
  } else {
    writeUInt32(buffer, 0xffffffff + value + 1, offset, isBigEndian, noAssert);
  }
}

Buffer.prototype.writeInt32LE = function(value, offset, noAssert) {
  writeInt32(this, value, offset, false, noAssert);
};

Buffer.prototype.writeInt32BE = function(value, offset, noAssert) {
  writeInt32(this, value, offset, true, noAssert);
};

function writeFloat(buffer, value, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 3 < buffer.length,
        'Trying to write beyond buffer length');

    verifIEEE754(value, 3.4028234663852886e+38, -3.4028234663852886e+38);
  }

  require('./buffer_ieee754').writeIEEE754(buffer, value, offset, isBigEndian,
      23, 4);
}

Buffer.prototype.writeFloatLE = function(value, offset, noAssert) {
  writeFloat(this, value, offset, false, noAssert);
};

Buffer.prototype.writeFloatBE = function(value, offset, noAssert) {
  writeFloat(this, value, offset, true, noAssert);
};

function writeDouble(buffer, value, offset, isBigEndian, noAssert) {
  if (!noAssert) {
    assert.ok(value !== undefined && value !== null,
        'missing value');

    assert.ok(typeof (isBigEndian) === 'boolean',
        'missing or invalid endian');

    assert.ok(offset !== undefined && offset !== null,
        'missing offset');

    assert.ok(offset + 7 < buffer.length,
        'Trying to write beyond buffer length');

    verifIEEE754(value, 1.7976931348623157E+308, -1.7976931348623157E+308);
  }

  require('./buffer_ieee754').writeIEEE754(buffer, value, offset, isBigEndian,
      52, 8);
}

Buffer.prototype.writeDoubleLE = function(value, offset, noAssert) {
  writeDouble(this, value, offset, false, noAssert);
};

Buffer.prototype.writeDoubleBE = function(value, offset, noAssert) {
  writeDouble(this, value, offset, true, noAssert);
};

SlowBuffer.prototype.readUInt8 = Buffer.prototype.readUInt8;
SlowBuffer.prototype.readUInt16LE = Buffer.prototype.readUInt16LE;
SlowBuffer.prototype.readUInt16BE = Buffer.prototype.readUInt16BE;
SlowBuffer.prototype.readUInt32LE = Buffer.prototype.readUInt32LE;
SlowBuffer.prototype.readUInt32BE = Buffer.prototype.readUInt32BE;
SlowBuffer.prototype.readInt8 = Buffer.prototype.readInt8;
SlowBuffer.prototype.readInt16LE = Buffer.prototype.readInt16LE;
SlowBuffer.prototype.readInt16BE = Buffer.prototype.readInt16BE;
SlowBuffer.prototype.readInt32LE = Buffer.prototype.readInt32LE;
SlowBuffer.prototype.readInt32BE = Buffer.prototype.readInt32BE;
SlowBuffer.prototype.readFloatLE = Buffer.prototype.readFloatLE;
SlowBuffer.prototype.readFloatBE = Buffer.prototype.readFloatBE;
SlowBuffer.prototype.readDoubleLE = Buffer.prototype.readDoubleLE;
SlowBuffer.prototype.readDoubleBE = Buffer.prototype.readDoubleBE;
SlowBuffer.prototype.writeUInt8 = Buffer.prototype.writeUInt8;
SlowBuffer.prototype.writeUInt16LE = Buffer.prototype.writeUInt16LE;
SlowBuffer.prototype.writeUInt16BE = Buffer.prototype.writeUInt16BE;
SlowBuffer.prototype.writeUInt32LE = Buffer.prototype.writeUInt32LE;
SlowBuffer.prototype.writeUInt32BE = Buffer.prototype.writeUInt32BE;
SlowBuffer.prototype.writeInt8 = Buffer.prototype.writeInt8;
SlowBuffer.prototype.writeInt16LE = Buffer.prototype.writeInt16LE;
SlowBuffer.prototype.writeInt16BE = Buffer.prototype.writeInt16BE;
SlowBuffer.prototype.writeInt32LE = Buffer.prototype.writeInt32LE;
SlowBuffer.prototype.writeInt32BE = Buffer.prototype.writeInt32BE;
SlowBuffer.prototype.writeFloatLE = Buffer.prototype.writeFloatLE;
SlowBuffer.prototype.writeFloatBE = Buffer.prototype.writeFloatBE;
SlowBuffer.prototype.writeDoubleLE = Buffer.prototype.writeDoubleLE;
SlowBuffer.prototype.writeDoubleBE = Buffer.prototype.writeDoubleBE;

})()
},{"assert":2,"./buffer_ieee754":7,"base64-js":9}],9:[function(require,module,exports){
(function (exports) {
	'use strict';

	var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

	function b64ToByteArray(b64) {
		var i, j, l, tmp, placeHolders, arr;
	
		if (b64.length % 4 > 0) {
			throw 'Invalid string. Length must be a multiple of 4';
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		placeHolders = b64.indexOf('=');
		placeHolders = placeHolders > 0 ? b64.length - placeHolders : 0;

		// base64 is 4/3 + up to two characters of the original data
		arr = [];//new Uint8Array(b64.length * 3 / 4 - placeHolders);

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length;

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (lookup.indexOf(b64[i]) << 18) | (lookup.indexOf(b64[i + 1]) << 12) | (lookup.indexOf(b64[i + 2]) << 6) | lookup.indexOf(b64[i + 3]);
			arr.push((tmp & 0xFF0000) >> 16);
			arr.push((tmp & 0xFF00) >> 8);
			arr.push(tmp & 0xFF);
		}

		if (placeHolders === 2) {
			tmp = (lookup.indexOf(b64[i]) << 2) | (lookup.indexOf(b64[i + 1]) >> 4);
			arr.push(tmp & 0xFF);
		} else if (placeHolders === 1) {
			tmp = (lookup.indexOf(b64[i]) << 10) | (lookup.indexOf(b64[i + 1]) << 4) | (lookup.indexOf(b64[i + 2]) >> 2);
			arr.push((tmp >> 8) & 0xFF);
			arr.push(tmp & 0xFF);
		}

		return arr;
	}

	function uint8ToBase64(uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length;

		function tripletToBase64 (num) {
			return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F];
		};

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2]);
			output += tripletToBase64(temp);
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1];
				output += lookup[temp >> 2];
				output += lookup[(temp << 4) & 0x3F];
				output += '==';
				break;
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1]);
				output += lookup[temp >> 10];
				output += lookup[(temp >> 4) & 0x3F];
				output += lookup[(temp << 2) & 0x3F];
				output += '=';
				break;
		}

		return output;
	}

	module.exports.toByteArray = b64ToByteArray;
	module.exports.fromByteArray = uint8ToBase64;
}());

},{}]},{},[])
;;module.exports=require("buffer-browserify")

},{}],14:[function(require,module,exports){
(function(Buffer){var encode = module.exports = function (xs) {
    function bytes (s) {
        if (typeof s === 'string') {
            return s.split('').map(ord);
        }
        else if (Array.isArray(s)) {
            return s.reduce(function (acc, c) {
                return acc.concat(bytes(c));
            }, []);
        }
    }
    
    return new Buffer([ 0x1b ].concat(bytes(xs)));
};

var ord = encode.ord = function ord (c) {
    return c.charCodeAt(0)
};

})(require("__browserify_buffer").Buffer)
},{"__browserify_buffer":15}]},{},[3])
//@ sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlcyI6WyIvVXNlcnMvdGhsb3JlbnovZGV2L2pzL3Byb2plY3RzL2h5cGVybmFsL3Rlcm0uanMiLCIvVXNlcnMvdGhsb3JlbnovZGV2L2pzL3Byb2plY3RzL2h5cGVybmFsL2V4YW1wbGUvbWFpbi5qcyIsIi9Vc2Vycy90aGxvcmVuei9kZXYvanMvcHJvamVjdHMvaHlwZXJuYWwvaW5kZXguanMiLCIvVXNlcnMvdGhsb3JlbnovZGV2L2pzL3Byb2plY3RzL2h5cGVybmFsL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9pbnNlcnQtbW9kdWxlLWdsb2JhbHMvbm9kZV9tb2R1bGVzL3Byb2Nlc3MvYnJvd3Nlci5qcyIsIi9Vc2Vycy90aGxvcmVuei9kZXYvanMvcHJvamVjdHMvaHlwZXJuYWwvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcmVzb2x2ZS9idWlsdGluL2V2ZW50cy5qcyIsIi9Vc2Vycy90aGxvcmVuei9kZXYvanMvcHJvamVjdHMvaHlwZXJuYWwvbm9kZV9tb2R1bGVzL3Rocm91Z2gvaW5kZXguanMiLCIvVXNlcnMvdGhsb3JlbnovZGV2L2pzL3Byb2plY3RzL2h5cGVybmFsL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXJlc29sdmUvYnVpbHRpbi9zdHJlYW0uanMiLCIvVXNlcnMvdGhsb3JlbnovZGV2L2pzL3Byb2plY3RzL2h5cGVybmFsL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXJlc29sdmUvYnVpbHRpbi91dGlsLmpzIiwiL1VzZXJzL3RobG9yZW56L2Rldi9qcy9wcm9qZWN0cy9oeXBlcm5hbC9ub2RlX21vZHVsZXMvZGlmZmxldC9pbmRleC5qcyIsIi9Vc2Vycy90aGxvcmVuei9kZXYvanMvcHJvamVjdHMvaHlwZXJuYWwvbm9kZV9tb2R1bGVzL2RpZmZsZXQvbm9kZV9tb2R1bGVzL3RyYXZlcnNlL2luZGV4LmpzIiwiL1VzZXJzL3RobG9yZW56L2Rldi9qcy9wcm9qZWN0cy9oeXBlcm5hbC9ub2RlX21vZHVsZXMvZGlmZmxldC9ub2RlX21vZHVsZXMvZGVlcC1lcXVhbC9pbmRleC5qcyIsIi9Vc2Vycy90aGxvcmVuei9kZXYvanMvcHJvamVjdHMvaHlwZXJuYWwvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcmVzb2x2ZS9idWlsdGluL3R0eS5qcyIsIi9Vc2Vycy90aGxvcmVuei9kZXYvanMvcHJvamVjdHMvaHlwZXJuYWwvbm9kZV9tb2R1bGVzL2RpZmZsZXQvbm9kZV9tb2R1bGVzL2NoYXJtL2luZGV4LmpzIiwiL1VzZXJzL3RobG9yZW56L2Rldi9qcy9wcm9qZWN0cy9oeXBlcm5hbC9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvaW5zZXJ0LW1vZHVsZS1nbG9iYWxzL2J1ZmZlci5qcyIsIi9Vc2Vycy90aGxvcmVuei9kZXYvanMvcHJvamVjdHMvaHlwZXJuYWwvbm9kZV9tb2R1bGVzL2RpZmZsZXQvbm9kZV9tb2R1bGVzL2NoYXJtL2xpYi9lbmNvZGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdnRIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0NBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwRkE7QUFDQTtBQUNBOztBQ0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3Z4SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbigpey8qKlxuKiBTdGF0ZXNcbiovXG52YXIgbm9ybWFsID0gMCxcbiAgICBlc2NhcGVkID0gMSxcbiAgICBjc2kgPSAyLFxuICAgIG9zYyA9IDMsXG4gICAgY2hhcnNldCA9IDQsXG4gICAgZGNzID0gNSxcbiAgICBpZ25vcmUgPSA2O1xuXG4vKipcbiogVGVybWluYWxcbiovXG5cbnZhciBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKVxuICAgIC5FdmVudEVtaXR0ZXI7XG5cbm1vZHVsZS5leHBvcnRzID0gVGVybWluYWw7XG5cbmZ1bmN0aW9uIFRlcm1pbmFsKGNvbHMsIHJvd3MsIG9wdHMpIHtcbiAgICBpZiAoISh0aGlzIGluc3RhbmNlb2YgVGVybWluYWwpKSByZXR1cm4gbmV3IFRlcm1pbmFsKGNvbHMsIHJvd3MsIGhhbmRsZXIpO1xuICAgIEV2ZW50RW1pdHRlci5jYWxsKHRoaXMpO1xuXG4gICAgdGhpcy5fb3B0aW9ucyA9IG9wdHMgfHwge307XG5cbiAgICB0aGlzLmNvbHMgPSBjb2xzIHx8IFRlcm1pbmFsLmdlb21ldHJ5WzBdO1xuICAgIHRoaXMucm93cyA9IHJvd3MgfHwgVGVybWluYWwuZ2VvbWV0cnlbMV07XG5cbiAgICBpZiAodGhpcy5fb3B0aW9ucy5oYW5kbGVyKSB7XG4gICAgICAgIHRoaXMub24oJ2RhdGEnLCBoYW5kbGVyKTtcbiAgICB9XG5cbiAgICB0aGlzLnliYXNlID0gMDtcbiAgICB0aGlzLnlkaXNwID0gMDtcbiAgICB0aGlzLnggPSAwO1xuICAgIHRoaXMueSA9IDA7XG4gICAgdGhpcy5jdXJzb3JTdGF0ZSA9IDA7XG4gICAgdGhpcy5jdXJzb3JIaWRkZW4gPSBmYWxzZTtcbiAgICB0aGlzLmNvbnZlcnRFb2wgPSBmYWxzZTtcbiAgICB0aGlzLnN0YXRlID0gMDtcbiAgICB0aGlzLnF1ZXVlID0gJyc7XG4gICAgdGhpcy5zY3JvbGxUb3AgPSAwO1xuICAgIHRoaXMuc2Nyb2xsQm90dG9tID0gdGhpcy5yb3dzIC0gMTtcblxuICAgIC8vIG1vZGVzXG4gICAgdGhpcy5hcHBsaWNhdGlvbktleXBhZCA9IGZhbHNlO1xuICAgIHRoaXMub3JpZ2luTW9kZSA9IGZhbHNlO1xuICAgIHRoaXMuaW5zZXJ0TW9kZSA9IGZhbHNlO1xuICAgIHRoaXMud3JhcGFyb3VuZE1vZGUgPSBmYWxzZTtcbiAgICB0aGlzLm5vcm1hbCA9IG51bGw7XG5cbiAgICAvLyBjaGFyc2V0XG4gICAgdGhpcy5jaGFyc2V0ID0gbnVsbDtcbiAgICB0aGlzLmdjaGFyc2V0ID0gbnVsbDtcbiAgICB0aGlzLmdsZXZlbCA9IDA7XG4gICAgdGhpcy5jaGFyc2V0cyA9IFtudWxsXTtcblxuICAgIC8vIG1vdXNlIHByb3BlcnRpZXNcbiAgICB0aGlzLmRlY0xvY2F0b3I7XG4gICAgdGhpcy54MTBNb3VzZTtcbiAgICB0aGlzLnZ0MjAwTW91c2U7XG4gICAgdGhpcy52dDMwME1vdXNlO1xuICAgIHRoaXMubm9ybWFsTW91c2U7XG4gICAgdGhpcy5tb3VzZUV2ZW50cztcbiAgICB0aGlzLnNlbmRGb2N1cztcbiAgICB0aGlzLnV0Zk1vdXNlO1xuICAgIHRoaXMuc2dyTW91c2U7XG4gICAgdGhpcy51cnh2dE1vdXNlO1xuXG4gICAgLy8gbWlzY1xuICAgIHRoaXMuZWxlbWVudDtcbiAgICB0aGlzLmNoaWxkcmVuO1xuICAgIHRoaXMucmVmcmVzaFN0YXJ0O1xuICAgIHRoaXMucmVmcmVzaEVuZDtcbiAgICB0aGlzLnNhdmVkWDtcbiAgICB0aGlzLnNhdmVkWTtcbiAgICB0aGlzLnNhdmVkQ29scztcblxuICAgIC8vIHN0cmVhbVxuICAgIHRoaXMucmVhZGFibGUgPSB0cnVlO1xuICAgIHRoaXMud3JpdGFibGUgPSB0cnVlO1xuXG4gICAgdGhpcy5kZWZBdHRyID0gKDI1NyA8PCA5KSB8IDI1NjtcbiAgICB0aGlzLmN1ckF0dHIgPSB0aGlzLmRlZkF0dHI7XG5cbiAgICB0aGlzLnBhcmFtcyA9IFtdO1xuICAgIHRoaXMuY3VycmVudFBhcmFtID0gMDtcbiAgICB0aGlzLnByZWZpeCA9ICcnO1xuICAgIHRoaXMucG9zdGZpeCA9ICcnO1xuXG4gICAgdGhpcy5saW5lcyA9IFtdO1xuICAgIHZhciBpID0gdGhpcy5yb3dzO1xuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgdGhpcy5saW5lcy5wdXNoKHRoaXMuYmxhbmtMaW5lKCkpO1xuICAgIH1cblxuICAgIHRoaXMudGFicztcbiAgICB0aGlzLnNldHVwU3RvcHMoKTtcblxuICAgIHRoaXMudGFic3BhY2UgPSB0aGlzLl9vcHRpb25zLnRhYnNwYWNlIHx8ICcgICc7XG59XG5cbmluaGVyaXRzKFRlcm1pbmFsLCBFdmVudEVtaXR0ZXIpO1xuXG4vKipcbiogQ29sb3JzXG4qL1xuXG4vLyBDb2xvcnMgMC0xNVxuVGVybWluYWwuY29sb3JzID0gW1xuLy8gZGFyazpcbicjMmUzNDM2JywgJyNjYzAwMDAnLCAnIzRlOWEwNicsICcjYzRhMDAwJywgJyMzNDY1YTQnLCAnIzc1NTA3YicsICcjMDY5ODlhJywgJyNkM2Q3Y2YnLFxuLy8gYnJpZ2h0OlxuJyM1NTU3NTMnLCAnI2VmMjkyOScsICcjOGFlMjM0JywgJyNmY2U5NGYnLCAnIzcyOWZjZicsICcjYWQ3ZmE4JywgJyMzNGUyZTInLCAnI2VlZWVlYyddO1xuXG4vLyBDb2xvcnMgMTYtMjU1XG4vLyBNdWNoIHRoYW5rcyB0byBUb29UYWxsTmF0ZSBmb3Igd3JpdGluZyB0aGlzLlxuVGVybWluYWwuY29sb3JzID0gKGZ1bmN0aW9uKCkge1xuICAgIHZhciBjb2xvcnMgPSBUZXJtaW5hbC5jb2xvcnMsXG4gICAgICAgIHIgPSBbMHgwMCwgMHg1ZiwgMHg4NywgMHhhZiwgMHhkNywgMHhmZl0sXG4gICAgICAgIGk7XG5cbiAgICAvLyAxNi0yMzFcbiAgICBpID0gMDtcbiAgICBmb3IgKDsgaSA8IDIxNjsgaSsrKSB7XG4gICAgICAgIG91dChyWyhpIC8gMzYpICUgNiB8IDBdLCByWyhpIC8gNikgJSA2IHwgMF0sIHJbaSAlIDZdKTtcbiAgICB9XG5cbiAgICAvLyAyMzItMjU1IChncmV5KVxuICAgIGkgPSAwO1xuICAgIGZvciAoOyBpIDwgMjQ7IGkrKykge1xuICAgICAgICByID0gOCArIGkgKiAxMDtcbiAgICAgICAgb3V0KHIsIHIsIHIpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG91dChyLCBnLCBiKSB7XG4gICAgICAgIGNvbG9ycy5wdXNoKCcjJyArIGhleChyKSArIGhleChnKSArIGhleChiKSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaGV4KGMpIHtcbiAgICAgICAgYyA9IGMudG9TdHJpbmcoMTYpO1xuICAgICAgICByZXR1cm4gYy5sZW5ndGggPCAyID8gJzAnICsgYyA6IGM7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbG9ycztcbn0pKCk7XG5cbi8vIERlZmF1bHQgQkcvRkdcblRlcm1pbmFsLmRlZmF1bHRDb2xvcnMgPSB7XG4gICAgYmc6ICcjMDAwMDAwJyxcbiAgICBmZzogJyNmMGYwZjAnXG59O1xuXG5UZXJtaW5hbC5jb2xvcnNbMjU2XSA9IFRlcm1pbmFsLmRlZmF1bHRDb2xvcnMuYmc7XG5UZXJtaW5hbC5jb2xvcnNbMjU3XSA9IFRlcm1pbmFsLmRlZmF1bHRDb2xvcnMuZmc7XG5cbi8qKlxuKiBPcHRpb25zXG4qL1xuXG5UZXJtaW5hbC50ZXJtTmFtZSA9ICd4dGVybSc7XG5UZXJtaW5hbC5nZW9tZXRyeSA9IFs4MCwgMjRdO1xuVGVybWluYWwuY3Vyc29yQmxpbmsgPSB0cnVlO1xuVGVybWluYWwudmlzdWFsQmVsbCA9IGZhbHNlO1xuVGVybWluYWwucG9wT25CZWxsID0gZmFsc2U7XG5UZXJtaW5hbC5zY3JvbGxiYWNrID0gMTAwMDtcblRlcm1pbmFsLnNjcmVlbktleXMgPSBmYWxzZTtcblRlcm1pbmFsLnByb2dyYW1GZWF0dXJlcyA9IGZhbHNlO1xuVGVybWluYWwuZGVidWcgPSBmYWxzZTtcblxuLyoqXG4qIEZvY3VzZWQgVGVybWluYWxcbiovXG5cblRlcm1pbmFsLmZvY3VzID0gbnVsbDtcblxuVGVybWluYWwucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKFRlcm1pbmFsLmZvY3VzID09PSB0aGlzKSByZXR1cm47XG4gICAgaWYgKFRlcm1pbmFsLmZvY3VzKSB7XG4gICAgICAgIFRlcm1pbmFsLmZvY3VzLmN1cnNvclN0YXRlID0gMDtcbiAgICAgICAgVGVybWluYWwuZm9jdXMucmVmcmVzaChUZXJtaW5hbC5mb2N1cy55LCBUZXJtaW5hbC5mb2N1cy55KTtcbiAgICAgICAgaWYgKFRlcm1pbmFsLmZvY3VzLnNlbmRGb2N1cykgVGVybWluYWwuZm9jdXMuc2VuZCgnXFx4MWJbTycpO1xuICAgIH1cbiAgICBUZXJtaW5hbC5mb2N1cyA9IHRoaXM7XG4gICAgaWYgKHRoaXMuc2VuZEZvY3VzKSB0aGlzLnNlbmQoJ1xceDFiW0knKTtcbiAgICB0aGlzLnNob3dDdXJzb3IoKTtcbn07XG5cbi8qKlxuKiBHbG9iYWwgRXZlbnRzIGZvciBrZXkgaGFuZGxpbmdcbiovXG5cblRlcm1pbmFsLmJpbmRLZXlzID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKFRlcm1pbmFsLmZvY3VzKSByZXR1cm47XG5cbiAgICAvLyBXZSBjb3VsZCBwdXQgYW4gXCJpZiAoVGVybWluYWwuZm9jdXMpXCIgY2hlY2tcbiAgICAvLyBoZXJlLCBidXQgaXQgc2hvdWxkbid0IGJlIG5lY2Vzc2FyeS5cbiAgICBvbihkb2N1bWVudCwgJ2tleWRvd24nLCBmdW5jdGlvbihldikge1xuICAgICAgICByZXR1cm4gVGVybWluYWwuZm9jdXMua2V5RG93bihldik7XG4gICAgfSwgdHJ1ZSk7XG5cbiAgICBvbihkb2N1bWVudCwgJ2tleXByZXNzJywgZnVuY3Rpb24oZXYpIHtcbiAgICAgICAgcmV0dXJuIFRlcm1pbmFsLmZvY3VzLmtleVByZXNzKGV2KTtcbiAgICB9LCB0cnVlKTtcbn07XG5cbi8qKlxuKiBPcGVuIFRlcm1pbmFsXG4qL1xuXG5UZXJtaW5hbC5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgaSA9IDAsXG4gICAgICAgIGRpdjtcblxuICAgIHRoaXMuZWxlbWVudCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgIHRoaXMuZWxlbWVudC5jbGFzc05hbWUgPSAndGVybWluYWwnO1xuICAgIHRoaXMuY2hpbGRyZW4gPSBbXTtcblxuICAgIGZvciAoOyBpIDwgdGhpcy5yb3dzOyBpKyspIHtcbiAgICAgICAgZGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgICAgIHRoaXMuZWxlbWVudC5hcHBlbmRDaGlsZChkaXYpO1xuICAgICAgICB0aGlzLmNoaWxkcmVuLnB1c2goZGl2KTtcbiAgICB9XG5cbiAgICAvL2RvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQodGhpcy5lbGVtZW50KTtcblxuICAgIHRoaXMucmVmcmVzaCgwLCB0aGlzLnJvd3MgLSAxKTtcblxuICAgIC8vVGVybWluYWwuYmluZEtleXMoKTtcbiAgICB0aGlzLmZvY3VzKCk7XG5cbiAgICB0aGlzLnN0YXJ0QmxpbmsoKTtcblxuICAgIG9uKHRoaXMuZWxlbWVudCwgJ21vdXNlZG93bicsIGZ1bmN0aW9uKCkge1xuICAgICAgICBzZWxmLmZvY3VzKCk7XG4gICAgfSk7XG5cbiAgICAvLyBUaGlzIHByb2JhYmx5IHNob3VsZG4ndCB3b3JrLFxuICAgIC8vIC4uLiBidXQgaXQgZG9lcy4gRmlyZWZveCdzIHBhc3RlXG4gICAgLy8gZXZlbnQgc2VlbXMgdG8gb25seSB3b3JrIGZvciB0ZXh0YXJlYXM/XG4gICAgb24odGhpcy5lbGVtZW50LCAnbW91c2Vkb3duJywgZnVuY3Rpb24oZXYpIHtcbiAgICAgICAgdmFyIGJ1dHRvbiA9IGV2LmJ1dHRvbiAhPSBudWxsID8gK2V2LmJ1dHRvbiA6IGV2LndoaWNoICE9IG51bGwgPyBldi53aGljaCAtIDEgOiBudWxsO1xuXG4gICAgICAgIC8vIERvZXMgSUU5IGRvIHRoaXM/XG4gICAgICAgIGlmICh+bmF2aWdhdG9yLnVzZXJBZ2VudC5pbmRleE9mKCdNU0lFJykpIHtcbiAgICAgICAgICAgIGJ1dHRvbiA9IGJ1dHRvbiA9PT0gMSA/IDAgOiBidXR0b24gPT09IDQgPyAxIDogYnV0dG9uO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGJ1dHRvbiAhPT0gMikgcmV0dXJuO1xuXG4gICAgICAgIHNlbGYuZWxlbWVudC5jb250ZW50RWRpdGFibGUgPSAndHJ1ZSc7XG4gICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBzZWxmLmVsZW1lbnQuY29udGVudEVkaXRhYmxlID0gJ2luaGVyaXQnOyAvLyAnZmFsc2UnO1xuICAgICAgICB9LCAxKTtcbiAgICB9LCB0cnVlKTtcblxuICAgIG9uKHRoaXMuZWxlbWVudCwgJ3Bhc3RlJywgZnVuY3Rpb24oZXYpIHtcbiAgICAgICAgaWYgKGV2LmNsaXBib2FyZERhdGEpIHtcbiAgICAgICAgICAgIHNlbGYuc2VuZChldi5jbGlwYm9hcmREYXRhLmdldERhdGEoJ3RleHQvcGxhaW4nKSk7XG4gICAgICAgIH0gZWxzZSBpZiAod2luZG93LmNsaXBib2FyZERhdGEpIHtcbiAgICAgICAgICAgIHNlbGYuc2VuZCh3aW5kb3cuY2xpcGJvYXJkRGF0YS5nZXREYXRhKCdUZXh0JykpO1xuICAgICAgICB9XG4gICAgICAgIC8vIE5vdCBuZWNlc3NhcnkuIERvIGl0IGFueXdheSBmb3IgZ29vZCBtZWFzdXJlLlxuICAgICAgICBzZWxmLmVsZW1lbnQuY29udGVudEVkaXRhYmxlID0gJ2luaGVyaXQnO1xuICAgICAgICByZXR1cm4gY2FuY2VsKGV2KTtcbiAgICB9KTtcblxuICAgIHRoaXMuYmluZE1vdXNlKCk7XG5cbiAgICAvLyBYWFggLSBoYWNrLCBtb3ZlIHRoaXMgc29tZXdoZXJlIGVsc2UuXG4gICAgaWYgKFRlcm1pbmFsLmJyb2tlbkJvbGQgPT0gbnVsbCkge1xuICAgICAgICBUZXJtaW5hbC5icm9rZW5Cb2xkID0gaXNCb2xkQnJva2VuKCk7XG4gICAgfVxuXG4gICAgLy8gc3luYyBkZWZhdWx0IGJnL2ZnIGNvbG9yc1xuICAgIHRoaXMuZWxlbWVudC5zdHlsZS5iYWNrZ3JvdW5kQ29sb3IgPSBUZXJtaW5hbC5kZWZhdWx0Q29sb3JzLmJnO1xuICAgIHRoaXMuZWxlbWVudC5zdHlsZS5jb2xvciA9IFRlcm1pbmFsLmRlZmF1bHRDb2xvcnMuZmc7XG5cbiAgICAvL3RoaXMuZW1pdCgnb3BlbicpO1xufTtcblxuLy8gWFRlcm0gbW91c2UgZXZlbnRzXG4vLyBodHRwOi8vaW52aXNpYmxlLWlzbGFuZC5uZXQveHRlcm0vY3Rsc2Vxcy9jdGxzZXFzLmh0bWwjTW91c2UlMjBUcmFja2luZ1xuLy8gVG8gYmV0dGVyIHVuZGVyc3RhbmQgdGhlc2Vcbi8vIHRoZSB4dGVybSBjb2RlIGlzIHZlcnkgaGVscGZ1bDpcbi8vIFJlbGV2YW50IGZpbGVzOlxuLy8gYnV0dG9uLmMsIGNoYXJwcm9jLmMsIG1pc2MuY1xuLy8gUmVsZXZhbnQgZnVuY3Rpb25zIGluIHh0ZXJtL2J1dHRvbi5jOlxuLy8gQnRuQ29kZSwgRW1pdEJ1dHRvbkNvZGUsIEVkaXRvckJ1dHRvbiwgU2VuZE1vdXNlUG9zaXRpb25cblRlcm1pbmFsLnByb3RvdHlwZS5iaW5kTW91c2UgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgZWwgPSB0aGlzLmVsZW1lbnQsXG4gICAgICAgIHNlbGYgPSB0aGlzLFxuICAgICAgICBwcmVzc2VkID0gMzI7XG5cbiAgICB2YXIgd2hlZWxFdmVudCA9ICdvbm1vdXNld2hlZWwnIGluIHdpbmRvdyA/ICdtb3VzZXdoZWVsJyA6ICdET01Nb3VzZVNjcm9sbCc7XG5cbiAgICAvLyBtb3VzZXVwLCBtb3VzZWRvd24sIG1vdXNld2hlZWxcbiAgICAvLyBsZWZ0IGNsaWNrOiBeW1tNIDM8XltbTSMzPFxuICAgIC8vIG1vdXNld2hlZWwgdXA6IF5bW01gMz5cbiAgICBmdW5jdGlvbiBzZW5kQnV0dG9uKGV2KSB7XG4gICAgICAgIHZhciBidXR0b24sIHBvcztcblxuICAgICAgICAvLyBnZXQgdGhlIHh0ZXJtLXN0eWxlIGJ1dHRvblxuICAgICAgICBidXR0b24gPSBnZXRCdXR0b24oZXYpO1xuXG4gICAgICAgIC8vIGdldCBtb3VzZSBjb29yZGluYXRlc1xuICAgICAgICBwb3MgPSBnZXRDb29yZHMoZXYpO1xuICAgICAgICBpZiAoIXBvcykgcmV0dXJuO1xuXG4gICAgICAgIHNlbmRFdmVudChidXR0b24sIHBvcyk7XG5cbiAgICAgICAgc3dpdGNoIChldi50eXBlKSB7XG4gICAgICAgIGNhc2UgJ21vdXNlZG93bic6XG4gICAgICAgICAgICBwcmVzc2VkID0gYnV0dG9uO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ21vdXNldXAnOlxuICAgICAgICAgICAgLy8ga2VlcCBpdCBhdCB0aGUgbGVmdFxuICAgICAgICAgICAgLy8gYnV0dG9uLCBqdXN0IGluIGNhc2UuXG4gICAgICAgICAgICBwcmVzc2VkID0gMzI7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSB3aGVlbEV2ZW50OlxuICAgICAgICAgICAgLy8gbm90aGluZy4gZG9uJ3RcbiAgICAgICAgICAgIC8vIGludGVyZmVyZSB3aXRoXG4gICAgICAgICAgICAvLyBgcHJlc3NlZGAuXG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIG1vdGlvbiBleGFtcGxlIG9mIGEgbGVmdCBjbGljazpcbiAgICAvLyBeW1tNIDM8XltbTUA0PF5bW01ANTxeW1tNQDY8XltbTUA3PF5bW00jNzxcbiAgICBmdW5jdGlvbiBzZW5kTW92ZShldikge1xuICAgICAgICB2YXIgYnV0dG9uID0gcHJlc3NlZCxcbiAgICAgICAgICAgIHBvcztcblxuICAgICAgICBwb3MgPSBnZXRDb29yZHMoZXYpO1xuICAgICAgICBpZiAoIXBvcykgcmV0dXJuO1xuXG4gICAgICAgIC8vIGJ1dHRvbnMgbWFya2VkIGFzIG1vdGlvbnNcbiAgICAgICAgLy8gYXJlIGluY3JlbWVudGVkIGJ5IDMyXG4gICAgICAgIGJ1dHRvbiArPSAzMjtcblxuICAgICAgICBzZW5kRXZlbnQoYnV0dG9uLCBwb3MpO1xuICAgIH1cblxuICAgIC8vIGVuY29kZSBidXR0b24gYW5kXG4gICAgLy8gcG9zaXRpb24gdG8gY2hhcmFjdGVyc1xuICAgIGZ1bmN0aW9uIGVuY29kZShkYXRhLCBjaCkge1xuICAgICAgICBpZiAoIXNlbGYudXRmTW91c2UpIHtcbiAgICAgICAgICAgIGlmIChjaCA9PT0gMjU1KSByZXR1cm4gZGF0YS5wdXNoKDApO1xuICAgICAgICAgICAgaWYgKGNoID4gMTI3KSBjaCA9IDEyNztcbiAgICAgICAgICAgIGRhdGEucHVzaChjaCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAoY2ggPT09IDIwNDcpIHJldHVybiBkYXRhLnB1c2goMCk7XG4gICAgICAgICAgICBpZiAoY2ggPCAxMjcpIHtcbiAgICAgICAgICAgICAgICBkYXRhLnB1c2goY2gpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBpZiAoY2ggPiAyMDQ3KSBjaCA9IDIwNDc7XG4gICAgICAgICAgICAgICAgZGF0YS5wdXNoKDB4QzAgfCAoY2ggPj4gNikpO1xuICAgICAgICAgICAgICAgIGRhdGEucHVzaCgweDgwIHwgKGNoICYgMHgzRikpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gc2VuZCBhIG1vdXNlIGV2ZW50OlxuICAgIC8vIHJlZ3VsYXIvdXRmODogXltbTSBDYiBDeCBDeVxuICAgIC8vIHVyeHZ0OiBeW1sgQ2IgOyBDeCA7IEN5IE1cbiAgICAvLyBzZ3I6IF5bWyBDYiA7IEN4IDsgQ3kgTS9tXG4gICAgLy8gdnQzMDA6IF5bWyAyNCgxLzMvNSl+IFsgQ3ggLCBDeSBdIFxcclxuICAgIC8vIGxvY2F0b3I6IENTSSBQIGUgOyBQIGIgOyBQIHIgOyBQIGMgOyBQIHAgJiB3XG4gICAgZnVuY3Rpb24gc2VuZEV2ZW50KGJ1dHRvbiwgcG9zKSB7XG4gICAgICAgIC8vIHNlbGYuZW1pdCgnbW91c2UnLCB7XG4gICAgICAgIC8vIHg6IHBvcy54IC0gMzIsXG4gICAgICAgIC8vIHk6IHBvcy54IC0gMzIsXG4gICAgICAgIC8vIGJ1dHRvbjogYnV0dG9uXG4gICAgICAgIC8vIH0pO1xuXG4gICAgICAgIGlmIChzZWxmLnZ0MzAwTW91c2UpIHtcbiAgICAgICAgICAgIC8vIE5PVEU6IFVuc3RhYmxlLlxuICAgICAgICAgICAgLy8gaHR0cDovL3d3dy52dDEwMC5uZXQvZG9jcy92dDN4eC1ncC9jaGFwdGVyMTUuaHRtbFxuICAgICAgICAgICAgYnV0dG9uICY9IDM7XG4gICAgICAgICAgICBwb3MueCAtPSAzMjtcbiAgICAgICAgICAgIHBvcy55IC09IDMyO1xuICAgICAgICAgICAgdmFyIGRhdGEgPSAnXFx4MWJbMjQnO1xuICAgICAgICAgICAgaWYgKGJ1dHRvbiA9PT0gMCkgZGF0YSArPSAnMSc7XG4gICAgICAgICAgICBlbHNlIGlmIChidXR0b24gPT09IDEpIGRhdGEgKz0gJzMnO1xuICAgICAgICAgICAgZWxzZSBpZiAoYnV0dG9uID09PSAyKSBkYXRhICs9ICc1JztcbiAgICAgICAgICAgIGVsc2UgaWYgKGJ1dHRvbiA9PT0gMykgcmV0dXJuO1xuICAgICAgICAgICAgZWxzZSBkYXRhICs9ICcwJztcbiAgICAgICAgICAgIGRhdGEgKz0gJ35bJyArIHBvcy54ICsgJywnICsgcG9zLnkgKyAnXVxccic7XG4gICAgICAgICAgICBzZWxmLnNlbmQoZGF0YSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoc2VsZi5kZWNMb2NhdG9yKSB7XG4gICAgICAgICAgICAvLyBOT1RFOiBVbnN0YWJsZS5cbiAgICAgICAgICAgIGJ1dHRvbiAmPSAzO1xuICAgICAgICAgICAgcG9zLnggLT0gMzI7XG4gICAgICAgICAgICBwb3MueSAtPSAzMjtcbiAgICAgICAgICAgIGlmIChidXR0b24gPT09IDApIGJ1dHRvbiA9IDI7XG4gICAgICAgICAgICBlbHNlIGlmIChidXR0b24gPT09IDEpIGJ1dHRvbiA9IDQ7XG4gICAgICAgICAgICBlbHNlIGlmIChidXR0b24gPT09IDIpIGJ1dHRvbiA9IDY7XG4gICAgICAgICAgICBlbHNlIGlmIChidXR0b24gPT09IDMpIGJ1dHRvbiA9IDM7XG4gICAgICAgICAgICBzZWxmLnNlbmQoJ1xceDFiWycgKyBidXR0b24gKyAnOycgKyAoYnV0dG9uID09PSAzID8gNCA6IDApICsgJzsnICsgcG9zLnkgKyAnOycgKyBwb3MueCArICc7JyArIChwb3MucGFnZSB8fCAwKSArICcmdycpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHNlbGYudXJ4dnRNb3VzZSkge1xuICAgICAgICAgICAgcG9zLnggLT0gMzI7XG4gICAgICAgICAgICBwb3MueSAtPSAzMjtcbiAgICAgICAgICAgIHBvcy54Kys7XG4gICAgICAgICAgICBwb3MueSsrO1xuICAgICAgICAgICAgc2VsZi5zZW5kKCdcXHgxYlsnICsgYnV0dG9uICsgJzsnICsgcG9zLnggKyAnOycgKyBwb3MueSArICdNJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoc2VsZi5zZ3JNb3VzZSkge1xuICAgICAgICAgICAgcG9zLnggLT0gMzI7XG4gICAgICAgICAgICBwb3MueSAtPSAzMjtcbiAgICAgICAgICAgIHNlbGYuc2VuZCgnXFx4MWJbPCcgKyAoKGJ1dHRvbiAmIDMpID09PSAzID8gYnV0dG9uICYgfjMgOiBidXR0b24pICsgJzsnICsgcG9zLnggKyAnOycgKyBwb3MueSArICgoYnV0dG9uICYgMykgPT09IDMgPyAnbScgOiAnTScpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBkYXRhID0gW107XG5cbiAgICAgICAgZW5jb2RlKGRhdGEsIGJ1dHRvbik7XG4gICAgICAgIGVuY29kZShkYXRhLCBwb3MueCk7XG4gICAgICAgIGVuY29kZShkYXRhLCBwb3MueSk7XG5cbiAgICAgICAgc2VsZi5zZW5kKCdcXHgxYltNJyArIFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkoU3RyaW5nLCBkYXRhKSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZ2V0QnV0dG9uKGV2KSB7XG4gICAgICAgIHZhciBidXR0b24sIHNoaWZ0LCBtZXRhLCBjdHJsLCBtb2Q7XG5cbiAgICAgICAgLy8gdHdvIGxvdyBiaXRzOlxuICAgICAgICAvLyAwID0gbGVmdFxuICAgICAgICAvLyAxID0gbWlkZGxlXG4gICAgICAgIC8vIDIgPSByaWdodFxuICAgICAgICAvLyAzID0gcmVsZWFzZVxuICAgICAgICAvLyB3aGVlbCB1cC9kb3duOlxuICAgICAgICAvLyAxLCBhbmQgMiAtIHdpdGggNjQgYWRkZWRcbiAgICAgICAgc3dpdGNoIChldi50eXBlKSB7XG4gICAgICAgIGNhc2UgJ21vdXNlZG93bic6XG4gICAgICAgICAgICBidXR0b24gPSBldi5idXR0b24gIT0gbnVsbCA/ICtldi5idXR0b24gOiBldi53aGljaCAhPSBudWxsID8gZXYud2hpY2ggLSAxIDogbnVsbDtcblxuICAgICAgICAgICAgaWYgKH5uYXZpZ2F0b3IudXNlckFnZW50LmluZGV4T2YoJ01TSUUnKSkge1xuICAgICAgICAgICAgICAgIGJ1dHRvbiA9IGJ1dHRvbiA9PT0gMSA/IDAgOiBidXR0b24gPT09IDQgPyAxIDogYnV0dG9uO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ21vdXNldXAnOlxuICAgICAgICAgICAgYnV0dG9uID0gMztcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdET01Nb3VzZVNjcm9sbCc6XG4gICAgICAgICAgICBidXR0b24gPSBldi5kZXRhaWwgPCAwID8gNjQgOiA2NTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdtb3VzZXdoZWVsJzpcbiAgICAgICAgICAgIGJ1dHRvbiA9IGV2LndoZWVsRGVsdGFZID4gMCA/IDY0IDogNjU7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIG5leHQgdGhyZWUgYml0cyBhcmUgdGhlIG1vZGlmaWVyczpcbiAgICAgICAgLy8gNCA9IHNoaWZ0LCA4ID0gbWV0YSwgMTYgPSBjb250cm9sXG4gICAgICAgIHNoaWZ0ID0gZXYuc2hpZnRLZXkgPyA0IDogMDtcbiAgICAgICAgbWV0YSA9IGV2Lm1ldGFLZXkgPyA4IDogMDtcbiAgICAgICAgY3RybCA9IGV2LmN0cmxLZXkgPyAxNiA6IDA7XG4gICAgICAgIG1vZCA9IHNoaWZ0IHwgbWV0YSB8IGN0cmw7XG5cbiAgICAgICAgLy8gbm8gbW9kc1xuICAgICAgICBpZiAoc2VsZi52dDIwME1vdXNlKSB7XG4gICAgICAgICAgICAvLyBjdHJsIG9ubHlcbiAgICAgICAgICAgIG1vZCAmPSBjdHJsO1xuICAgICAgICB9IGVsc2UgaWYgKCFzZWxmLm5vcm1hbE1vdXNlKSB7XG4gICAgICAgICAgICBtb2QgPSAwO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gaW5jcmVtZW50IHRvIFNQXG4gICAgICAgIGJ1dHRvbiA9ICgzMiArIChtb2QgPDwgMikpICsgYnV0dG9uO1xuXG4gICAgICAgIHJldHVybiBidXR0b247XG4gICAgfVxuXG4gICAgLy8gbW91c2UgY29vcmRpbmF0ZXMgbWVhc3VyZWQgaW4gY29scy9yb3dzXG4gICAgZnVuY3Rpb24gZ2V0Q29vcmRzKGV2KSB7XG4gICAgICAgIHZhciB4LCB5LCB3LCBoLCBlbDtcblxuICAgICAgICAvLyBpZ25vcmUgYnJvd3NlcnMgd2l0aG91dCBwYWdlWCBmb3Igbm93XG4gICAgICAgIGlmIChldi5wYWdlWCA9PSBudWxsKSByZXR1cm47XG5cbiAgICAgICAgeCA9IGV2LnBhZ2VYO1xuICAgICAgICB5ID0gZXYucGFnZVk7XG4gICAgICAgIGVsID0gc2VsZi5lbGVtZW50O1xuXG4gICAgICAgIC8vIHNob3VsZCBwcm9iYWJseSBjaGVjayBvZmZzZXRQYXJlbnRcbiAgICAgICAgLy8gYnV0IHRoaXMgaXMgbW9yZSBwb3J0YWJsZVxuICAgICAgICB3aGlsZSAoZWwgIT09IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudCkge1xuICAgICAgICAgICAgeCAtPSBlbC5vZmZzZXRMZWZ0O1xuICAgICAgICAgICAgeSAtPSBlbC5vZmZzZXRUb3A7XG4gICAgICAgICAgICBlbCA9IGVsLnBhcmVudE5vZGU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBjb252ZXJ0IHRvIGNvbHMvcm93c1xuICAgICAgICB3ID0gc2VsZi5lbGVtZW50LmNsaWVudFdpZHRoO1xuICAgICAgICBoID0gc2VsZi5lbGVtZW50LmNsaWVudEhlaWdodDtcbiAgICAgICAgeCA9ICgoeCAvIHcpICogc2VsZi5jb2xzKSB8IDA7XG4gICAgICAgIHkgPSAoKHkgLyBoKSAqIHNlbGYucm93cykgfCAwO1xuXG4gICAgICAgIC8vIGJlIHN1cmUgdG8gYXZvaWQgc2VuZGluZ1xuICAgICAgICAvLyBiYWQgcG9zaXRpb25zIHRvIHRoZSBwcm9ncmFtXG4gICAgICAgIGlmICh4IDwgMCkgeCA9IDA7XG4gICAgICAgIGlmICh4ID4gc2VsZi5jb2xzKSB4ID0gc2VsZi5jb2xzO1xuICAgICAgICBpZiAoeSA8IDApIHkgPSAwO1xuICAgICAgICBpZiAoeSA+IHNlbGYucm93cykgeSA9IHNlbGYucm93cztcblxuICAgICAgICAvLyB4dGVybSBzZW5kcyByYXcgYnl0ZXMgYW5kXG4gICAgICAgIC8vIHN0YXJ0cyBhdCAzMiAoU1ApIGZvciBlYWNoLlxuICAgICAgICB4ICs9IDMyO1xuICAgICAgICB5ICs9IDMyO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB4OiB4LFxuICAgICAgICAgICAgeTogeSxcbiAgICAgICAgICAgIGRvd246IGV2LnR5cGUgPT09ICdtb3VzZWRvd24nLFxuICAgICAgICAgICAgdXA6IGV2LnR5cGUgPT09ICdtb3VzZXVwJyxcbiAgICAgICAgICAgIHdoZWVsOiBldi50eXBlID09PSB3aGVlbEV2ZW50LFxuICAgICAgICAgICAgbW92ZTogZXYudHlwZSA9PT0gJ21vdXNlbW92ZSdcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBvbihlbCwgJ21vdXNlZG93bicsIGZ1bmN0aW9uKGV2KSB7XG4gICAgICAgIGlmICghc2VsZi5tb3VzZUV2ZW50cykgcmV0dXJuO1xuXG4gICAgICAgIC8vIHNlbmQgdGhlIGJ1dHRvblxuICAgICAgICBzZW5kQnV0dG9uKGV2KTtcblxuICAgICAgICAvLyBlbnN1cmUgZm9jdXNcbiAgICAgICAgc2VsZi5mb2N1cygpO1xuXG4gICAgICAgIC8vIGZpeCBmb3Igb2RkIGJ1Z1xuICAgICAgICBpZiAoc2VsZi52dDIwME1vdXNlKSB7XG4gICAgICAgICAgICBzZW5kQnV0dG9uKHtcbiAgICAgICAgICAgICAgICBfX3Byb3RvX186IGV2LFxuICAgICAgICAgICAgICAgIHR5cGU6ICdtb3VzZXVwJ1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gY2FuY2VsKGV2KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGJpbmQgZXZlbnRzXG4gICAgICAgIGlmIChzZWxmLm5vcm1hbE1vdXNlKSBvbihkb2N1bWVudCwgJ21vdXNlbW92ZScsIHNlbmRNb3ZlKTtcblxuICAgICAgICAvLyB4MTAgY29tcGF0aWJpbGl0eSBtb2RlIGNhbid0IHNlbmQgYnV0dG9uIHJlbGVhc2VzXG4gICAgICAgIGlmICghc2VsZi54MTBNb3VzZSkge1xuICAgICAgICAgICAgb24oZG9jdW1lbnQsICdtb3VzZXVwJywgZnVuY3Rpb24gdXAoZXYpIHtcbiAgICAgICAgICAgICAgICBzZW5kQnV0dG9uKGV2KTtcbiAgICAgICAgICAgICAgICBpZiAoc2VsZi5ub3JtYWxNb3VzZSkgb2ZmKGRvY3VtZW50LCAnbW91c2Vtb3ZlJywgc2VuZE1vdmUpO1xuICAgICAgICAgICAgICAgIG9mZihkb2N1bWVudCwgJ21vdXNldXAnLCB1cCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNhbmNlbChldik7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjYW5jZWwoZXYpO1xuICAgIH0pO1xuXG4gICAgb24oZWwsIHdoZWVsRXZlbnQsIGZ1bmN0aW9uKGV2KSB7XG4gICAgICAgIGlmICghc2VsZi5tb3VzZUV2ZW50cykgcmV0dXJuO1xuICAgICAgICBpZiAoc2VsZi54MTBNb3VzZSB8fCBzZWxmLnZ0MzAwTW91c2UgfHwgc2VsZi5kZWNMb2NhdG9yKSByZXR1cm47XG4gICAgICAgIHNlbmRCdXR0b24oZXYpO1xuICAgICAgICByZXR1cm4gY2FuY2VsKGV2KTtcbiAgICB9KTtcblxuICAgIC8vIGFsbG93IG1vdXNld2hlZWwgc2Nyb2xsaW5nIGluXG4gICAgLy8gdGhlIHNoZWxsIGZvciBleGFtcGxlXG4gICAgb24oZWwsIHdoZWVsRXZlbnQsIGZ1bmN0aW9uKGV2KSB7XG4gICAgICAgIGlmIChzZWxmLm1vdXNlRXZlbnRzKSByZXR1cm47XG4gICAgICAgIGlmIChzZWxmLmFwcGxpY2F0aW9uS2V5cGFkKSByZXR1cm47XG4gICAgICAgIGlmIChldi50eXBlID09PSAnRE9NTW91c2VTY3JvbGwnKSB7XG4gICAgICAgICAgICBzZWxmLnNjcm9sbERpc3AoZXYuZGV0YWlsIDwgMCA/IC01IDogNSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBzZWxmLnNjcm9sbERpc3AoZXYud2hlZWxEZWx0YVkgPiAwID8gLTUgOiA1KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gY2FuY2VsKGV2KTtcbiAgICB9KTtcbn07XG5cbi8qKlxuKiBEZXN0cm95IFRlcm1pbmFsXG4qL1xuXG5UZXJtaW5hbC5wcm90b3R5cGUuZGVzdHJveSA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucmVhZGFibGUgPSBmYWxzZTtcbiAgICB0aGlzLndyaXRhYmxlID0gZmFsc2U7XG4gICAgdGhpcy5fZXZlbnRzID0ge307XG4gICAgdGhpcy5oYW5kbGVyID0gZnVuY3Rpb24oKSB7fTtcbiAgICB0aGlzLndyaXRlID0gZnVuY3Rpb24oKSB7fTtcbiAgICAvL3RoaXMuZW1pdCgnY2xvc2UnKTtcbn07XG5cbi8qKlxuKiBSZW5kZXJpbmcgRW5naW5lXG4qL1xuXG4vLyBJbiB0aGUgc2NyZWVuIGJ1ZmZlciwgZWFjaCBjaGFyYWN0ZXJcbi8vIGlzIHN0b3JlZCBhcyBhIGFuIGFycmF5IHdpdGggYSBjaGFyYWN0ZXJcbi8vIGFuZCBhIDMyLWJpdCBpbnRlZ2VyLlxuLy8gRmlyc3QgdmFsdWU6IGEgdXRmLTE2IGNoYXJhY3Rlci5cbi8vIFNlY29uZCB2YWx1ZTpcbi8vIE5leHQgOSBiaXRzOiBiYWNrZ3JvdW5kIGNvbG9yICgwLTUxMSkuXG4vLyBOZXh0IDkgYml0czogZm9yZWdyb3VuZCBjb2xvciAoMC01MTEpLlxuLy8gTmV4dCAxNCBiaXRzOiBhIG1hc2sgZm9yIG1pc2MuIGZsYWdzOlxuLy8gMT1ib2xkLCAyPXVuZGVybGluZSwgND1pbnZlcnNlXG5cblRlcm1pbmFsLnByb3RvdHlwZS5yZWZyZXNoID0gZnVuY3Rpb24oc3RhcnQsIGVuZCkge1xuICAgIHZhciB4LCB5LCBpLCBsaW5lLCBvdXQsIGNoLCB3aWR0aCwgZGF0YSwgYXR0ciwgZmdDb2xvciwgYmdDb2xvciwgZmxhZ3MsIHJvdywgcGFyZW50O1xuXG4gICAgaWYgKGVuZCAtIHN0YXJ0ID49IHRoaXMucm93cyAvIDIpIHtcbiAgICAgICAgcGFyZW50ID0gdGhpcy5lbGVtZW50LnBhcmVudE5vZGU7XG4gICAgICAgIGlmIChwYXJlbnQpIHBhcmVudC5yZW1vdmVDaGlsZCh0aGlzLmVsZW1lbnQpO1xuICAgIH1cblxuICAgIHdpZHRoID0gdGhpcy5jb2xzO1xuICAgIHkgPSBzdGFydDtcblxuICAgIC8vIGlmIChlbmQgPiB0aGlzLmxpbmVzLmxlbmd0aCkge1xuICAgIC8vIGVuZCA9IHRoaXMubGluZXMubGVuZ3RoO1xuICAgIC8vIH1cblxuICAgIGZvciAoOyB5IDw9IGVuZDsgeSsrKSB7XG4gICAgICAgIHJvdyA9IHkgKyB0aGlzLnlkaXNwO1xuXG4gICAgICAgIGxpbmUgPSB0aGlzLmxpbmVzW3Jvd107XG4gICAgICAgIG91dCA9ICcnO1xuXG4gICAgICAgIGlmICh5ID09PSB0aGlzLnkgJiYgdGhpcy5jdXJzb3JTdGF0ZSAmJiB0aGlzLnlkaXNwID09PSB0aGlzLnliYXNlICYmICF0aGlzLmN1cnNvckhpZGRlbikge1xuICAgICAgICAgICAgeCA9IHRoaXMueDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHggPSAtMTtcbiAgICAgICAgfVxuXG4gICAgICAgIGF0dHIgPSB0aGlzLmRlZkF0dHI7XG4gICAgICAgIGkgPSAwO1xuXG4gICAgICAgIGZvciAoOyBpIDwgd2lkdGg7IGkrKykge1xuICAgICAgICAgICAgZGF0YSA9IGxpbmVbaV1bMF07XG4gICAgICAgICAgICBjaCA9IGxpbmVbaV1bMV07XG5cbiAgICAgICAgICAgIGlmIChpID09PSB4KSBkYXRhID0gLTE7XG5cbiAgICAgICAgICAgIGlmIChkYXRhICE9PSBhdHRyKSB7XG4gICAgICAgICAgICAgICAgaWYgKGF0dHIgIT09IHRoaXMuZGVmQXR0cikge1xuICAgICAgICAgICAgICAgICAgICBvdXQgKz0gJzwvc3Bhbj4nO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoZGF0YSAhPT0gdGhpcy5kZWZBdHRyKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChkYXRhID09PSAtMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgb3V0ICs9ICc8c3BhbiBjbGFzcz1cInJldmVyc2UtdmlkZW9cIj4nO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgb3V0ICs9ICc8c3BhbiBzdHlsZT1cIic7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGJnQ29sb3IgPSBkYXRhICYgMHgxZmY7XG4gICAgICAgICAgICAgICAgICAgICAgICBmZ0NvbG9yID0gKGRhdGEgPj4gOSkgJiAweDFmZjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZsYWdzID0gZGF0YSA+PiAxODtcblxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZsYWdzICYgMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghVGVybWluYWwuYnJva2VuQm9sZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvdXQgKz0gJ2ZvbnQtd2VpZ2h0OmJvbGQ7JztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2VlOiBYVGVybSpib2xkQ29sb3JzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZnQ29sb3IgPCA4KSBmZ0NvbG9yICs9IDg7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmbGFncyAmIDIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvdXQgKz0gJ3RleHQtZGVjb3JhdGlvbjp1bmRlcmxpbmU7JztcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGJnQ29sb3IgIT09IDI1Nikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG91dCArPSAnYmFja2dyb3VuZC1jb2xvcjonICsgVGVybWluYWwuY29sb3JzW2JnQ29sb3JdICsgJzsnO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmdDb2xvciAhPT0gMjU3KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb3V0ICs9ICdjb2xvcjonICsgVGVybWluYWwuY29sb3JzW2ZnQ29sb3JdICsgJzsnO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICBvdXQgKz0gJ1wiPic7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHN3aXRjaCAoY2gpIHtcbiAgICAgICAgICAgIGNhc2UgJyYnOlxuICAgICAgICAgICAgICAgIG91dCArPSAnJic7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICc8JzpcbiAgICAgICAgICAgICAgICBvdXQgKz0gJzwnO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnPic6XG4gICAgICAgICAgICAgICAgb3V0ICs9ICc+JztcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgaWYgKGNoIDw9ICcgJykge1xuICAgICAgICAgICAgICAgICAgICBvdXQgKz0gJyAnO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIG91dCArPSBjaDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGF0dHIgPSBkYXRhO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGF0dHIgIT09IHRoaXMuZGVmQXR0cikge1xuICAgICAgICAgICAgb3V0ICs9ICc8L3NwYW4+JztcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuY2hpbGRyZW5beV0uaW5uZXJIVE1MID0gb3V0O1xuICAgIH1cblxuICAgIGlmIChwYXJlbnQpIHBhcmVudC5hcHBlbmRDaGlsZCh0aGlzLmVsZW1lbnQpO1xufTtcblxuVGVybWluYWwucHJvdG90eXBlLmN1cnNvckJsaW5rID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKFRlcm1pbmFsLmZvY3VzICE9PSB0aGlzKSByZXR1cm47XG4gICAgdGhpcy5jdXJzb3JTdGF0ZSBePSAxO1xuICAgIHRoaXMucmVmcmVzaCh0aGlzLnksIHRoaXMueSk7XG59O1xuXG5UZXJtaW5hbC5wcm90b3R5cGUuc2hvd0N1cnNvciA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5jdXJzb3JTdGF0ZSkge1xuICAgICAgICB0aGlzLmN1cnNvclN0YXRlID0gMTtcbiAgICAgICAgdGhpcy5yZWZyZXNoKHRoaXMueSwgdGhpcy55KTtcbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBUZW1wb3JhcmlseSBkaXNhYmxlZDpcbiAgICAgICAgLy8gdGhpcy5yZWZyZXNoQmxpbmsoKTtcbiAgICB9XG59O1xuXG5UZXJtaW5hbC5wcm90b3R5cGUuc3RhcnRCbGluayA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICghVGVybWluYWwuY3Vyc29yQmxpbmspIHJldHVybjtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdGhpcy5fYmxpbmtlciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBzZWxmLmN1cnNvckJsaW5rKCk7XG4gICAgfTtcbiAgICB0aGlzLl9ibGluayA9IHNldEludGVydmFsKHRoaXMuX2JsaW5rZXIsIDUwMCk7XG59O1xuXG5UZXJtaW5hbC5wcm90b3R5cGUucmVmcmVzaEJsaW5rID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKCFUZXJtaW5hbC5jdXJzb3JCbGluaykgcmV0dXJuO1xuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5fYmxpbmspO1xuICAgIHRoaXMuX2JsaW5rID0gc2V0SW50ZXJ2YWwodGhpcy5fYmxpbmtlciwgNTAwKTtcbn07XG5cblRlcm1pbmFsLnByb3RvdHlwZS5zY3JvbGwgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcm93O1xuXG4gICAgaWYgKCsrdGhpcy55YmFzZSA9PT0gVGVybWluYWwuc2Nyb2xsYmFjaykge1xuICAgICAgICB0aGlzLnliYXNlID0gdGhpcy55YmFzZSAvIDIgfCAwO1xuICAgICAgICB0aGlzLmxpbmVzID0gdGhpcy5saW5lcy5zbGljZSgtKHRoaXMueWJhc2UgKyB0aGlzLnJvd3MpICsgMSk7XG4gICAgfVxuXG4gICAgdGhpcy55ZGlzcCA9IHRoaXMueWJhc2U7XG5cbiAgICAvLyBsYXN0IGxpbmVcbiAgICByb3cgPSB0aGlzLnliYXNlICsgdGhpcy5yb3dzIC0gMTtcblxuICAgIC8vIHN1YnRyYWN0IHRoZSBib3R0b20gc2Nyb2xsIHJlZ2lvblxuICAgIHJvdyAtPSB0aGlzLnJvd3MgLSAxIC0gdGhpcy5zY3JvbGxCb3R0b207XG5cbiAgICBpZiAocm93ID09PSB0aGlzLmxpbmVzLmxlbmd0aCkge1xuICAgICAgICAvLyBwb3RlbnRpYWwgb3B0aW1pemF0aW9uOlxuICAgICAgICAvLyBwdXNoaW5nIGlzIGZhc3RlciB0aGFuIHNwbGljaW5nXG4gICAgICAgIC8vIHdoZW4gdGhleSBhbW91bnQgdG8gdGhlIHNhbWVcbiAgICAgICAgLy8gYmVoYXZpb3IuXG4gICAgICAgIHRoaXMubGluZXMucHVzaCh0aGlzLmJsYW5rTGluZSgpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBhZGQgb3VyIG5ldyBsaW5lXG4gICAgICAgIHRoaXMubGluZXMuc3BsaWNlKHJvdywgMCwgdGhpcy5ibGFua0xpbmUoKSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuc2Nyb2xsVG9wICE9PSAwKSB7XG4gICAgICAgIGlmICh0aGlzLnliYXNlICE9PSAwKSB7XG4gICAgICAgICAgICB0aGlzLnliYXNlLS07XG4gICAgICAgICAgICB0aGlzLnlkaXNwID0gdGhpcy55YmFzZTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmxpbmVzLnNwbGljZSh0aGlzLnliYXNlICsgdGhpcy5zY3JvbGxUb3AsIDEpO1xuICAgIH1cblxuICAgIC8vIHRoaXMubWF4UmFuZ2UoKTtcbiAgICB0aGlzLnVwZGF0ZVJhbmdlKHRoaXMuc2Nyb2xsVG9wKTtcbiAgICB0aGlzLnVwZGF0ZVJhbmdlKHRoaXMuc2Nyb2xsQm90dG9tKTtcbn07XG5cblRlcm1pbmFsLnByb3RvdHlwZS5zY3JvbGxEaXNwID0gZnVuY3Rpb24oZGlzcCkge1xuICAgIHRoaXMueWRpc3AgKz0gZGlzcDtcblxuICAgIGlmICh0aGlzLnlkaXNwID4gdGhpcy55YmFzZSkge1xuICAgICAgICB0aGlzLnlkaXNwID0gdGhpcy55YmFzZTtcbiAgICB9IGVsc2UgaWYgKHRoaXMueWRpc3AgPCAwKSB7XG4gICAgICAgIHRoaXMueWRpc3AgPSAwO1xuICAgIH1cblxuICAgIHRoaXMucmVmcmVzaCgwLCB0aGlzLnJvd3MgLSAxKTtcbn07XG5cblRlcm1pbmFsLnByb3RvdHlwZS53cml0ZSA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB2YXIgbCA9IGRhdGEubGVuZ3RoLFxuICAgICAgICBpID0gMCxcbiAgICAgICAgY3MsIGNoO1xuXG4gICAgdGhpcy5yZWZyZXNoU3RhcnQgPSB0aGlzLnk7XG4gICAgdGhpcy5yZWZyZXNoRW5kID0gdGhpcy55O1xuXG4gICAgaWYgKHRoaXMueWJhc2UgIT09IHRoaXMueWRpc3ApIHtcbiAgICAgICAgdGhpcy55ZGlzcCA9IHRoaXMueWJhc2U7XG4gICAgICAgIHRoaXMubWF4UmFuZ2UoKTtcbiAgICB9XG5cbiAgICAvLyB0aGlzLmxvZyhKU09OLnN0cmluZ2lmeShkYXRhLnJlcGxhY2UoL1xceDFiL2csICdeWycpKSk7XG5cbiAgICBmb3IgKDsgaSA8IGw7IGkrKykge1xuICAgICAgICBjaCA9IGRhdGFbaV07XG4gICAgICAgIHN3aXRjaCAodGhpcy5zdGF0ZSkge1xuICAgICAgICBjYXNlIG5vcm1hbDpcbiAgICAgICAgICAgIHN3aXRjaCAoY2gpIHtcbiAgICAgICAgICAgICAgICAvLyAnXFwwJ1xuICAgICAgICAgICAgICAgIC8vIGNhc2UgJ1xcMCc6XG4gICAgICAgICAgICAgICAgLy8gYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyAnXFxhJ1xuICAgICAgICAgICAgY2FzZSAnXFx4MDcnOlxuICAgICAgICAgICAgICAgIHRoaXMuYmVsbCgpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gJ1xcbicsICdcXHYnLCAnXFxmJ1xuICAgICAgICAgICAgY2FzZSAnXFxuJzpcbiAgICAgICAgICAgIGNhc2UgJ1xceDBiJzpcbiAgICAgICAgICAgIGNhc2UgJ1xceDBjJzpcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5jb252ZXJ0RW9sKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMueCA9IDA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRoaXMueSsrO1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLnkgPiB0aGlzLnNjcm9sbEJvdHRvbSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnktLTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5zY3JvbGwoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyAnXFxyJ1xuICAgICAgICAgICAgY2FzZSAnXFxyJzpcbiAgICAgICAgICAgICAgICB0aGlzLnggPSAwO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gJ1xcYidcbiAgICAgICAgICAgIGNhc2UgJ1xceDA4JzpcbiAgICAgICAgICAgICAgICBpZiAodGhpcy54ID4gMCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLngtLTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyAnXFx0J1xuICAgICAgICAgICAgY2FzZSAnXFx0JzpcbiAgICAgICAgICAgICAgICB0aGlzLnggPSB0aGlzLm5leHRTdG9wKCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBzaGlmdCBvdXRcbiAgICAgICAgICAgIGNhc2UgJ1xceDBlJzpcbiAgICAgICAgICAgICAgICB0aGlzLnNldGdMZXZlbCgxKTtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIHNoaWZ0IGluXG4gICAgICAgICAgICBjYXNlICdcXHgwZic6XG4gICAgICAgICAgICAgICAgdGhpcy5zZXRnTGV2ZWwoMCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyAnXFxlJ1xuICAgICAgICAgICAgY2FzZSAnXFx4MWInOlxuICAgICAgICAgICAgICAgIHRoaXMuc3RhdGUgPSBlc2NhcGVkO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIC8vICcgJ1xuICAgICAgICAgICAgICAgIGlmIChjaCA+PSAnICcpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuY2hhcnNldCAmJiB0aGlzLmNoYXJzZXRbY2hdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjaCA9IHRoaXMuY2hhcnNldFtjaF07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMueCA+PSB0aGlzLmNvbHMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMueCA9IDA7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnkrKztcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnkgPiB0aGlzLnNjcm9sbEJvdHRvbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMueS0tO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2Nyb2xsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5saW5lc1t0aGlzLnkgKyB0aGlzLnliYXNlXVt0aGlzLnhdID0gW3RoaXMuY3VyQXR0ciwgY2hdO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLngrKztcbiAgICAgICAgICAgICAgICAgICAgdGhpcy51cGRhdGVSYW5nZSh0aGlzLnkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIGVzY2FwZWQ6XG4gICAgICAgICAgICBzd2l0Y2ggKGNoKSB7XG4gICAgICAgICAgICAgICAgLy8gRVNDIFsgQ29udHJvbCBTZXF1ZW5jZSBJbnRyb2R1Y2VyICggQ1NJIGlzIDB4OWIpLlxuICAgICAgICAgICAgY2FzZSAnWyc6XG4gICAgICAgICAgICAgICAgdGhpcy5wYXJhbXMgPSBbXTtcbiAgICAgICAgICAgICAgICB0aGlzLmN1cnJlbnRQYXJhbSA9IDA7XG4gICAgICAgICAgICAgICAgdGhpcy5zdGF0ZSA9IGNzaTtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIEVTQyBdIE9wZXJhdGluZyBTeXN0ZW0gQ29tbWFuZCAoIE9TQyBpcyAweDlkKS5cbiAgICAgICAgICAgIGNhc2UgJ10nOlxuICAgICAgICAgICAgICAgIHRoaXMucGFyYW1zID0gW107XG4gICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50UGFyYW0gPSAwO1xuICAgICAgICAgICAgICAgIHRoaXMuc3RhdGUgPSBvc2M7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBFU0MgUCBEZXZpY2UgQ29udHJvbCBTdHJpbmcgKCBEQ1MgaXMgMHg5MCkuXG4gICAgICAgICAgICBjYXNlICdQJzpcbiAgICAgICAgICAgICAgICB0aGlzLnBhcmFtcyA9IFtdO1xuICAgICAgICAgICAgICAgIHRoaXMuY3VycmVudFBhcmFtID0gMDtcbiAgICAgICAgICAgICAgICB0aGlzLnN0YXRlID0gZGNzO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gRVNDIF8gQXBwbGljYXRpb24gUHJvZ3JhbSBDb21tYW5kICggQVBDIGlzIDB4OWYpLlxuICAgICAgICAgICAgY2FzZSAnXyc6XG4gICAgICAgICAgICAgICAgdGhpcy5zdGF0ZVR5cGUgPSAnYXBjJztcbiAgICAgICAgICAgICAgICB0aGlzLnN0YXRlID0gaWdub3JlO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gRVNDIF4gUHJpdmFjeSBNZXNzYWdlICggUE0gaXMgMHg5ZSkuXG4gICAgICAgICAgICBjYXNlICdeJzpcbiAgICAgICAgICAgICAgICB0aGlzLnN0YXRlVHlwZSA9ICdwbSc7XG4gICAgICAgICAgICAgICAgdGhpcy5zdGF0ZSA9IGlnbm9yZTtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIEVTQyBjIEZ1bGwgUmVzZXQgKFJJUykuXG4gICAgICAgICAgICBjYXNlICdjJzpcbiAgICAgICAgICAgICAgICB0aGlzLnJlc2V0KCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBFU0MgRSBOZXh0IExpbmUgKCBORUwgaXMgMHg4NSkuXG4gICAgICAgICAgICAgICAgLy8gRVNDIEQgSW5kZXggKCBJTkQgaXMgMHg4NCkuXG4gICAgICAgICAgICBjYXNlICdFJzpcbiAgICAgICAgICAgICAgICB0aGlzLnggPSAwOztcbiAgICAgICAgICAgIGNhc2UgJ0QnOlxuICAgICAgICAgICAgICAgIHRoaXMuaW5kZXgoKTtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIEVTQyBNIFJldmVyc2UgSW5kZXggKCBSSSBpcyAweDhkKS5cbiAgICAgICAgICAgIGNhc2UgJ00nOlxuICAgICAgICAgICAgICAgIHRoaXMucmV2ZXJzZUluZGV4KCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBFU0MgJSBTZWxlY3QgZGVmYXVsdC91dGYtOCBjaGFyYWN0ZXIgc2V0LlxuICAgICAgICAgICAgICAgIC8vIEAgPSBkZWZhdWx0LCBHID0gdXRmLThcbiAgICAgICAgICAgIGNhc2UgJyUnOlxuICAgICAgICAgICAgICAgIC8vdGhpcy5jaGFyc2V0ID0gbnVsbDtcbiAgICAgICAgICAgICAgICB0aGlzLnNldGdMZXZlbCgwKTtcbiAgICAgICAgICAgICAgICB0aGlzLnNldGdDaGFyc2V0KDAsIFRlcm1pbmFsLmNoYXJzZXRzLlVTKTtcbiAgICAgICAgICAgICAgICB0aGlzLnN0YXRlID0gbm9ybWFsO1xuICAgICAgICAgICAgICAgIGkrKztcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIEVTQyAoLCksKiwrLC0sLiBEZXNpZ25hdGUgRzAtRzIgQ2hhcmFjdGVyIFNldC5cbiAgICAgICAgICAgIGNhc2UgJygnOlxuICAgICAgICAgICAgICAgIC8vIDwtLSB0aGlzIHNlZW1zIHRvIGdldCBhbGwgdGhlIGF0dGVudGlvblxuICAgICAgICAgICAgY2FzZSAnKSc6XG4gICAgICAgICAgICBjYXNlICcqJzpcbiAgICAgICAgICAgIGNhc2UgJysnOlxuICAgICAgICAgICAgY2FzZSAnLSc6XG4gICAgICAgICAgICBjYXNlICcuJzpcbiAgICAgICAgICAgICAgICBzd2l0Y2ggKGNoKSB7XG4gICAgICAgICAgICAgICAgY2FzZSAnKCc6XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZ2NoYXJzZXQgPSAwO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICcpJzpcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5nY2hhcnNldCA9IDE7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJyonOlxuICAgICAgICAgICAgICAgICAgICB0aGlzLmdjaGFyc2V0ID0gMjtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAnKyc6XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZ2NoYXJzZXQgPSAzO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICctJzpcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5nY2hhcnNldCA9IDE7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJy4nOlxuICAgICAgICAgICAgICAgICAgICB0aGlzLmdjaGFyc2V0ID0gMjtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRoaXMuc3RhdGUgPSBjaGFyc2V0O1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gRGVzaWduYXRlIEczIENoYXJhY3RlciBTZXQgKFZUMzAwKS5cbiAgICAgICAgICAgICAgICAvLyBBID0gSVNPIExhdGluLTEgU3VwcGxlbWVudGFsLlxuICAgICAgICAgICAgICAgIC8vIE5vdCBpbXBsZW1lbnRlZC5cbiAgICAgICAgICAgIGNhc2UgJy8nOlxuICAgICAgICAgICAgICAgIHRoaXMuZ2NoYXJzZXQgPSAzO1xuICAgICAgICAgICAgICAgIHRoaXMuc3RhdGUgPSBjaGFyc2V0O1xuICAgICAgICAgICAgICAgIGktLTtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIEVTQyBOXG4gICAgICAgICAgICAgICAgLy8gU2luZ2xlIFNoaWZ0IFNlbGVjdCBvZiBHMiBDaGFyYWN0ZXIgU2V0XG4gICAgICAgICAgICAgICAgLy8gKCBTUzIgaXMgMHg4ZSkuIFRoaXMgYWZmZWN0cyBuZXh0IGNoYXJhY3RlciBvbmx5LlxuICAgICAgICAgICAgY2FzZSAnTic6XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgLy8gRVNDIE9cbiAgICAgICAgICAgICAgICAvLyBTaW5nbGUgU2hpZnQgU2VsZWN0IG9mIEczIENoYXJhY3RlciBTZXRcbiAgICAgICAgICAgICAgICAvLyAoIFNTMyBpcyAweDhmKS4gVGhpcyBhZmZlY3RzIG5leHQgY2hhcmFjdGVyIG9ubHkuXG4gICAgICAgICAgICBjYXNlICdPJzpcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAvLyBFU0MgblxuICAgICAgICAgICAgICAgIC8vIEludm9rZSB0aGUgRzIgQ2hhcmFjdGVyIFNldCBhcyBHTCAoTFMyKS5cbiAgICAgICAgICAgIGNhc2UgJ24nOlxuICAgICAgICAgICAgICAgIHRoaXMuc2V0Z0xldmVsKDIpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIC8vIEVTQyBvXG4gICAgICAgICAgICAgICAgLy8gSW52b2tlIHRoZSBHMyBDaGFyYWN0ZXIgU2V0IGFzIEdMIChMUzMpLlxuICAgICAgICAgICAgY2FzZSAnbyc6XG4gICAgICAgICAgICAgICAgdGhpcy5zZXRnTGV2ZWwoMyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgLy8gRVNDIHxcbiAgICAgICAgICAgICAgICAvLyBJbnZva2UgdGhlIEczIENoYXJhY3RlciBTZXQgYXMgR1IgKExTM1IpLlxuICAgICAgICAgICAgY2FzZSAnfCc6XG4gICAgICAgICAgICAgICAgdGhpcy5zZXRnTGV2ZWwoMyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgLy8gRVNDIH1cbiAgICAgICAgICAgICAgICAvLyBJbnZva2UgdGhlIEcyIENoYXJhY3RlciBTZXQgYXMgR1IgKExTMlIpLlxuICAgICAgICAgICAgY2FzZSAnfSc6XG4gICAgICAgICAgICAgICAgdGhpcy5zZXRnTGV2ZWwoMik7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgLy8gRVNDIH5cbiAgICAgICAgICAgICAgICAvLyBJbnZva2UgdGhlIEcxIENoYXJhY3RlciBTZXQgYXMgR1IgKExTMVIpLlxuICAgICAgICAgICAgY2FzZSAnfic6XG4gICAgICAgICAgICAgICAgdGhpcy5zZXRnTGV2ZWwoMSk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBFU0MgNyBTYXZlIEN1cnNvciAoREVDU0MpLlxuICAgICAgICAgICAgY2FzZSAnNyc6XG4gICAgICAgICAgICAgICAgdGhpcy5zYXZlQ3Vyc29yKCk7XG4gICAgICAgICAgICAgICAgdGhpcy5zdGF0ZSA9IG5vcm1hbDtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIEVTQyA4IFJlc3RvcmUgQ3Vyc29yIChERUNSQykuXG4gICAgICAgICAgICBjYXNlICc4JzpcbiAgICAgICAgICAgICAgICB0aGlzLnJlc3RvcmVDdXJzb3IoKTtcbiAgICAgICAgICAgICAgICB0aGlzLnN0YXRlID0gbm9ybWFsO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gRVNDICMgMyBERUMgbGluZSBoZWlnaHQvd2lkdGhcbiAgICAgICAgICAgIGNhc2UgJyMnOlxuICAgICAgICAgICAgICAgIHRoaXMuc3RhdGUgPSBub3JtYWw7XG4gICAgICAgICAgICAgICAgaSsrO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gRVNDIEggVGFiIFNldCAoSFRTIGlzIDB4ODgpLlxuICAgICAgICAgICAgY2FzZSAnSCc6XG4gICAgICAgICAgICAgICAgdGhpcy50YWJTZXQoKTtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIEVTQyA9IEFwcGxpY2F0aW9uIEtleXBhZCAoREVDUEFNKS5cbiAgICAgICAgICAgIGNhc2UgJz0nOlxuICAgICAgICAgICAgICAgIHRoaXMubG9nKCdTZXJpYWwgcG9ydCByZXF1ZXN0ZWQgYXBwbGljYXRpb24ga2V5cGFkLicpO1xuICAgICAgICAgICAgICAgIHRoaXMuYXBwbGljYXRpb25LZXlwYWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHRoaXMuc3RhdGUgPSBub3JtYWw7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBFU0MgPiBOb3JtYWwgS2V5cGFkIChERUNQTk0pLlxuICAgICAgICAgICAgY2FzZSAnPic6XG4gICAgICAgICAgICAgICAgdGhpcy5sb2coJ1N3aXRjaGluZyBiYWNrIHRvIG5vcm1hbCBrZXlwYWQuJyk7XG4gICAgICAgICAgICAgICAgdGhpcy5hcHBsaWNhdGlvbktleXBhZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIHRoaXMuc3RhdGUgPSBub3JtYWw7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgdGhpcy5zdGF0ZSA9IG5vcm1hbDtcbiAgICAgICAgICAgICAgICB0aGlzLmVycm9yKCdVbmtub3duIEVTQyBjb250cm9sOiAlcy4nLCBjaCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICBjYXNlIGNoYXJzZXQ6XG4gICAgICAgICAgICBzd2l0Y2ggKGNoKSB7XG4gICAgICAgICAgICBjYXNlICcwJzpcbiAgICAgICAgICAgICAgICAvLyBERUMgU3BlY2lhbCBDaGFyYWN0ZXIgYW5kIExpbmUgRHJhd2luZyBTZXQuXG4gICAgICAgICAgICAgICAgY3MgPSBUZXJtaW5hbC5jaGFyc2V0cy5TQ0xEO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnQSc6XG4gICAgICAgICAgICAgICAgLy8gVUtcbiAgICAgICAgICAgICAgICBjcyA9IFRlcm1pbmFsLmNoYXJzZXRzLlVLO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnQic6XG4gICAgICAgICAgICAgICAgLy8gVW5pdGVkIFN0YXRlcyAoVVNBU0NJSSkuXG4gICAgICAgICAgICAgICAgY3MgPSBUZXJtaW5hbC5jaGFyc2V0cy5VUztcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJzQnOlxuICAgICAgICAgICAgICAgIC8vIER1dGNoXG4gICAgICAgICAgICAgICAgY3MgPSBUZXJtaW5hbC5jaGFyc2V0cy5EdXRjaDtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ0MnOlxuICAgICAgICAgICAgICAgIC8vIEZpbm5pc2hcbiAgICAgICAgICAgIGNhc2UgJzUnOlxuICAgICAgICAgICAgICAgIGNzID0gVGVybWluYWwuY2hhcnNldHMuRmlubmlzaDtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ1InOlxuICAgICAgICAgICAgICAgIC8vIEZyZW5jaFxuICAgICAgICAgICAgICAgIGNzID0gVGVybWluYWwuY2hhcnNldHMuRnJlbmNoO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnUSc6XG4gICAgICAgICAgICAgICAgLy8gRnJlbmNoQ2FuYWRpYW5cbiAgICAgICAgICAgICAgICBjcyA9IFRlcm1pbmFsLmNoYXJzZXRzLkZyZW5jaENhbmFkaWFuO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnSyc6XG4gICAgICAgICAgICAgICAgLy8gR2VybWFuXG4gICAgICAgICAgICAgICAgY3MgPSBUZXJtaW5hbC5jaGFyc2V0cy5HZXJtYW47XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdZJzpcbiAgICAgICAgICAgICAgICAvLyBJdGFsaWFuXG4gICAgICAgICAgICAgICAgY3MgPSBUZXJtaW5hbC5jaGFyc2V0cy5JdGFsaWFuO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnRSc6XG4gICAgICAgICAgICAgICAgLy8gTm9yd2VnaWFuRGFuaXNoXG4gICAgICAgICAgICBjYXNlICc2JzpcbiAgICAgICAgICAgICAgICBjcyA9IFRlcm1pbmFsLmNoYXJzZXRzLk5vcndlZ2lhbkRhbmlzaDtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ1onOlxuICAgICAgICAgICAgICAgIC8vIFNwYW5pc2hcbiAgICAgICAgICAgICAgICBjcyA9IFRlcm1pbmFsLmNoYXJzZXRzLlNwYW5pc2g7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdIJzpcbiAgICAgICAgICAgICAgICAvLyBTd2VkaXNoXG4gICAgICAgICAgICBjYXNlICc3JzpcbiAgICAgICAgICAgICAgICBjcyA9IFRlcm1pbmFsLmNoYXJzZXRzLlN3ZWRpc2g7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICc9JzpcbiAgICAgICAgICAgICAgICAvLyBTd2lzc1xuICAgICAgICAgICAgICAgIGNzID0gVGVybWluYWwuY2hhcnNldHMuU3dpc3M7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICcvJzpcbiAgICAgICAgICAgICAgICAvLyBJU09MYXRpbiAoYWN0dWFsbHkgL0EpXG4gICAgICAgICAgICAgICAgY3MgPSBUZXJtaW5hbC5jaGFyc2V0cy5JU09MYXRpbjtcbiAgICAgICAgICAgICAgICBpKys7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIC8vIERlZmF1bHRcbiAgICAgICAgICAgICAgICBjcyA9IFRlcm1pbmFsLmNoYXJzZXRzLlVTO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5zZXRnQ2hhcnNldCh0aGlzLmdjaGFyc2V0LCBjcyk7XG4gICAgICAgICAgICB0aGlzLmdjaGFyc2V0ID0gbnVsbDtcbiAgICAgICAgICAgIHRoaXMuc3RhdGUgPSBub3JtYWw7XG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICBjYXNlIG9zYzpcbiAgICAgICAgICAgIC8vIE9TQyBQcyA7IFB0IFNUXG4gICAgICAgICAgICAvLyBPU0MgUHMgOyBQdCBCRUxcbiAgICAgICAgICAgIC8vIFNldCBUZXh0IFBhcmFtZXRlcnMuXG4gICAgICAgICAgICBpZiAoY2ggPT09ICdcXHgxYicgfHwgY2ggPT09ICdcXHgwNycpIHtcbiAgICAgICAgICAgICAgICBpZiAoY2ggPT09ICdcXHgxYicpIGkrKztcblxuICAgICAgICAgICAgICAgIHRoaXMucGFyYW1zLnB1c2godGhpcy5jdXJyZW50UGFyYW0pO1xuXG4gICAgICAgICAgICAgICAgc3dpdGNoICh0aGlzLnBhcmFtc1swXSkge1xuICAgICAgICAgICAgICAgIGNhc2UgMDpcbiAgICAgICAgICAgICAgICBjYXNlIDE6XG4gICAgICAgICAgICAgICAgY2FzZSAyOlxuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5wYXJhbXNbMV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudGl0bGUgPSB0aGlzLnBhcmFtc1sxXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuaGFuZGxlVGl0bGUodGhpcy50aXRsZSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAzOlxuICAgICAgICAgICAgICAgICAgICAvLyBzZXQgWCBwcm9wZXJ0eVxuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlIDQ6XG4gICAgICAgICAgICAgICAgY2FzZSA1OlxuICAgICAgICAgICAgICAgICAgICAvLyBjaGFuZ2UgZHluYW1pYyBjb2xvcnNcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAxMDpcbiAgICAgICAgICAgICAgICBjYXNlIDExOlxuICAgICAgICAgICAgICAgIGNhc2UgMTI6XG4gICAgICAgICAgICAgICAgY2FzZSAxMzpcbiAgICAgICAgICAgICAgICBjYXNlIDE0OlxuICAgICAgICAgICAgICAgIGNhc2UgMTU6XG4gICAgICAgICAgICAgICAgY2FzZSAxNjpcbiAgICAgICAgICAgICAgICBjYXNlIDE3OlxuICAgICAgICAgICAgICAgIGNhc2UgMTg6XG4gICAgICAgICAgICAgICAgY2FzZSAxOTpcbiAgICAgICAgICAgICAgICAgICAgLy8gY2hhbmdlIGR5bmFtaWMgdWkgY29sb3JzXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgNDY6XG4gICAgICAgICAgICAgICAgICAgIC8vIGNoYW5nZSBsb2cgZmlsZVxuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlIDUwOlxuICAgICAgICAgICAgICAgICAgICAvLyBkeW5hbWljIGZvbnRcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSA1MTpcbiAgICAgICAgICAgICAgICAgICAgLy8gZW1hY3Mgc2hlbGxcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSA1MjpcbiAgICAgICAgICAgICAgICAgICAgLy8gbWFuaXB1bGF0ZSBzZWxlY3Rpb24gZGF0YVxuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlIDEwNDpcbiAgICAgICAgICAgICAgICBjYXNlIDEwNTpcbiAgICAgICAgICAgICAgICBjYXNlIDExMDpcbiAgICAgICAgICAgICAgICBjYXNlIDExMTpcbiAgICAgICAgICAgICAgICBjYXNlIDExMjpcbiAgICAgICAgICAgICAgICBjYXNlIDExMzpcbiAgICAgICAgICAgICAgICBjYXNlIDExNDpcbiAgICAgICAgICAgICAgICBjYXNlIDExNTpcbiAgICAgICAgICAgICAgICBjYXNlIDExNjpcbiAgICAgICAgICAgICAgICBjYXNlIDExNzpcbiAgICAgICAgICAgICAgICBjYXNlIDExODpcbiAgICAgICAgICAgICAgICAgICAgLy8gcmVzZXQgY29sb3JzXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHRoaXMucGFyYW1zID0gW107XG4gICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50UGFyYW0gPSAwO1xuICAgICAgICAgICAgICAgIHRoaXMuc3RhdGUgPSBub3JtYWw7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGlmICghdGhpcy5wYXJhbXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjaCA+PSAnMCcgJiYgY2ggPD0gJzknKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmN1cnJlbnRQYXJhbSA9IHRoaXMuY3VycmVudFBhcmFtICogMTAgKyBjaC5jaGFyQ29kZUF0KDApIC0gNDg7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoY2ggPT09ICc7Jykge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5wYXJhbXMucHVzaCh0aGlzLmN1cnJlbnRQYXJhbSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmN1cnJlbnRQYXJhbSA9ICcnO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50UGFyYW0gKz0gY2g7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgY2FzZSBjc2k6XG4gICAgICAgICAgICAvLyAnPycsICc+JywgJyEnXG4gICAgICAgICAgICBpZiAoY2ggPT09ICc/JyB8fCBjaCA9PT0gJz4nIHx8IGNoID09PSAnIScpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnByZWZpeCA9IGNoO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyAwIC0gOVxuICAgICAgICAgICAgaWYgKGNoID49ICcwJyAmJiBjaCA8PSAnOScpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmN1cnJlbnRQYXJhbSA9IHRoaXMuY3VycmVudFBhcmFtICogMTAgKyBjaC5jaGFyQ29kZUF0KDApIC0gNDg7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vICckJywgJ1wiJywgJyAnLCAnXFwnJ1xuICAgICAgICAgICAgaWYgKGNoID09PSAnJCcgfHwgY2ggPT09ICdcIicgfHwgY2ggPT09ICcgJyB8fCBjaCA9PT0gJ1xcJycpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnBvc3RmaXggPSBjaDtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5wYXJhbXMucHVzaCh0aGlzLmN1cnJlbnRQYXJhbSk7XG4gICAgICAgICAgICB0aGlzLmN1cnJlbnRQYXJhbSA9IDA7XG5cbiAgICAgICAgICAgIC8vICc7J1xuICAgICAgICAgICAgaWYgKGNoID09PSAnOycpIGJyZWFrO1xuXG4gICAgICAgICAgICB0aGlzLnN0YXRlID0gbm9ybWFsO1xuXG4gICAgICAgICAgICBzd2l0Y2ggKGNoKSB7XG4gICAgICAgICAgICAgICAgLy8gQ1NJIFBzIEFcbiAgICAgICAgICAgICAgICAvLyBDdXJzb3IgVXAgUHMgVGltZXMgKGRlZmF1bHQgPSAxKSAoQ1VVKS5cbiAgICAgICAgICAgIGNhc2UgJ0EnOlxuICAgICAgICAgICAgICAgIHRoaXMuY3Vyc29yVXAodGhpcy5wYXJhbXMpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gQ1NJIFBzIEJcbiAgICAgICAgICAgICAgICAvLyBDdXJzb3IgRG93biBQcyBUaW1lcyAoZGVmYXVsdCA9IDEpIChDVUQpLlxuICAgICAgICAgICAgY2FzZSAnQic6XG4gICAgICAgICAgICAgICAgdGhpcy5jdXJzb3JEb3duKHRoaXMucGFyYW1zKTtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIENTSSBQcyBDXG4gICAgICAgICAgICAgICAgLy8gQ3Vyc29yIEZvcndhcmQgUHMgVGltZXMgKGRlZmF1bHQgPSAxKSAoQ1VGKS5cbiAgICAgICAgICAgIGNhc2UgJ0MnOlxuICAgICAgICAgICAgICAgIHRoaXMuY3Vyc29yRm9yd2FyZCh0aGlzLnBhcmFtcyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBDU0kgUHMgRFxuICAgICAgICAgICAgICAgIC8vIEN1cnNvciBCYWNrd2FyZCBQcyBUaW1lcyAoZGVmYXVsdCA9IDEpIChDVUIpLlxuICAgICAgICAgICAgY2FzZSAnRCc6XG4gICAgICAgICAgICAgICAgdGhpcy5jdXJzb3JCYWNrd2FyZCh0aGlzLnBhcmFtcyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBDU0kgUHMgOyBQcyBIXG4gICAgICAgICAgICAgICAgLy8gQ3Vyc29yIFBvc2l0aW9uIFtyb3c7Y29sdW1uXSAoZGVmYXVsdCA9IFsxLDFdKSAoQ1VQKS5cbiAgICAgICAgICAgIGNhc2UgJ0gnOlxuICAgICAgICAgICAgICAgIHRoaXMuY3Vyc29yUG9zKHRoaXMucGFyYW1zKTtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIENTSSBQcyBKIEVyYXNlIGluIERpc3BsYXkgKEVEKS5cbiAgICAgICAgICAgIGNhc2UgJ0onOlxuICAgICAgICAgICAgICAgIHRoaXMuZXJhc2VJbkRpc3BsYXkodGhpcy5wYXJhbXMpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gQ1NJIFBzIEsgRXJhc2UgaW4gTGluZSAoRUwpLlxuICAgICAgICAgICAgY2FzZSAnSyc6XG4gICAgICAgICAgICAgICAgdGhpcy5lcmFzZUluTGluZSh0aGlzLnBhcmFtcyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBDU0kgUG0gbSBDaGFyYWN0ZXIgQXR0cmlidXRlcyAoU0dSKS5cbiAgICAgICAgICAgIGNhc2UgJ20nOlxuICAgICAgICAgICAgICAgIHRoaXMuY2hhckF0dHJpYnV0ZXModGhpcy5wYXJhbXMpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gQ1NJIFBzIG4gRGV2aWNlIFN0YXR1cyBSZXBvcnQgKERTUikuXG4gICAgICAgICAgICBjYXNlICduJzpcbiAgICAgICAgICAgICAgICB0aGlzLmRldmljZVN0YXR1cyh0aGlzLnBhcmFtcyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAgICAgKiBBZGRpdGlvbnNcbiAgICAgICAgICAgICAgICAgKi9cblxuICAgICAgICAgICAgICAgIC8vIENTSSBQcyBAXG4gICAgICAgICAgICAgICAgLy8gSW5zZXJ0IFBzIChCbGFuaykgQ2hhcmFjdGVyKHMpIChkZWZhdWx0ID0gMSkgKElDSCkuXG4gICAgICAgICAgICBjYXNlICdAJzpcbiAgICAgICAgICAgICAgICB0aGlzLmluc2VydENoYXJzKHRoaXMucGFyYW1zKTtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIENTSSBQcyBFXG4gICAgICAgICAgICAgICAgLy8gQ3Vyc29yIE5leHQgTGluZSBQcyBUaW1lcyAoZGVmYXVsdCA9IDEpIChDTkwpLlxuICAgICAgICAgICAgY2FzZSAnRSc6XG4gICAgICAgICAgICAgICAgdGhpcy5jdXJzb3JOZXh0TGluZSh0aGlzLnBhcmFtcyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBDU0kgUHMgRlxuICAgICAgICAgICAgICAgIC8vIEN1cnNvciBQcmVjZWRpbmcgTGluZSBQcyBUaW1lcyAoZGVmYXVsdCA9IDEpIChDTkwpLlxuICAgICAgICAgICAgY2FzZSAnRic6XG4gICAgICAgICAgICAgICAgdGhpcy5jdXJzb3JQcmVjZWRpbmdMaW5lKHRoaXMucGFyYW1zKTtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIENTSSBQcyBHXG4gICAgICAgICAgICAgICAgLy8gQ3Vyc29yIENoYXJhY3RlciBBYnNvbHV0ZSBbY29sdW1uXSAoZGVmYXVsdCA9IFtyb3csMV0pIChDSEEpLlxuICAgICAgICAgICAgY2FzZSAnRyc6XG4gICAgICAgICAgICAgICAgdGhpcy5jdXJzb3JDaGFyQWJzb2x1dGUodGhpcy5wYXJhbXMpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gQ1NJIFBzIExcbiAgICAgICAgICAgICAgICAvLyBJbnNlcnQgUHMgTGluZShzKSAoZGVmYXVsdCA9IDEpIChJTCkuXG4gICAgICAgICAgICBjYXNlICdMJzpcbiAgICAgICAgICAgICAgICB0aGlzLmluc2VydExpbmVzKHRoaXMucGFyYW1zKTtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIENTSSBQcyBNXG4gICAgICAgICAgICAgICAgLy8gRGVsZXRlIFBzIExpbmUocykgKGRlZmF1bHQgPSAxKSAoREwpLlxuICAgICAgICAgICAgY2FzZSAnTSc6XG4gICAgICAgICAgICAgICAgdGhpcy5kZWxldGVMaW5lcyh0aGlzLnBhcmFtcyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBDU0kgUHMgUFxuICAgICAgICAgICAgICAgIC8vIERlbGV0ZSBQcyBDaGFyYWN0ZXIocykgKGRlZmF1bHQgPSAxKSAoRENIKS5cbiAgICAgICAgICAgIGNhc2UgJ1AnOlxuICAgICAgICAgICAgICAgIHRoaXMuZGVsZXRlQ2hhcnModGhpcy5wYXJhbXMpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gQ1NJIFBzIFhcbiAgICAgICAgICAgICAgICAvLyBFcmFzZSBQcyBDaGFyYWN0ZXIocykgKGRlZmF1bHQgPSAxKSAoRUNIKS5cbiAgICAgICAgICAgIGNhc2UgJ1gnOlxuICAgICAgICAgICAgICAgIHRoaXMuZXJhc2VDaGFycyh0aGlzLnBhcmFtcyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBDU0kgUG0gYCBDaGFyYWN0ZXIgUG9zaXRpb24gQWJzb2x1dGVcbiAgICAgICAgICAgICAgICAvLyBbY29sdW1uXSAoZGVmYXVsdCA9IFtyb3csMV0pIChIUEEpLlxuICAgICAgICAgICAgY2FzZSAnYCc6XG4gICAgICAgICAgICAgICAgdGhpcy5jaGFyUG9zQWJzb2x1dGUodGhpcy5wYXJhbXMpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gMTQxIDYxIGEgKiBIUFIgLVxuICAgICAgICAgICAgICAgIC8vIEhvcml6b250YWwgUG9zaXRpb24gUmVsYXRpdmVcbiAgICAgICAgICAgIGNhc2UgJ2EnOlxuICAgICAgICAgICAgICAgIHRoaXMuSFBvc2l0aW9uUmVsYXRpdmUodGhpcy5wYXJhbXMpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gQ1NJIFAgcyBjXG4gICAgICAgICAgICAgICAgLy8gU2VuZCBEZXZpY2UgQXR0cmlidXRlcyAoUHJpbWFyeSBEQSkuXG4gICAgICAgICAgICAgICAgLy8gQ1NJID4gUCBzIGNcbiAgICAgICAgICAgICAgICAvLyBTZW5kIERldmljZSBBdHRyaWJ1dGVzIChTZWNvbmRhcnkgREEpXG4gICAgICAgICAgICBjYXNlICdjJzpcbiAgICAgICAgICAgICAgICB0aGlzLnNlbmREZXZpY2VBdHRyaWJ1dGVzKHRoaXMucGFyYW1zKTtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIENTSSBQbSBkXG4gICAgICAgICAgICAgICAgLy8gTGluZSBQb3NpdGlvbiBBYnNvbHV0ZSBbcm93XSAoZGVmYXVsdCA9IFsxLGNvbHVtbl0pIChWUEEpLlxuICAgICAgICAgICAgY2FzZSAnZCc6XG4gICAgICAgICAgICAgICAgdGhpcy5saW5lUG9zQWJzb2x1dGUodGhpcy5wYXJhbXMpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gMTQ1IDY1IGUgKiBWUFIgLSBWZXJ0aWNhbCBQb3NpdGlvbiBSZWxhdGl2ZVxuICAgICAgICAgICAgY2FzZSAnZSc6XG4gICAgICAgICAgICAgICAgdGhpcy5WUG9zaXRpb25SZWxhdGl2ZSh0aGlzLnBhcmFtcyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBDU0kgUHMgOyBQcyBmXG4gICAgICAgICAgICAgICAgLy8gSG9yaXpvbnRhbCBhbmQgVmVydGljYWwgUG9zaXRpb24gW3Jvdztjb2x1bW5dIChkZWZhdWx0ID1cbiAgICAgICAgICAgICAgICAvLyBbMSwxXSkgKEhWUCkuXG4gICAgICAgICAgICBjYXNlICdmJzpcbiAgICAgICAgICAgICAgICB0aGlzLkhWUG9zaXRpb24odGhpcy5wYXJhbXMpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gQ1NJIFBtIGggU2V0IE1vZGUgKFNNKS5cbiAgICAgICAgICAgICAgICAvLyBDU0kgPyBQbSBoIC0gbW91c2UgZXNjYXBlIGNvZGVzLCBjdXJzb3IgZXNjYXBlIGNvZGVzXG4gICAgICAgICAgICBjYXNlICdoJzpcbiAgICAgICAgICAgICAgICB0aGlzLnNldE1vZGUodGhpcy5wYXJhbXMpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLy8gQ1NJIFBtIGwgUmVzZXQgTW9kZSAoUk0pLlxuICAgICAgICAgICAgICAgIC8vIENTSSA/IFBtIGxcbiAgICAgICAgICAgIGNhc2UgJ2wnOlxuICAgICAgICAgICAgICAgIHRoaXMucmVzZXRNb2RlKHRoaXMucGFyYW1zKTtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIENTSSBQcyA7IFBzIHJcbiAgICAgICAgICAgICAgICAvLyBTZXQgU2Nyb2xsaW5nIFJlZ2lvbiBbdG9wO2JvdHRvbV0gKGRlZmF1bHQgPSBmdWxsIHNpemUgb2Ygd2luLVxuICAgICAgICAgICAgICAgIC8vIGRvdykgKERFQ1NUQk0pLlxuICAgICAgICAgICAgICAgIC8vIENTSSA/IFBtIHJcbiAgICAgICAgICAgIGNhc2UgJ3InOlxuICAgICAgICAgICAgICAgIHRoaXMuc2V0U2Nyb2xsUmVnaW9uKHRoaXMucGFyYW1zKTtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIENTSSBzXG4gICAgICAgICAgICAgICAgLy8gU2F2ZSBjdXJzb3IgKEFOU0kuU1lTKS5cbiAgICAgICAgICAgIGNhc2UgJ3MnOlxuICAgICAgICAgICAgICAgIHRoaXMuc2F2ZUN1cnNvcih0aGlzLnBhcmFtcyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBDU0kgdVxuICAgICAgICAgICAgICAgIC8vIFJlc3RvcmUgY3Vyc29yIChBTlNJLlNZUykuXG4gICAgICAgICAgICBjYXNlICd1JzpcbiAgICAgICAgICAgICAgICB0aGlzLnJlc3RvcmVDdXJzb3IodGhpcy5wYXJhbXMpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgICAgICogTGVzc2VyIFVzZWRcbiAgICAgICAgICAgICAgICAgKi9cblxuICAgICAgICAgICAgICAgIC8vIENTSSBQcyBJXG4gICAgICAgICAgICAgICAgLy8gQ3Vyc29yIEZvcndhcmQgVGFidWxhdGlvbiBQcyB0YWIgc3RvcHMgKGRlZmF1bHQgPSAxKSAoQ0hUKS5cbiAgICAgICAgICAgIGNhc2UgJ0knOlxuICAgICAgICAgICAgICAgIHRoaXMuY3Vyc29yRm9yd2FyZFRhYih0aGlzLnBhcmFtcyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBDU0kgUHMgUyBTY3JvbGwgdXAgUHMgbGluZXMgKGRlZmF1bHQgPSAxKSAoU1UpLlxuICAgICAgICAgICAgY2FzZSAnUyc6XG4gICAgICAgICAgICAgICAgdGhpcy5zY3JvbGxVcCh0aGlzLnBhcmFtcyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBDU0kgUHMgVCBTY3JvbGwgZG93biBQcyBsaW5lcyAoZGVmYXVsdCA9IDEpIChTRCkuXG4gICAgICAgICAgICAgICAgLy8gQ1NJIFBzIDsgUHMgOyBQcyA7IFBzIDsgUHMgVFxuICAgICAgICAgICAgICAgIC8vIENTSSA+IFBzOyBQcyBUXG4gICAgICAgICAgICBjYXNlICdUJzpcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5wYXJhbXMubGVuZ3RoIDwgMiAmJiAhdGhpcy5wcmVmaXgpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5zY3JvbGxEb3duKHRoaXMucGFyYW1zKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBDU0kgUHMgWlxuICAgICAgICAgICAgICAgIC8vIEN1cnNvciBCYWNrd2FyZCBUYWJ1bGF0aW9uIFBzIHRhYiBzdG9wcyAoZGVmYXVsdCA9IDEpIChDQlQpLlxuICAgICAgICAgICAgY2FzZSAnWic6XG4gICAgICAgICAgICAgICAgdGhpcy5jdXJzb3JCYWNrd2FyZFRhYih0aGlzLnBhcmFtcyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAvLyBDU0kgUHMgYiBSZXBlYXQgdGhlIHByZWNlZGluZyBncmFwaGljIGNoYXJhY3RlciBQcyB0aW1lcyAoUkVQKS5cbiAgICAgICAgICAgIGNhc2UgJ2InOlxuICAgICAgICAgICAgICAgIHRoaXMucmVwZWF0UHJlY2VkaW5nQ2hhcmFjdGVyKHRoaXMucGFyYW1zKTtcbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIC8vIENTSSBQcyBnIFRhYiBDbGVhciAoVEJDKS5cbiAgICAgICAgICAgIGNhc2UgJ2cnOlxuICAgICAgICAgICAgICAgIHRoaXMudGFiQ2xlYXIodGhpcy5wYXJhbXMpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAncCc6XG4gICAgICAgICAgICAgICAgc3dpdGNoICh0aGlzLnByZWZpeCkge1xuICAgICAgICAgICAgICAgIGNhc2UgJyEnOlxuICAgICAgICAgICAgICAgICAgICB0aGlzLnNvZnRSZXNldCh0aGlzLnBhcmFtcyk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICB0aGlzLmVycm9yKCdVbmtub3duIENTSSBjb2RlOiAlcy4nLCBjaCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMucHJlZml4ID0gJyc7XG4gICAgICAgICAgICB0aGlzLnBvc3RmaXggPSAnJztcbiAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgIGNhc2UgZGNzOlxuICAgICAgICAgICAgaWYgKGNoID09PSAnXFx4MWInIHx8IGNoID09PSAnXFx4MDcnKSB7XG4gICAgICAgICAgICAgICAgaWYgKGNoID09PSAnXFx4MWInKSBpKys7XG5cbiAgICAgICAgICAgICAgICBzd2l0Y2ggKHRoaXMucHJlZml4KSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZXItRGVmaW5lZCBLZXlzIChERUNVREspLlxuICAgICAgICAgICAgICAgIGNhc2UgJyc6XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIFJlcXVlc3QgU3RhdHVzIFN0cmluZyAoREVDUlFTUykuXG4gICAgICAgICAgICAgICAgICAgIC8vIHRlc3Q6IGVjaG8gLWUgJ1xcZVAkcVwicFxcZVxcXFwnXG4gICAgICAgICAgICAgICAgY2FzZSAnJHEnOlxuICAgICAgICAgICAgICAgICAgICB2YXIgcHQgPSB0aGlzLmN1cnJlbnRQYXJhbSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkID0gZmFsc2U7XG5cbiAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChwdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gREVDU0NBXG4gICAgICAgICAgICAgICAgICAgIGNhc2UgJ1wicSc6XG4gICAgICAgICAgICAgICAgICAgICAgICBwdCA9ICcwXCJxJztcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBERUNTQ0xcbiAgICAgICAgICAgICAgICAgICAgY2FzZSAnXCJwJzpcbiAgICAgICAgICAgICAgICAgICAgICAgIHB0ID0gJzYxXCJwJztcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBERUNTVEJNXG4gICAgICAgICAgICAgICAgICAgIGNhc2UgJ3InOlxuICAgICAgICAgICAgICAgICAgICAgICAgcHQgPSAnJyArICh0aGlzLnNjcm9sbFRvcCArIDEpICsgJzsnICsgKHRoaXMuc2Nyb2xsQm90dG9tICsgMSkgKyAncic7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gU0dSXG4gICAgICAgICAgICAgICAgICAgIGNhc2UgJ20nOlxuICAgICAgICAgICAgICAgICAgICAgICAgcHQgPSAnMG0nO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZXJyb3IoJ1Vua25vd24gRENTIFB0OiAlcy4nLCBwdCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBwdCA9ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmQoJ1xceDFiUCcgKyArdmFsaWQgKyAnJHInICsgcHQgKyAnXFx4MWJcXFxcJyk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIFNldCBUZXJtY2FwL1Rlcm1pbmZvIERhdGEgKHh0ZXJtLCBleHBlcmltZW50YWwpLlxuICAgICAgICAgICAgICAgIGNhc2UgJytwJzpcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICB0aGlzLmVycm9yKCdVbmtub3duIERDUyBwcmVmaXg6ICVzLicsIHRoaXMucHJlZml4KTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50UGFyYW0gPSAwO1xuICAgICAgICAgICAgICAgIHRoaXMucHJlZml4ID0gJyc7XG4gICAgICAgICAgICAgICAgdGhpcy5zdGF0ZSA9IG5vcm1hbDtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoIXRoaXMuY3VycmVudFBhcmFtKSB7XG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLnByZWZpeCAmJiBjaCAhPT0gJyQnICYmIGNoICE9PSAnKycpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50UGFyYW0gPSBjaDtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMucHJlZml4Lmxlbmd0aCA9PT0gMikge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmN1cnJlbnRQYXJhbSA9IGNoO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucHJlZml4ICs9IGNoO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50UGFyYW0gKz0gY2g7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICBjYXNlIGlnbm9yZTpcbiAgICAgICAgICAgIC8vIEZvciBQTSBhbmQgQVBDLlxuICAgICAgICAgICAgaWYgKGNoID09PSAnXFx4MWInIHx8IGNoID09PSAnXFx4MDcnKSB7XG4gICAgICAgICAgICAgICAgaWYgKGNoID09PSAnXFx4MWInKSBpKys7XG4gICAgICAgICAgICAgICAgdGhpcy5lbWl0KHRoaXMuc3RhdGVUeXBlLCB0aGlzLnN0YXRlRGF0YSB8fCAnJyk7XG4gICAgICAgICAgICAgICAgdGhpcy5zdGF0ZURhdGEgPSAnJztcbiAgICAgICAgICAgICAgICB0aGlzLnN0YXRlID0gbm9ybWFsO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMuc3RhdGVEYXRhKSB0aGlzLnN0YXRlRGF0YSA9ICcnO1xuICAgICAgICAgICAgICAgIHRoaXMuc3RhdGVEYXRhICs9IGNoO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLnVwZGF0ZVJhbmdlKHRoaXMueSk7XG4gICAgdGhpcy5yZWZyZXNoKHRoaXMucmVmcmVzaFN0YXJ0LCB0aGlzLnJlZnJlc2hFbmQpO1xufTtcblxuVGVybWluYWwucHJvdG90eXBlLndyaXRlbG4gPSBmdW5jdGlvbihkYXRhKSB7XG4gICAgLy8gcHJvcGVybHkgcmVuZGVyIGVtcHR5IGxpbmVzXG4gICAgaWYgKCFkYXRhLnRyaW0oKS5sZW5ndGgpIGRhdGEgPSAnJm5ic3A7JztcbiAgICBkYXRhID0gZGF0YVxuICAgICAgLnJlcGxhY2UoJ1xcdCcsIHRoaXMudGFic3BhY2UpXG4gICAgICAucmVwbGFjZSgvIC9nLCAnJm5ic3A7JylcbiAgICAgIDtcbiAgICB0aGlzLndyaXRlKGRhdGEgKyAnXFxyXFxuJyk7XG59O1xuXG5UZXJtaW5hbC5wcm90b3R5cGUua2V5RG93biA9IGZ1bmN0aW9uKGV2KSB7XG4gICAgdmFyIGtleTtcblxuICAgIHN3aXRjaCAoZXYua2V5Q29kZSkge1xuICAgICAgICAvLyBiYWNrc3BhY2VcbiAgICBjYXNlIDg6XG4gICAgICAgIGlmIChldi5zaGlmdEtleSkge1xuICAgICAgICAgICAga2V5ID0gJ1xceDA4JzsgLy8gXkhcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGtleSA9ICdcXHg3Zic7IC8vIF4/XG4gICAgICAgIGJyZWFrO1xuICAgICAgICAvLyB0YWJcbiAgICBjYXNlIDk6XG4gICAgICAgIGlmIChldi5zaGlmdEtleSkge1xuICAgICAgICAgICAga2V5ID0gJ1xceDFiW1onO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAga2V5ID0gJ1xcdCc7XG4gICAgICAgIGJyZWFrO1xuICAgICAgICAvLyByZXR1cm4vZW50ZXJcbiAgICBjYXNlIDEzOlxuICAgICAgICBrZXkgPSAnXFxyJztcbiAgICAgICAgYnJlYWs7XG4gICAgICAgIC8vIGVzY2FwZVxuICAgIGNhc2UgMjc6XG4gICAgICAgIGtleSA9ICdcXHgxYic7XG4gICAgICAgIGJyZWFrO1xuICAgICAgICAvLyBsZWZ0LWFycm93XG4gICAgY2FzZSAzNzpcbiAgICAgICAgaWYgKHRoaXMuYXBwbGljYXRpb25LZXlwYWQpIHtcbiAgICAgICAgICAgIGtleSA9ICdcXHgxYk9EJzsgLy8gU1MzIGFzIF5bTyBmb3IgNy1iaXRcbiAgICAgICAgICAgIC8va2V5ID0gJ1xceDhmRCc7IC8vIFNTMyBhcyAweDhmIGZvciA4LWJpdFxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAga2V5ID0gJ1xceDFiW0QnO1xuICAgICAgICBicmVhaztcbiAgICAgICAgLy8gcmlnaHQtYXJyb3dcbiAgICBjYXNlIDM5OlxuICAgICAgICBpZiAodGhpcy5hcHBsaWNhdGlvbktleXBhZCkge1xuICAgICAgICAgICAga2V5ID0gJ1xceDFiT0MnO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAga2V5ID0gJ1xceDFiW0MnO1xuICAgICAgICBicmVhaztcbiAgICAgICAgLy8gdXAtYXJyb3dcbiAgICBjYXNlIDM4OlxuICAgICAgICBpZiAodGhpcy5hcHBsaWNhdGlvbktleXBhZCkge1xuICAgICAgICAgICAga2V5ID0gJ1xceDFiT0EnO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGV2LmN0cmxLZXkpIHtcbiAgICAgICAgICAgIHRoaXMuc2Nyb2xsRGlzcCgtMSk7XG4gICAgICAgICAgICByZXR1cm4gY2FuY2VsKGV2KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGtleSA9ICdcXHgxYltBJztcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgICAgLy8gZG93bi1hcnJvd1xuICAgIGNhc2UgNDA6XG4gICAgICAgIGlmICh0aGlzLmFwcGxpY2F0aW9uS2V5cGFkKSB7XG4gICAgICAgICAgICBrZXkgPSAnXFx4MWJPQic7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXYuY3RybEtleSkge1xuICAgICAgICAgICAgdGhpcy5zY3JvbGxEaXNwKDEpO1xuICAgICAgICAgICAgcmV0dXJuIGNhbmNlbChldik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBrZXkgPSAnXFx4MWJbQic7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICAgIC8vIGRlbGV0ZVxuICAgIGNhc2UgNDY6XG4gICAgICAgIGtleSA9ICdcXHgxYlszfic7XG4gICAgICAgIGJyZWFrO1xuICAgICAgICAvLyBpbnNlcnRcbiAgICBjYXNlIDQ1OlxuICAgICAgICBrZXkgPSAnXFx4MWJbMn4nO1xuICAgICAgICBicmVhaztcbiAgICAgICAgLy8gaG9tZVxuICAgIGNhc2UgMzY6XG4gICAgICAgIGlmICh0aGlzLmFwcGxpY2F0aW9uS2V5cGFkKSB7XG4gICAgICAgICAgICBrZXkgPSAnXFx4MWJPSCc7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBrZXkgPSAnXFx4MWJPSCc7XG4gICAgICAgIGJyZWFrO1xuICAgICAgICAvLyBlbmRcbiAgICBjYXNlIDM1OlxuICAgICAgICBpZiAodGhpcy5hcHBsaWNhdGlvbktleXBhZCkge1xuICAgICAgICAgICAga2V5ID0gJ1xceDFiT0YnO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAga2V5ID0gJ1xceDFiT0YnO1xuICAgICAgICBicmVhaztcbiAgICAgICAgLy8gcGFnZSB1cFxuICAgIGNhc2UgMzM6XG4gICAgICAgIGlmIChldi5zaGlmdEtleSkge1xuICAgICAgICAgICAgdGhpcy5zY3JvbGxEaXNwKC0odGhpcy5yb3dzIC0gMSkpO1xuICAgICAgICAgICAgcmV0dXJuIGNhbmNlbChldik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBrZXkgPSAnXFx4MWJbNX4nO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgICAvLyBwYWdlIGRvd25cbiAgICBjYXNlIDM0OlxuICAgICAgICBpZiAoZXYuc2hpZnRLZXkpIHtcbiAgICAgICAgICAgIHRoaXMuc2Nyb2xsRGlzcCh0aGlzLnJvd3MgLSAxKTtcbiAgICAgICAgICAgIHJldHVybiBjYW5jZWwoZXYpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAga2V5ID0gJ1xceDFiWzZ+JztcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgICAgLy8gRjFcbiAgICBjYXNlIDExMjpcbiAgICAgICAga2V5ID0gJ1xceDFiT1AnO1xuICAgICAgICBicmVhaztcbiAgICAgICAgLy8gRjJcbiAgICBjYXNlIDExMzpcbiAgICAgICAga2V5ID0gJ1xceDFiT1EnO1xuICAgICAgICBicmVhaztcbiAgICAgICAgLy8gRjNcbiAgICBjYXNlIDExNDpcbiAgICAgICAga2V5ID0gJ1xceDFiT1InO1xuICAgICAgICBicmVhaztcbiAgICAgICAgLy8gRjRcbiAgICBjYXNlIDExNTpcbiAgICAgICAga2V5ID0gJ1xceDFiT1MnO1xuICAgICAgICBicmVhaztcbiAgICAgICAgLy8gRjVcbiAgICBjYXNlIDExNjpcbiAgICAgICAga2V5ID0gJ1xceDFiWzE1fic7XG4gICAgICAgIGJyZWFrO1xuICAgICAgICAvLyBGNlxuICAgIGNhc2UgMTE3OlxuICAgICAgICBrZXkgPSAnXFx4MWJbMTd+JztcbiAgICAgICAgYnJlYWs7XG4gICAgICAgIC8vIEY3XG4gICAgY2FzZSAxMTg6XG4gICAgICAgIGtleSA9ICdcXHgxYlsxOH4nO1xuICAgICAgICBicmVhaztcbiAgICAgICAgLy8gRjhcbiAgICBjYXNlIDExOTpcbiAgICAgICAga2V5ID0gJ1xceDFiWzE5fic7XG4gICAgICAgIGJyZWFrO1xuICAgICAgICAvLyBGOVxuICAgIGNhc2UgMTIwOlxuICAgICAgICBrZXkgPSAnXFx4MWJbMjB+JztcbiAgICAgICAgYnJlYWs7XG4gICAgICAgIC8vIEYxMFxuICAgIGNhc2UgMTIxOlxuICAgICAgICBrZXkgPSAnXFx4MWJbMjF+JztcbiAgICAgICAgYnJlYWs7XG4gICAgICAgIC8vIEYxMVxuICAgIGNhc2UgMTIyOlxuICAgICAgICBrZXkgPSAnXFx4MWJbMjN+JztcbiAgICAgICAgYnJlYWs7XG4gICAgICAgIC8vIEYxMlxuICAgIGNhc2UgMTIzOlxuICAgICAgICBrZXkgPSAnXFx4MWJbMjR+JztcbiAgICAgICAgYnJlYWs7XG4gICAgZGVmYXVsdDpcbiAgICAgICAgLy8gYS16IGFuZCBzcGFjZVxuICAgICAgICBpZiAoZXYuY3RybEtleSkge1xuICAgICAgICAgICAgaWYgKGV2LmtleUNvZGUgPj0gNjUgJiYgZXYua2V5Q29kZSA8PSA5MCkge1xuICAgICAgICAgICAgICAgIGtleSA9IFN0cmluZy5mcm9tQ2hhckNvZGUoZXYua2V5Q29kZSAtIDY0KTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZXYua2V5Q29kZSA9PT0gMzIpIHtcbiAgICAgICAgICAgICAgICAvLyBOVUxcbiAgICAgICAgICAgICAgICBrZXkgPSBTdHJpbmcuZnJvbUNoYXJDb2RlKDApO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChldi5rZXlDb2RlID49IDUxICYmIGV2LmtleUNvZGUgPD0gNTUpIHtcbiAgICAgICAgICAgICAgICAvLyBlc2NhcGUsIGZpbGUgc2VwLCBncm91cCBzZXAsIHJlY29yZCBzZXAsIHVuaXQgc2VwXG4gICAgICAgICAgICAgICAga2V5ID0gU3RyaW5nLmZyb21DaGFyQ29kZShldi5rZXlDb2RlIC0gNTEgKyAyNyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGV2LmtleUNvZGUgPT09IDU2KSB7XG4gICAgICAgICAgICAgICAgLy8gZGVsZXRlXG4gICAgICAgICAgICAgICAga2V5ID0gU3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChldi5rZXlDb2RlID09PSAyMTkpIHtcbiAgICAgICAgICAgICAgICAvLyBeWyAtIGVzY2FwZVxuICAgICAgICAgICAgICAgIGtleSA9IFN0cmluZy5mcm9tQ2hhckNvZGUoMjcpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChldi5rZXlDb2RlID09PSAyMjEpIHtcbiAgICAgICAgICAgICAgICAvLyBeXSAtIGdyb3VwIHNlcFxuICAgICAgICAgICAgICAgIGtleSA9IFN0cmluZy5mcm9tQ2hhckNvZGUoMjkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKCghaXNNYWMgJiYgZXYuYWx0S2V5KSB8fCAoaXNNYWMgJiYgZXYubWV0YUtleSkpIHtcbiAgICAgICAgICAgIGlmIChldi5rZXlDb2RlID49IDY1ICYmIGV2LmtleUNvZGUgPD0gOTApIHtcbiAgICAgICAgICAgICAgICBrZXkgPSAnXFx4MWInICsgU3RyaW5nLmZyb21DaGFyQ29kZShldi5rZXlDb2RlICsgMzIpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChldi5rZXlDb2RlID09PSAxOTIpIHtcbiAgICAgICAgICAgICAgICBrZXkgPSAnXFx4MWJgJztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZXYua2V5Q29kZSA+PSA0OCAmJiBldi5rZXlDb2RlIDw9IDU3KSB7XG4gICAgICAgICAgICAgICAga2V5ID0gJ1xceDFiJyArIChldi5rZXlDb2RlIC0gNDgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIHRoaXMuZW1pdCgna2V5ZG93bicsIGV2KTtcblxuICAgIGlmIChrZXkpIHtcbiAgICAgICAgdGhpcy5lbWl0KCdrZXknLCBrZXksIGV2KTtcblxuICAgICAgICB0aGlzLnNob3dDdXJzb3IoKTtcbiAgICAgICAgdGhpcy5oYW5kbGVyKGtleSk7XG5cbiAgICAgICAgcmV0dXJuIGNhbmNlbChldik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWU7XG59O1xuXG5UZXJtaW5hbC5wcm90b3R5cGUuc2V0Z0xldmVsID0gZnVuY3Rpb24oZykge1xuICAgIHRoaXMuZ2xldmVsID0gZztcbiAgICB0aGlzLmNoYXJzZXQgPSB0aGlzLmNoYXJzZXRzW2ddO1xufTtcblxuVGVybWluYWwucHJvdG90eXBlLnNldGdDaGFyc2V0ID0gZnVuY3Rpb24oZywgY2hhcnNldCkge1xuICAgIHRoaXMuY2hhcnNldHNbZ10gPSBjaGFyc2V0O1xuICAgIGlmICh0aGlzLmdsZXZlbCA9PT0gZykge1xuICAgICAgICB0aGlzLmNoYXJzZXQgPSBjaGFyc2V0O1xuICAgIH1cbn07XG5cblRlcm1pbmFsLnByb3RvdHlwZS5rZXlQcmVzcyA9IGZ1bmN0aW9uKGV2KSB7XG4gICAgdmFyIGtleTtcblxuICAgIGNhbmNlbChldik7XG5cbiAgICBpZiAoZXYuY2hhckNvZGUpIHtcbiAgICAgICAga2V5ID0gZXYuY2hhckNvZGU7XG4gICAgfSBlbHNlIGlmIChldi53aGljaCA9PSBudWxsKSB7XG4gICAgICAgIGtleSA9IGV2LmtleUNvZGU7XG4gICAgfSBlbHNlIGlmIChldi53aGljaCAhPT0gMCAmJiBldi5jaGFyQ29kZSAhPT0gMCkge1xuICAgICAgICBrZXkgPSBldi53aGljaDtcbiAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgaWYgKCFrZXkgfHwgZXYuY3RybEtleSB8fCBldi5hbHRLZXkgfHwgZXYubWV0YUtleSkgcmV0dXJuIGZhbHNlO1xuXG4gICAga2V5ID0gU3RyaW5nLmZyb21DaGFyQ29kZShrZXkpO1xuXG4gICAgdGhpcy5lbWl0KCdrZXlwcmVzcycsIGtleSwgZXYpO1xuICAgIHRoaXMuZW1pdCgna2V5Jywga2V5LCBldik7XG5cbiAgICB0aGlzLnNob3dDdXJzb3IoKTtcbiAgICB0aGlzLmhhbmRsZXIoa2V5KTtcblxuICAgIHJldHVybiBmYWxzZTtcbn07XG5cblRlcm1pbmFsLnByb3RvdHlwZS5zZW5kID0gZnVuY3Rpb24oZGF0YSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIGlmICghdGhpcy5xdWV1ZSkge1xuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgc2VsZi5oYW5kbGVyKHNlbGYucXVldWUpO1xuICAgICAgICAgICAgc2VsZi5xdWV1ZSA9ICcnO1xuICAgICAgICB9LCAxKTtcbiAgICB9XG5cbiAgICB0aGlzLnF1ZXVlICs9IGRhdGE7XG59O1xuXG5UZXJtaW5hbC5wcm90b3R5cGUuYmVsbCA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICghVGVybWluYWwudmlzdWFsQmVsbCkgcmV0dXJuO1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB0aGlzLmVsZW1lbnQuc3R5bGUuYm9yZGVyQ29sb3IgPSAnd2hpdGUnO1xuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgIHNlbGYuZWxlbWVudC5zdHlsZS5ib3JkZXJDb2xvciA9ICcnO1xuICAgIH0sIDEwKTtcbiAgICBpZiAoVGVybWluYWwucG9wT25CZWxsKSB0aGlzLmZvY3VzKCk7XG59O1xuXG5UZXJtaW5hbC5wcm90b3R5cGUubG9nID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKCFUZXJtaW5hbC5kZWJ1ZykgcmV0dXJuO1xuICAgIGlmICghd2luZG93LmNvbnNvbGUgfHwgIXdpbmRvdy5jb25zb2xlLmxvZykgcmV0dXJuO1xuICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKTtcbiAgICB3aW5kb3cuY29uc29sZS5sb2cuYXBwbHkod2luZG93LmNvbnNvbGUsIGFyZ3MpO1xufTtcblxuVGVybWluYWwucHJvdG90eXBlLmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKCFUZXJtaW5hbC5kZWJ1ZykgcmV0dXJuO1xuICAgIGlmICghd2luZG93LmNvbnNvbGUgfHwgIXdpbmRvdy5jb25zb2xlLmVycm9yKSByZXR1cm47XG4gICAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpO1xuICAgIHdpbmRvdy5jb25zb2xlLmVycm9yLmFwcGx5KHdpbmRvdy5jb25zb2xlLCBhcmdzKTtcbn07XG5cblRlcm1pbmFsLnByb3RvdHlwZS5yZXNpemUgPSBmdW5jdGlvbih4LCB5KSB7XG4gICAgdmFyIGxpbmUsIGVsLCBpLCBqLCBjaDtcblxuICAgIGlmICh4IDwgMSkgeCA9IDE7XG4gICAgaWYgKHkgPCAxKSB5ID0gMTtcblxuICAgIC8vIHJlc2l6ZSBjb2xzXG4gICAgaiA9IHRoaXMuY29scztcbiAgICBpZiAoaiA8IHgpIHtcbiAgICAgICAgY2ggPSBbdGhpcy5kZWZBdHRyLCAnICddO1xuICAgICAgICBpID0gdGhpcy5saW5lcy5sZW5ndGg7XG4gICAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgICAgIHdoaWxlICh0aGlzLmxpbmVzW2ldLmxlbmd0aCA8IHgpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxpbmVzW2ldLnB1c2goY2gpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSBlbHNlIGlmIChqID4geCkge1xuICAgICAgICBpID0gdGhpcy5saW5lcy5sZW5ndGg7XG4gICAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgICAgIHdoaWxlICh0aGlzLmxpbmVzW2ldLmxlbmd0aCA+IHgpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxpbmVzW2ldLnBvcCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHRoaXMuc2V0dXBTdG9wcyhqKTtcbiAgICB0aGlzLmNvbHMgPSB4O1xuXG4gICAgLy8gcmVzaXplIHJvd3NcbiAgICBqID0gdGhpcy5yb3dzO1xuICAgIGlmIChqIDwgeSkge1xuICAgICAgICBlbCA9IHRoaXMuZWxlbWVudDtcbiAgICAgICAgd2hpbGUgKGorKyA8IHkpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmxpbmVzLmxlbmd0aCA8IHkgKyB0aGlzLnliYXNlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5saW5lcy5wdXNoKHRoaXMuYmxhbmtMaW5lKCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMuY2hpbGRyZW4ubGVuZ3RoIDwgeSkge1xuICAgICAgICAgICAgICAgIGxpbmUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICAgICAgICAgICAgICBlbC5hcHBlbmRDaGlsZChsaW5lKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNoaWxkcmVuLnB1c2gobGluZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGogPiB5KSB7XG4gICAgICAgIHdoaWxlIChqLS0gPiB5KSB7XG4gICAgICAgICAgICBpZiAodGhpcy5saW5lcy5sZW5ndGggPiB5ICsgdGhpcy55YmFzZSkge1xuICAgICAgICAgICAgICAgIHRoaXMubGluZXMucG9wKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGhpcy5jaGlsZHJlbi5sZW5ndGggPiB5KSB7XG4gICAgICAgICAgICAgICAgZWwgPSB0aGlzLmNoaWxkcmVuLnBvcCgpO1xuICAgICAgICAgICAgICAgIGlmICghZWwpIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIGVsLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHRoaXMucm93cyA9IHk7XG5cbiAgICAvLyBtYWtlIHN1cmUgdGhlIGN1cnNvciBzdGF5cyBvbiBzY3JlZW5cbiAgICBpZiAodGhpcy55ID49IHkpIHRoaXMueSA9IHkgLSAxO1xuICAgIGlmICh0aGlzLnggPj0geCkgdGhpcy54ID0geCAtIDE7XG5cbiAgICB0aGlzLnNjcm9sbFRvcCA9IDA7XG4gICAgdGhpcy5zY3JvbGxCb3R0b20gPSB5IC0gMTtcblxuICAgIHRoaXMucmVmcmVzaCgwLCB0aGlzLnJvd3MgLSAxKTtcblxuICAgIC8vIGl0J3MgYSByZWFsIG5pZ2h0bWFyZSB0cnlpbmdcbiAgICAvLyB0byByZXNpemUgdGhlIG9yaWdpbmFsXG4gICAgLy8gc2NyZWVuIGJ1ZmZlci4ganVzdCBzZXQgaXRcbiAgICAvLyB0byBudWxsIGZvciBub3cuXG4gICAgdGhpcy5ub3JtYWwgPSBudWxsO1xufTtcblxuVGVybWluYWwucHJvdG90eXBlLnVwZGF0ZVJhbmdlID0gZnVuY3Rpb24oeSkge1xuICAgIGlmICh5IDwgdGhpcy5yZWZyZXNoU3RhcnQpIHRoaXMucmVmcmVzaFN0YXJ0ID0geTtcbiAgICBpZiAoeSA+IHRoaXMucmVmcmVzaEVuZCkgdGhpcy5yZWZyZXNoRW5kID0geTtcbn07XG5cblRlcm1pbmFsLnByb3RvdHlwZS5tYXhSYW5nZSA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucmVmcmVzaFN0YXJ0ID0gMDtcbiAgICB0aGlzLnJlZnJlc2hFbmQgPSB0aGlzLnJvd3MgLSAxO1xufTtcblxuVGVybWluYWwucHJvdG90eXBlLnNldHVwU3RvcHMgPSBmdW5jdGlvbihpKSB7XG4gICAgaWYgKGkgIT0gbnVsbCkge1xuICAgICAgICBpZiAoIXRoaXMudGFic1tpXSkge1xuICAgICAgICAgICAgaSA9IHRoaXMucHJldlN0b3AoaSk7XG4gICAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnRhYnMgPSB7fTtcbiAgICAgICAgaSA9IDA7XG4gICAgfVxuXG4gICAgZm9yICg7IGkgPCB0aGlzLmNvbHM7IGkgKz0gOCkge1xuICAgICAgICB0aGlzLnRhYnNbaV0gPSB0cnVlO1xuICAgIH1cbn07XG5cblRlcm1pbmFsLnByb3RvdHlwZS5wcmV2U3RvcCA9IGZ1bmN0aW9uKHgpIHtcbiAgICBpZiAoeCA9PSBudWxsKSB4ID0gdGhpcy54O1xuICAgIHdoaWxlICghdGhpcy50YWJzWy0teF0gJiYgeCA+IDApO1xuICAgIHJldHVybiB4ID49IHRoaXMuY29scyA/IHRoaXMuY29scyAtIDEgOiB4IDwgMCA/IDAgOiB4O1xufTtcblxuVGVybWluYWwucHJvdG90eXBlLm5leHRTdG9wID0gZnVuY3Rpb24oeCkge1xuICAgIGlmICh4ID09IG51bGwpIHggPSB0aGlzLng7XG4gICAgd2hpbGUgKCF0aGlzLnRhYnNbKyt4XSAmJiB4IDwgdGhpcy5jb2xzKTtcbiAgICByZXR1cm4geCA+PSB0aGlzLmNvbHMgPyB0aGlzLmNvbHMgLSAxIDogeCA8IDAgPyAwIDogeDtcbn07XG5cblRlcm1pbmFsLnByb3RvdHlwZS5lcmFzZVJpZ2h0ID0gZnVuY3Rpb24oeCwgeSkge1xuICAgIHZhciBsaW5lID0gdGhpcy5saW5lc1t0aGlzLnliYXNlICsgeV0sXG4gICAgICAgIGNoID0gW3RoaXMuY3VyQXR0ciwgJyAnXTsgLy8geHRlcm1cblxuICAgIGZvciAoOyB4IDwgdGhpcy5jb2xzOyB4KyspIHtcbiAgICAgICAgbGluZVt4XSA9IGNoO1xuICAgIH1cblxuICAgIHRoaXMudXBkYXRlUmFuZ2UoeSk7XG59O1xuXG5UZXJtaW5hbC5wcm90b3R5cGUuZXJhc2VMZWZ0ID0gZnVuY3Rpb24oeCwgeSkge1xuICAgIHZhciBsaW5lID0gdGhpcy5saW5lc1t0aGlzLnliYXNlICsgeV0sXG4gICAgICAgIGNoID0gW3RoaXMuY3VyQXR0ciwgJyAnXTsgLy8geHRlcm1cblxuICAgIHgrKztcbiAgICB3aGlsZSAoeC0tKSBsaW5lW3hdID0gY2g7XG5cbiAgICB0aGlzLnVwZGF0ZVJhbmdlKHkpO1xufTtcblxuVGVybWluYWwucHJvdG90eXBlLmVyYXNlTGluZSA9IGZ1bmN0aW9uKHkpIHtcbiAgICB0aGlzLmVyYXNlUmlnaHQoMCwgeSk7XG59O1xuXG5UZXJtaW5hbC5wcm90b3R5cGUuYmxhbmtMaW5lID0gZnVuY3Rpb24oY3VyKSB7XG4gICAgdmFyIGF0dHIgPSBjdXIgPyB0aGlzLmN1ckF0dHIgOiB0aGlzLmRlZkF0dHI7XG5cbiAgICB2YXIgY2ggPSBbYXR0ciwgJyAnXSxcbiAgICAgICAgbGluZSA9IFtdLFxuICAgICAgICBpID0gMDtcblxuICAgIGZvciAoOyBpIDwgdGhpcy5jb2xzOyBpKyspIHtcbiAgICAgICAgbGluZVtpXSA9IGNoO1xuICAgIH1cblxuICAgIHJldHVybiBsaW5lO1xufTtcblxuVGVybWluYWwucHJvdG90eXBlLmNoID0gZnVuY3Rpb24oY3VyKSB7XG4gICAgcmV0dXJuIGN1ciA/IFt0aGlzLmN1ckF0dHIsICcgJ10gOiBbdGhpcy5kZWZBdHRyLCAnICddO1xufTtcblxuVGVybWluYWwucHJvdG90eXBlLmlzID0gZnVuY3Rpb24odGVybSkge1xuICAgIHZhciBuYW1lID0gdGhpcy50ZXJtTmFtZSB8fCBUZXJtaW5hbC50ZXJtTmFtZTtcbiAgICByZXR1cm4gKG5hbWUgKyAnJylcbiAgICAgICAgLmluZGV4T2YodGVybSkgPT09IDA7XG59O1xuXG5UZXJtaW5hbC5wcm90b3R5cGUuaGFuZGxlciA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB0aGlzLmVtaXQoJ2RhdGEnLCBkYXRhKTtcbn07XG5cblRlcm1pbmFsLnByb3RvdHlwZS5oYW5kbGVUaXRsZSA9IGZ1bmN0aW9uKHRpdGxlKSB7XG4gICAgdGhpcy5lbWl0KCd0aXRsZScsIHRpdGxlKTtcbn07XG5cbi8qKlxuKiBFU0NcbiovXG5cbi8vIEVTQyBEIEluZGV4IChJTkQgaXMgMHg4NCkuXG5UZXJtaW5hbC5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnkrKztcbiAgICBpZiAodGhpcy55ID4gdGhpcy5zY3JvbGxCb3R0b20pIHtcbiAgICAgICAgdGhpcy55LS07XG4gICAgICAgIHRoaXMuc2Nyb2xsKCk7XG4gICAgfVxuICAgIHRoaXMuc3RhdGUgPSBub3JtYWw7XG59O1xuXG4vLyBFU0MgTSBSZXZlcnNlIEluZGV4IChSSSBpcyAweDhkKS5cblRlcm1pbmFsLnByb3RvdHlwZS5yZXZlcnNlSW5kZXggPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgajtcbiAgICB0aGlzLnktLTtcbiAgICBpZiAodGhpcy55IDwgdGhpcy5zY3JvbGxUb3ApIHtcbiAgICAgICAgdGhpcy55Kys7XG4gICAgICAgIC8vIHBvc3NpYmx5IG1vdmUgdGhlIGNvZGUgYmVsb3cgdG8gdGVybS5yZXZlcnNlU2Nyb2xsKCk7XG4gICAgICAgIC8vIHRlc3Q6IGVjaG8gLW5lICdcXGVbMTsxSFxcZVs0NG1cXGVNXFxlWzBtJ1xuICAgICAgICAvLyBibGFua0xpbmUodHJ1ZSkgaXMgeHRlcm0vbGludXggYmVoYXZpb3JcbiAgICAgICAgdGhpcy5saW5lcy5zcGxpY2UodGhpcy55ICsgdGhpcy55YmFzZSwgMCwgdGhpcy5ibGFua0xpbmUodHJ1ZSkpO1xuICAgICAgICBqID0gdGhpcy5yb3dzIC0gMSAtIHRoaXMuc2Nyb2xsQm90dG9tO1xuICAgICAgICB0aGlzLmxpbmVzLnNwbGljZSh0aGlzLnJvd3MgLSAxICsgdGhpcy55YmFzZSAtIGogKyAxLCAxKTtcbiAgICAgICAgLy8gdGhpcy5tYXhSYW5nZSgpO1xuICAgICAgICB0aGlzLnVwZGF0ZVJhbmdlKHRoaXMuc2Nyb2xsVG9wKTtcbiAgICAgICAgdGhpcy51cGRhdGVSYW5nZSh0aGlzLnNjcm9sbEJvdHRvbSk7XG4gICAgfVxuICAgIHRoaXMuc3RhdGUgPSBub3JtYWw7XG59O1xuXG4vLyBFU0MgYyBGdWxsIFJlc2V0IChSSVMpLlxuVGVybWluYWwucHJvdG90eXBlLnJlc2V0ID0gZnVuY3Rpb24oKSB7XG4gICAgVGVybWluYWwuY2FsbCh0aGlzLCB0aGlzLmNvbHMsIHRoaXMucm93cyk7XG4gICAgdGhpcy5yZWZyZXNoKDAsIHRoaXMucm93cyAtIDEpO1xufTtcblxuLy8gRVNDIEggVGFiIFNldCAoSFRTIGlzIDB4ODgpLlxuVGVybWluYWwucHJvdG90eXBlLnRhYlNldCA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudGFic1t0aGlzLnhdID0gdHJ1ZTtcbiAgICB0aGlzLnN0YXRlID0gbm9ybWFsO1xufTtcblxuLyoqXG4qIENTSVxuKi9cblxuLy8gQ1NJIFBzIEFcbi8vIEN1cnNvciBVcCBQcyBUaW1lcyAoZGVmYXVsdCA9IDEpIChDVVUpLlxuVGVybWluYWwucHJvdG90eXBlLmN1cnNvclVwID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gICAgdmFyIHBhcmFtID0gcGFyYW1zWzBdO1xuICAgIGlmIChwYXJhbSA8IDEpIHBhcmFtID0gMTtcbiAgICB0aGlzLnkgLT0gcGFyYW07XG4gICAgaWYgKHRoaXMueSA8IDApIHRoaXMueSA9IDA7XG59O1xuXG4vLyBDU0kgUHMgQlxuLy8gQ3Vyc29yIERvd24gUHMgVGltZXMgKGRlZmF1bHQgPSAxKSAoQ1VEKS5cblRlcm1pbmFsLnByb3RvdHlwZS5jdXJzb3JEb3duID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gICAgdmFyIHBhcmFtID0gcGFyYW1zWzBdO1xuICAgIGlmIChwYXJhbSA8IDEpIHBhcmFtID0gMTtcbiAgICB0aGlzLnkgKz0gcGFyYW07XG4gICAgaWYgKHRoaXMueSA+PSB0aGlzLnJvd3MpIHtcbiAgICAgICAgdGhpcy55ID0gdGhpcy5yb3dzIC0gMTtcbiAgICB9XG59O1xuXG4vLyBDU0kgUHMgQ1xuLy8gQ3Vyc29yIEZvcndhcmQgUHMgVGltZXMgKGRlZmF1bHQgPSAxKSAoQ1VGKS5cblRlcm1pbmFsLnByb3RvdHlwZS5jdXJzb3JGb3J3YXJkID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gICAgdmFyIHBhcmFtID0gcGFyYW1zWzBdO1xuICAgIGlmIChwYXJhbSA8IDEpIHBhcmFtID0gMTtcbiAgICB0aGlzLnggKz0gcGFyYW07XG4gICAgaWYgKHRoaXMueCA+PSB0aGlzLmNvbHMpIHtcbiAgICAgICAgdGhpcy54ID0gdGhpcy5jb2xzIC0gMTtcbiAgICB9XG59O1xuXG4vLyBDU0kgUHMgRFxuLy8gQ3Vyc29yIEJhY2t3YXJkIFBzIFRpbWVzIChkZWZhdWx0ID0gMSkgKENVQikuXG5UZXJtaW5hbC5wcm90b3R5cGUuY3Vyc29yQmFja3dhcmQgPSBmdW5jdGlvbihwYXJhbXMpIHtcbiAgICB2YXIgcGFyYW0gPSBwYXJhbXNbMF07XG4gICAgaWYgKHBhcmFtIDwgMSkgcGFyYW0gPSAxO1xuICAgIHRoaXMueCAtPSBwYXJhbTtcbiAgICBpZiAodGhpcy54IDwgMCkgdGhpcy54ID0gMDtcbn07XG5cbi8vIENTSSBQcyA7IFBzIEhcbi8vIEN1cnNvciBQb3NpdGlvbiBbcm93O2NvbHVtbl0gKGRlZmF1bHQgPSBbMSwxXSkgKENVUCkuXG5UZXJtaW5hbC5wcm90b3R5cGUuY3Vyc29yUG9zID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gICAgdmFyIHJvdywgY29sO1xuXG4gICAgcm93ID0gcGFyYW1zWzBdIC0gMTtcblxuICAgIGlmIChwYXJhbXMubGVuZ3RoID49IDIpIHtcbiAgICAgICAgY29sID0gcGFyYW1zWzFdIC0gMTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBjb2wgPSAwO1xuICAgIH1cblxuICAgIGlmIChyb3cgPCAwKSB7XG4gICAgICAgIHJvdyA9IDA7XG4gICAgfSBlbHNlIGlmIChyb3cgPj0gdGhpcy5yb3dzKSB7XG4gICAgICAgIHJvdyA9IHRoaXMucm93cyAtIDE7XG4gICAgfVxuXG4gICAgaWYgKGNvbCA8IDApIHtcbiAgICAgICAgY29sID0gMDtcbiAgICB9IGVsc2UgaWYgKGNvbCA+PSB0aGlzLmNvbHMpIHtcbiAgICAgICAgY29sID0gdGhpcy5jb2xzIC0gMTtcbiAgICB9XG5cbiAgICB0aGlzLnggPSBjb2w7XG4gICAgdGhpcy55ID0gcm93O1xufTtcblxuLy8gQ1NJIFBzIEogRXJhc2UgaW4gRGlzcGxheSAoRUQpLlxuLy8gUHMgPSAwIC0+IEVyYXNlIEJlbG93IChkZWZhdWx0KS5cbi8vIFBzID0gMSAtPiBFcmFzZSBBYm92ZS5cbi8vIFBzID0gMiAtPiBFcmFzZSBBbGwuXG4vLyBQcyA9IDMgLT4gRXJhc2UgU2F2ZWQgTGluZXMgKHh0ZXJtKS5cbi8vIENTSSA/IFBzIEpcbi8vIEVyYXNlIGluIERpc3BsYXkgKERFQ1NFRCkuXG4vLyBQcyA9IDAgLT4gU2VsZWN0aXZlIEVyYXNlIEJlbG93IChkZWZhdWx0KS5cbi8vIFBzID0gMSAtPiBTZWxlY3RpdmUgRXJhc2UgQWJvdmUuXG4vLyBQcyA9IDIgLT4gU2VsZWN0aXZlIEVyYXNlIEFsbC5cblRlcm1pbmFsLnByb3RvdHlwZS5lcmFzZUluRGlzcGxheSA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICAgIHZhciBqO1xuICAgIHN3aXRjaCAocGFyYW1zWzBdKSB7XG4gICAgY2FzZSAwOlxuICAgICAgICB0aGlzLmVyYXNlUmlnaHQodGhpcy54LCB0aGlzLnkpO1xuICAgICAgICBqID0gdGhpcy55ICsgMTtcbiAgICAgICAgZm9yICg7IGogPCB0aGlzLnJvd3M7IGorKykge1xuICAgICAgICAgICAgdGhpcy5lcmFzZUxpbmUoaik7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgY2FzZSAxOlxuICAgICAgICB0aGlzLmVyYXNlTGVmdCh0aGlzLngsIHRoaXMueSk7XG4gICAgICAgIGogPSB0aGlzLnk7XG4gICAgICAgIHdoaWxlIChqLS0pIHtcbiAgICAgICAgICAgIHRoaXMuZXJhc2VMaW5lKGopO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIGNhc2UgMjpcbiAgICAgICAgaiA9IHRoaXMucm93cztcbiAgICAgICAgd2hpbGUgKGotLSkgdGhpcy5lcmFzZUxpbmUoaik7XG4gICAgICAgIGJyZWFrO1xuICAgIGNhc2UgMzpcbiAgICAgICAgOyAvLyBubyBzYXZlZCBsaW5lc1xuICAgICAgICBicmVhaztcbiAgICB9XG4gICAgdGhpcy5lbWl0KCdlcmFzZScsIHtcbiAgICAgICAgMDogJ2JlbG93JyxcbiAgICAgICAgMTogJ2Fib3ZlJyxcbiAgICAgICAgMjogJ2FsbCcsXG4gICAgICAgIDM6ICdzYXZlZCdcbiAgICB9W3BhcmFtc10pO1xufTtcblxuLy8gQ1NJIFBzIEsgRXJhc2UgaW4gTGluZSAoRUwpLlxuLy8gUHMgPSAwIC0+IEVyYXNlIHRvIFJpZ2h0IChkZWZhdWx0KS5cbi8vIFBzID0gMSAtPiBFcmFzZSB0byBMZWZ0LlxuLy8gUHMgPSAyIC0+IEVyYXNlIEFsbC5cbi8vIENTSSA/IFBzIEtcbi8vIEVyYXNlIGluIExpbmUgKERFQ1NFTCkuXG4vLyBQcyA9IDAgLT4gU2VsZWN0aXZlIEVyYXNlIHRvIFJpZ2h0IChkZWZhdWx0KS5cbi8vIFBzID0gMSAtPiBTZWxlY3RpdmUgRXJhc2UgdG8gTGVmdC5cbi8vIFBzID0gMiAtPiBTZWxlY3RpdmUgRXJhc2UgQWxsLlxuVGVybWluYWwucHJvdG90eXBlLmVyYXNlSW5MaW5lID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gICAgc3dpdGNoIChwYXJhbXNbMF0pIHtcbiAgICBjYXNlIDA6XG4gICAgICAgIHRoaXMuZXJhc2VSaWdodCh0aGlzLngsIHRoaXMueSk7XG4gICAgICAgIGJyZWFrO1xuICAgIGNhc2UgMTpcbiAgICAgICAgdGhpcy5lcmFzZUxlZnQodGhpcy54LCB0aGlzLnkpO1xuICAgICAgICBicmVhaztcbiAgICBjYXNlIDI6XG4gICAgICAgIHRoaXMuZXJhc2VMaW5lKHRoaXMueSk7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbn07XG5cbi8vIENTSSBQbSBtIENoYXJhY3RlciBBdHRyaWJ1dGVzIChTR1IpLlxuLy8gUHMgPSAwIC0+IE5vcm1hbCAoZGVmYXVsdCkuXG4vLyBQcyA9IDEgLT4gQm9sZC5cbi8vIFBzID0gNCAtPiBVbmRlcmxpbmVkLlxuLy8gUHMgPSA1IC0+IEJsaW5rIChhcHBlYXJzIGFzIEJvbGQpLlxuLy8gUHMgPSA3IC0+IEludmVyc2UuXG4vLyBQcyA9IDggLT4gSW52aXNpYmxlLCBpLmUuLCBoaWRkZW4gKFZUMzAwKS5cbi8vIFBzID0gMiAyIC0+IE5vcm1hbCAobmVpdGhlciBib2xkIG5vciBmYWludCkuXG4vLyBQcyA9IDIgNCAtPiBOb3QgdW5kZXJsaW5lZC5cbi8vIFBzID0gMiA1IC0+IFN0ZWFkeSAobm90IGJsaW5raW5nKS5cbi8vIFBzID0gMiA3IC0+IFBvc2l0aXZlIChub3QgaW52ZXJzZSkuXG4vLyBQcyA9IDIgOCAtPiBWaXNpYmxlLCBpLmUuLCBub3QgaGlkZGVuIChWVDMwMCkuXG4vLyBQcyA9IDMgMCAtPiBTZXQgZm9yZWdyb3VuZCBjb2xvciB0byBCbGFjay5cbi8vIFBzID0gMyAxIC0+IFNldCBmb3JlZ3JvdW5kIGNvbG9yIHRvIFJlZC5cbi8vIFBzID0gMyAyIC0+IFNldCBmb3JlZ3JvdW5kIGNvbG9yIHRvIEdyZWVuLlxuLy8gUHMgPSAzIDMgLT4gU2V0IGZvcmVncm91bmQgY29sb3IgdG8gWWVsbG93LlxuLy8gUHMgPSAzIDQgLT4gU2V0IGZvcmVncm91bmQgY29sb3IgdG8gQmx1ZS5cbi8vIFBzID0gMyA1IC0+IFNldCBmb3JlZ3JvdW5kIGNvbG9yIHRvIE1hZ2VudGEuXG4vLyBQcyA9IDMgNiAtPiBTZXQgZm9yZWdyb3VuZCBjb2xvciB0byBDeWFuLlxuLy8gUHMgPSAzIDcgLT4gU2V0IGZvcmVncm91bmQgY29sb3IgdG8gV2hpdGUuXG4vLyBQcyA9IDMgOSAtPiBTZXQgZm9yZWdyb3VuZCBjb2xvciB0byBkZWZhdWx0IChvcmlnaW5hbCkuXG4vLyBQcyA9IDQgMCAtPiBTZXQgYmFja2dyb3VuZCBjb2xvciB0byBCbGFjay5cbi8vIFBzID0gNCAxIC0+IFNldCBiYWNrZ3JvdW5kIGNvbG9yIHRvIFJlZC5cbi8vIFBzID0gNCAyIC0+IFNldCBiYWNrZ3JvdW5kIGNvbG9yIHRvIEdyZWVuLlxuLy8gUHMgPSA0IDMgLT4gU2V0IGJhY2tncm91bmQgY29sb3IgdG8gWWVsbG93LlxuLy8gUHMgPSA0IDQgLT4gU2V0IGJhY2tncm91bmQgY29sb3IgdG8gQmx1ZS5cbi8vIFBzID0gNCA1IC0+IFNldCBiYWNrZ3JvdW5kIGNvbG9yIHRvIE1hZ2VudGEuXG4vLyBQcyA9IDQgNiAtPiBTZXQgYmFja2dyb3VuZCBjb2xvciB0byBDeWFuLlxuLy8gUHMgPSA0IDcgLT4gU2V0IGJhY2tncm91bmQgY29sb3IgdG8gV2hpdGUuXG4vLyBQcyA9IDQgOSAtPiBTZXQgYmFja2dyb3VuZCBjb2xvciB0byBkZWZhdWx0IChvcmlnaW5hbCkuXG5cbi8vIElmIDE2LWNvbG9yIHN1cHBvcnQgaXMgY29tcGlsZWQsIHRoZSBmb2xsb3dpbmcgYXBwbHkuIEFzc3VtZVxuLy8gdGhhdCB4dGVybSdzIHJlc291cmNlcyBhcmUgc2V0IHNvIHRoYXQgdGhlIElTTyBjb2xvciBjb2RlcyBhcmVcbi8vIHRoZSBmaXJzdCA4IG9mIGEgc2V0IG9mIDE2LiBUaGVuIHRoZSBhaXh0ZXJtIGNvbG9ycyBhcmUgdGhlXG4vLyBicmlnaHQgdmVyc2lvbnMgb2YgdGhlIElTTyBjb2xvcnM6XG4vLyBQcyA9IDkgMCAtPiBTZXQgZm9yZWdyb3VuZCBjb2xvciB0byBCbGFjay5cbi8vIFBzID0gOSAxIC0+IFNldCBmb3JlZ3JvdW5kIGNvbG9yIHRvIFJlZC5cbi8vIFBzID0gOSAyIC0+IFNldCBmb3JlZ3JvdW5kIGNvbG9yIHRvIEdyZWVuLlxuLy8gUHMgPSA5IDMgLT4gU2V0IGZvcmVncm91bmQgY29sb3IgdG8gWWVsbG93LlxuLy8gUHMgPSA5IDQgLT4gU2V0IGZvcmVncm91bmQgY29sb3IgdG8gQmx1ZS5cbi8vIFBzID0gOSA1IC0+IFNldCBmb3JlZ3JvdW5kIGNvbG9yIHRvIE1hZ2VudGEuXG4vLyBQcyA9IDkgNiAtPiBTZXQgZm9yZWdyb3VuZCBjb2xvciB0byBDeWFuLlxuLy8gUHMgPSA5IDcgLT4gU2V0IGZvcmVncm91bmQgY29sb3IgdG8gV2hpdGUuXG4vLyBQcyA9IDEgMCAwIC0+IFNldCBiYWNrZ3JvdW5kIGNvbG9yIHRvIEJsYWNrLlxuLy8gUHMgPSAxIDAgMSAtPiBTZXQgYmFja2dyb3VuZCBjb2xvciB0byBSZWQuXG4vLyBQcyA9IDEgMCAyIC0+IFNldCBiYWNrZ3JvdW5kIGNvbG9yIHRvIEdyZWVuLlxuLy8gUHMgPSAxIDAgMyAtPiBTZXQgYmFja2dyb3VuZCBjb2xvciB0byBZZWxsb3cuXG4vLyBQcyA9IDEgMCA0IC0+IFNldCBiYWNrZ3JvdW5kIGNvbG9yIHRvIEJsdWUuXG4vLyBQcyA9IDEgMCA1IC0+IFNldCBiYWNrZ3JvdW5kIGNvbG9yIHRvIE1hZ2VudGEuXG4vLyBQcyA9IDEgMCA2IC0+IFNldCBiYWNrZ3JvdW5kIGNvbG9yIHRvIEN5YW4uXG4vLyBQcyA9IDEgMCA3IC0+IFNldCBiYWNrZ3JvdW5kIGNvbG9yIHRvIFdoaXRlLlxuXG4vLyBJZiB4dGVybSBpcyBjb21waWxlZCB3aXRoIHRoZSAxNi1jb2xvciBzdXBwb3J0IGRpc2FibGVkLCBpdFxuLy8gc3VwcG9ydHMgdGhlIGZvbGxvd2luZywgZnJvbSByeHZ0OlxuLy8gUHMgPSAxIDAgMCAtPiBTZXQgZm9yZWdyb3VuZCBhbmQgYmFja2dyb3VuZCBjb2xvciB0b1xuLy8gZGVmYXVsdC5cblxuLy8gSWYgODgtIG9yIDI1Ni1jb2xvciBzdXBwb3J0IGlzIGNvbXBpbGVkLCB0aGUgZm9sbG93aW5nIGFwcGx5LlxuLy8gUHMgPSAzIDggOyA1IDsgUHMgLT4gU2V0IGZvcmVncm91bmQgY29sb3IgdG8gdGhlIHNlY29uZFxuLy8gUHMuXG4vLyBQcyA9IDQgOCA7IDUgOyBQcyAtPiBTZXQgYmFja2dyb3VuZCBjb2xvciB0byB0aGUgc2Vjb25kXG4vLyBQcy5cblRlcm1pbmFsLnByb3RvdHlwZS5jaGFyQXR0cmlidXRlcyA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICAgIHZhciBsID0gcGFyYW1zLmxlbmd0aCxcbiAgICAgICAgaSA9IDAsXG4gICAgICAgIGJnLCBmZywgcDtcblxuICAgIGZvciAoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIHAgPSBwYXJhbXNbaV07XG4gICAgICAgIGlmIChwID49IDMwICYmIHAgPD0gMzcpIHtcbiAgICAgICAgICAgIC8vIGZnIGNvbG9yIDhcbiAgICAgICAgICAgIHRoaXMuY3VyQXR0ciA9ICh0aGlzLmN1ckF0dHIgJiB+ICgweDFmZiA8PCA5KSkgfCAoKHAgLSAzMCkgPDwgOSk7XG4gICAgICAgIH0gZWxzZSBpZiAocCA+PSA0MCAmJiBwIDw9IDQ3KSB7XG4gICAgICAgICAgICAvLyBiZyBjb2xvciA4XG4gICAgICAgICAgICB0aGlzLmN1ckF0dHIgPSAodGhpcy5jdXJBdHRyICYgfjB4MWZmKSB8IChwIC0gNDApO1xuICAgICAgICB9IGVsc2UgaWYgKHAgPj0gOTAgJiYgcCA8PSA5Nykge1xuICAgICAgICAgICAgLy8gZmcgY29sb3IgMTZcbiAgICAgICAgICAgIHAgKz0gODtcbiAgICAgICAgICAgIHRoaXMuY3VyQXR0ciA9ICh0aGlzLmN1ckF0dHIgJiB+ICgweDFmZiA8PCA5KSkgfCAoKHAgLSA5MCkgPDwgOSk7XG4gICAgICAgIH0gZWxzZSBpZiAocCA+PSAxMDAgJiYgcCA8PSAxMDcpIHtcbiAgICAgICAgICAgIC8vIGJnIGNvbG9yIDE2XG4gICAgICAgICAgICBwICs9IDg7XG4gICAgICAgICAgICB0aGlzLmN1ckF0dHIgPSAodGhpcy5jdXJBdHRyICYgfjB4MWZmKSB8IChwIC0gMTAwKTtcbiAgICAgICAgfSBlbHNlIGlmIChwID09PSAwKSB7XG4gICAgICAgICAgICAvLyBkZWZhdWx0XG4gICAgICAgICAgICB0aGlzLmN1ckF0dHIgPSB0aGlzLmRlZkF0dHI7XG4gICAgICAgIH0gZWxzZSBpZiAocCA9PT0gMSkge1xuICAgICAgICAgICAgLy8gYm9sZCB0ZXh0XG4gICAgICAgICAgICB0aGlzLmN1ckF0dHIgPSB0aGlzLmN1ckF0dHIgfCAoMSA8PCAxOCk7XG4gICAgICAgIH0gZWxzZSBpZiAocCA9PT0gNCkge1xuICAgICAgICAgICAgLy8gdW5kZXJsaW5lZCB0ZXh0XG4gICAgICAgICAgICB0aGlzLmN1ckF0dHIgPSB0aGlzLmN1ckF0dHIgfCAoMiA8PCAxOCk7XG4gICAgICAgIH0gZWxzZSBpZiAocCA9PT0gNyB8fCBwID09PSAyNykge1xuICAgICAgICAgICAgLy8gaW52ZXJzZSBhbmQgcG9zaXRpdmVcbiAgICAgICAgICAgIC8vIHRlc3Qgd2l0aDogZWNobyAtZSAnXFxlWzMxbVxcZVs0Mm1oZWxsb1xcZVs3bXdvcmxkXFxlWzI3bWhpXFxlW20nXG4gICAgICAgICAgICBpZiAocCA9PT0gNykge1xuICAgICAgICAgICAgICAgIGlmICgodGhpcy5jdXJBdHRyID4+IDE4KSAmIDQpIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIHRoaXMuY3VyQXR0ciA9IHRoaXMuY3VyQXR0ciB8ICg0IDw8IDE4KTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAocCA9PT0gMjcpIHtcbiAgICAgICAgICAgICAgICBpZiAofiAodGhpcy5jdXJBdHRyID4+IDE4KSAmIDQpIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIHRoaXMuY3VyQXR0ciA9IHRoaXMuY3VyQXR0ciAmIH4gKDQgPDwgMTgpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBiZyA9IHRoaXMuY3VyQXR0ciAmIDB4MWZmO1xuICAgICAgICAgICAgZmcgPSAodGhpcy5jdXJBdHRyID4+IDkpICYgMHgxZmY7XG5cbiAgICAgICAgICAgIHRoaXMuY3VyQXR0ciA9ICh0aGlzLmN1ckF0dHIgJiB+MHgzZmZmZikgfCAoKGJnIDw8IDkpIHwgZmcpO1xuICAgICAgICB9IGVsc2UgaWYgKHAgPT09IDIyKSB7XG4gICAgICAgICAgICAvLyBub3QgYm9sZFxuICAgICAgICAgICAgdGhpcy5jdXJBdHRyID0gdGhpcy5jdXJBdHRyICYgfiAoMSA8PCAxOCk7XG4gICAgICAgIH0gZWxzZSBpZiAocCA9PT0gMjQpIHtcbiAgICAgICAgICAgIC8vIG5vdCB1bmRlcmxpbmVkXG4gICAgICAgICAgICB0aGlzLmN1ckF0dHIgPSB0aGlzLmN1ckF0dHIgJiB+ICgyIDw8IDE4KTtcbiAgICAgICAgfSBlbHNlIGlmIChwID09PSAzOSkge1xuICAgICAgICAgICAgLy8gcmVzZXQgZmdcbiAgICAgICAgICAgIHRoaXMuY3VyQXR0ciA9IHRoaXMuY3VyQXR0ciAmIH4gKDB4MWZmIDw8IDkpO1xuICAgICAgICAgICAgdGhpcy5jdXJBdHRyID0gdGhpcy5jdXJBdHRyIHwgKCgodGhpcy5kZWZBdHRyID4+IDkpICYgMHgxZmYpIDw8IDkpO1xuICAgICAgICB9IGVsc2UgaWYgKHAgPT09IDQ5KSB7XG4gICAgICAgICAgICAvLyByZXNldCBiZ1xuICAgICAgICAgICAgdGhpcy5jdXJBdHRyID0gdGhpcy5jdXJBdHRyICYgfjB4MWZmO1xuICAgICAgICAgICAgdGhpcy5jdXJBdHRyID0gdGhpcy5jdXJBdHRyIHwgKHRoaXMuZGVmQXR0ciAmIDB4MWZmKTtcbiAgICAgICAgfSBlbHNlIGlmIChwID09PSAzOCkge1xuICAgICAgICAgICAgLy8gZmcgY29sb3IgMjU2XG4gICAgICAgICAgICBpZiAocGFyYW1zW2kgKyAxXSAhPT0gNSkgY29udGludWU7XG4gICAgICAgICAgICBpICs9IDI7XG4gICAgICAgICAgICBwID0gcGFyYW1zW2ldICYgMHhmZjtcbiAgICAgICAgICAgIC8vIGNvbnZlcnQgODggY29sb3JzIHRvIDI1NlxuICAgICAgICAgICAgLy8gaWYgKHRoaXMuaXMoJ3J4dnQtdW5pY29kZScpICYmIHAgPCA4OCkgcCA9IHAgKiAyLjkwOTAgfCAwO1xuICAgICAgICAgICAgdGhpcy5jdXJBdHRyID0gKHRoaXMuY3VyQXR0ciAmIH4gKDB4MWZmIDw8IDkpKSB8IChwIDw8IDkpO1xuICAgICAgICB9IGVsc2UgaWYgKHAgPT09IDQ4KSB7XG4gICAgICAgICAgICAvLyBiZyBjb2xvciAyNTZcbiAgICAgICAgICAgIGlmIChwYXJhbXNbaSArIDFdICE9PSA1KSBjb250aW51ZTtcbiAgICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgICAgIHAgPSBwYXJhbXNbaV0gJiAweGZmO1xuICAgICAgICAgICAgLy8gY29udmVydCA4OCBjb2xvcnMgdG8gMjU2XG4gICAgICAgICAgICAvLyBpZiAodGhpcy5pcygncnh2dC11bmljb2RlJykgJiYgcCA8IDg4KSBwID0gcCAqIDIuOTA5MCB8IDA7XG4gICAgICAgICAgICB0aGlzLmN1ckF0dHIgPSAodGhpcy5jdXJBdHRyICYgfjB4MWZmKSB8IHA7XG4gICAgICAgIH1cbiAgICB9XG59O1xuXG4vLyBDU0kgUHMgbiBEZXZpY2UgU3RhdHVzIFJlcG9ydCAoRFNSKS5cbi8vIFBzID0gNSAtPiBTdGF0dXMgUmVwb3J0LiBSZXN1bHQgKGBgT0snJykgaXNcbi8vIENTSSAwIG5cbi8vIFBzID0gNiAtPiBSZXBvcnQgQ3Vyc29yIFBvc2l0aW9uIChDUFIpIFtyb3c7Y29sdW1uXS5cbi8vIFJlc3VsdCBpc1xuLy8gQ1NJIHIgOyBjIFJcbi8vIENTSSA/IFBzIG5cbi8vIERldmljZSBTdGF0dXMgUmVwb3J0IChEU1IsIERFQy1zcGVjaWZpYykuXG4vLyBQcyA9IDYgLT4gUmVwb3J0IEN1cnNvciBQb3NpdGlvbiAoQ1BSKSBbcm93O2NvbHVtbl0gYXMgQ1NJXG4vLyA/IHIgOyBjIFIgKGFzc3VtZXMgcGFnZSBpcyB6ZXJvKS5cbi8vIFBzID0gMSA1IC0+IFJlcG9ydCBQcmludGVyIHN0YXR1cyBhcyBDU0kgPyAxIDAgbiAocmVhZHkpLlxuLy8gb3IgQ1NJID8gMSAxIG4gKG5vdCByZWFkeSkuXG4vLyBQcyA9IDIgNSAtPiBSZXBvcnQgVURLIHN0YXR1cyBhcyBDU0kgPyAyIDAgbiAodW5sb2NrZWQpXG4vLyBvciBDU0kgPyAyIDEgbiAobG9ja2VkKS5cbi8vIFBzID0gMiA2IC0+IFJlcG9ydCBLZXlib2FyZCBzdGF0dXMgYXNcbi8vIENTSSA/IDIgNyA7IDEgOyAwIDsgMCBuIChOb3J0aCBBbWVyaWNhbikuXG4vLyBUaGUgbGFzdCB0d28gcGFyYW1ldGVycyBhcHBseSB0byBWVDQwMCAmIHVwLCBhbmQgZGVub3RlIGtleS1cbi8vIGJvYXJkIHJlYWR5IGFuZCBMSzAxIHJlc3BlY3RpdmVseS5cbi8vIFBzID0gNSAzIC0+IFJlcG9ydCBMb2NhdG9yIHN0YXR1cyBhc1xuLy8gQ1NJID8gNSAzIG4gTG9jYXRvciBhdmFpbGFibGUsIGlmIGNvbXBpbGVkLWluLCBvclxuLy8gQ1NJID8gNSAwIG4gTm8gTG9jYXRvciwgaWYgbm90LlxuVGVybWluYWwucHJvdG90eXBlLmRldmljZVN0YXR1cyA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICAgIGlmICghdGhpcy5wcmVmaXgpIHtcbiAgICAgICAgc3dpdGNoIChwYXJhbXNbMF0pIHtcbiAgICAgICAgY2FzZSA1OlxuICAgICAgICAgICAgLy8gc3RhdHVzIHJlcG9ydFxuICAgICAgICAgICAgdGhpcy5zZW5kKCdcXHgxYlswbicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgNjpcbiAgICAgICAgICAgIC8vIGN1cnNvciBwb3NpdGlvblxuICAgICAgICAgICAgdGhpcy5zZW5kKCdcXHgxYlsnICsgKHRoaXMueSArIDEpICsgJzsnICsgKHRoaXMueCArIDEpICsgJ1InKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgfSBlbHNlIGlmICh0aGlzLnByZWZpeCA9PT0gJz8nKSB7XG4gICAgICAgIC8vIG1vZGVybiB4dGVybSBkb2VzbnQgc2VlbSB0b1xuICAgICAgICAvLyByZXNwb25kIHRvIGFueSBvZiB0aGVzZSBleGNlcHQgPzYsIDYsIGFuZCA1XG4gICAgICAgIHN3aXRjaCAocGFyYW1zWzBdKSB7XG4gICAgICAgIGNhc2UgNjpcbiAgICAgICAgICAgIC8vIGN1cnNvciBwb3NpdGlvblxuICAgICAgICAgICAgdGhpcy5zZW5kKCdcXHgxYls/JyArICh0aGlzLnkgKyAxKSArICc7JyArICh0aGlzLnggKyAxKSArICdSJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAxNTpcbiAgICAgICAgICAgIC8vIG5vIHByaW50ZXJcbiAgICAgICAgICAgIC8vIHRoaXMuc2VuZCgnXFx4MWJbPzExbicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgMjU6XG4gICAgICAgICAgICAvLyBkb250IHN1cHBvcnQgdXNlciBkZWZpbmVkIGtleXNcbiAgICAgICAgICAgIC8vIHRoaXMuc2VuZCgnXFx4MWJbPzIxbicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgMjY6XG4gICAgICAgICAgICAvLyBub3J0aCBhbWVyaWNhbiBrZXlib2FyZFxuICAgICAgICAgICAgLy8gdGhpcy5zZW5kKCdcXHgxYls/Mjc7MTswOzBuJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSA1MzpcbiAgICAgICAgICAgIC8vIG5vIGRlYyBsb2NhdG9yL21vdXNlXG4gICAgICAgICAgICAvLyB0aGlzLnNlbmQoJ1xceDFiWz81MG4nKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgfVxufTtcblxuLyoqXG4qIEFkZGl0aW9uc1xuKi9cblxuLy8gQ1NJIFBzIEBcbi8vIEluc2VydCBQcyAoQmxhbmspIENoYXJhY3RlcihzKSAoZGVmYXVsdCA9IDEpIChJQ0gpLlxuVGVybWluYWwucHJvdG90eXBlLmluc2VydENoYXJzID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gICAgdmFyIHBhcmFtLCByb3csIGosIGNoO1xuXG4gICAgcGFyYW0gPSBwYXJhbXNbMF07XG4gICAgaWYgKHBhcmFtIDwgMSkgcGFyYW0gPSAxO1xuXG4gICAgcm93ID0gdGhpcy55ICsgdGhpcy55YmFzZTtcbiAgICBqID0gdGhpcy54O1xuICAgIGNoID0gW3RoaXMuY3VyQXR0ciwgJyAnXTsgLy8geHRlcm1cblxuICAgIHdoaWxlIChwYXJhbS0tICYmIGogPCB0aGlzLmNvbHMpIHtcbiAgICAgICAgdGhpcy5saW5lc1tyb3ddLnNwbGljZShqKyssIDAsIGNoKTtcbiAgICAgICAgdGhpcy5saW5lc1tyb3ddLnBvcCgpO1xuICAgIH1cbn07XG5cbi8vIENTSSBQcyBFXG4vLyBDdXJzb3IgTmV4dCBMaW5lIFBzIFRpbWVzIChkZWZhdWx0ID0gMSkgKENOTCkuXG4vLyBzYW1lIGFzIENTSSBQcyBCID9cblRlcm1pbmFsLnByb3RvdHlwZS5jdXJzb3JOZXh0TGluZSA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICAgIHZhciBwYXJhbSA9IHBhcmFtc1swXTtcbiAgICBpZiAocGFyYW0gPCAxKSBwYXJhbSA9IDE7XG4gICAgdGhpcy55ICs9IHBhcmFtO1xuICAgIGlmICh0aGlzLnkgPj0gdGhpcy5yb3dzKSB7XG4gICAgICAgIHRoaXMueSA9IHRoaXMucm93cyAtIDE7XG4gICAgfVxuICAgIHRoaXMueCA9IDA7XG59O1xuXG4vLyBDU0kgUHMgRlxuLy8gQ3Vyc29yIFByZWNlZGluZyBMaW5lIFBzIFRpbWVzIChkZWZhdWx0ID0gMSkgKENOTCkuXG4vLyByZXVzZSBDU0kgUHMgQSA/XG5UZXJtaW5hbC5wcm90b3R5cGUuY3Vyc29yUHJlY2VkaW5nTGluZSA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICAgIHZhciBwYXJhbSA9IHBhcmFtc1swXTtcbiAgICBpZiAocGFyYW0gPCAxKSBwYXJhbSA9IDE7XG4gICAgdGhpcy55IC09IHBhcmFtO1xuICAgIGlmICh0aGlzLnkgPCAwKSB0aGlzLnkgPSAwO1xuICAgIHRoaXMueCA9IDA7XG59O1xuXG4vLyBDU0kgUHMgR1xuLy8gQ3Vyc29yIENoYXJhY3RlciBBYnNvbHV0ZSBbY29sdW1uXSAoZGVmYXVsdCA9IFtyb3csMV0pIChDSEEpLlxuVGVybWluYWwucHJvdG90eXBlLmN1cnNvckNoYXJBYnNvbHV0ZSA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICAgIHZhciBwYXJhbSA9IHBhcmFtc1swXTtcbiAgICBpZiAocGFyYW0gPCAxKSBwYXJhbSA9IDE7XG4gICAgdGhpcy54ID0gcGFyYW0gLSAxO1xufTtcblxuLy8gQ1NJIFBzIExcbi8vIEluc2VydCBQcyBMaW5lKHMpIChkZWZhdWx0ID0gMSkgKElMKS5cblRlcm1pbmFsLnByb3RvdHlwZS5pbnNlcnRMaW5lcyA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICAgIHZhciBwYXJhbSwgcm93LCBqO1xuXG4gICAgcGFyYW0gPSBwYXJhbXNbMF07XG4gICAgaWYgKHBhcmFtIDwgMSkgcGFyYW0gPSAxO1xuICAgIHJvdyA9IHRoaXMueSArIHRoaXMueWJhc2U7XG5cbiAgICBqID0gdGhpcy5yb3dzIC0gMSAtIHRoaXMuc2Nyb2xsQm90dG9tO1xuICAgIGogPSB0aGlzLnJvd3MgLSAxICsgdGhpcy55YmFzZSAtIGogKyAxO1xuXG4gICAgd2hpbGUgKHBhcmFtLS0pIHtcbiAgICAgICAgLy8gdGVzdDogZWNobyAtZSAnXFxlWzQ0bVxcZVsxTFxcZVswbSdcbiAgICAgICAgLy8gYmxhbmtMaW5lKHRydWUpIC0geHRlcm0vbGludXggYmVoYXZpb3JcbiAgICAgICAgdGhpcy5saW5lcy5zcGxpY2Uocm93LCAwLCB0aGlzLmJsYW5rTGluZSh0cnVlKSk7XG4gICAgICAgIHRoaXMubGluZXMuc3BsaWNlKGosIDEpO1xuICAgIH1cblxuICAgIC8vIHRoaXMubWF4UmFuZ2UoKTtcbiAgICB0aGlzLnVwZGF0ZVJhbmdlKHRoaXMueSk7XG4gICAgdGhpcy51cGRhdGVSYW5nZSh0aGlzLnNjcm9sbEJvdHRvbSk7XG59O1xuXG4vLyBDU0kgUHMgTVxuLy8gRGVsZXRlIFBzIExpbmUocykgKGRlZmF1bHQgPSAxKSAoREwpLlxuVGVybWluYWwucHJvdG90eXBlLmRlbGV0ZUxpbmVzID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gICAgdmFyIHBhcmFtLCByb3csIGo7XG5cbiAgICBwYXJhbSA9IHBhcmFtc1swXTtcbiAgICBpZiAocGFyYW0gPCAxKSBwYXJhbSA9IDE7XG4gICAgcm93ID0gdGhpcy55ICsgdGhpcy55YmFzZTtcblxuICAgIGogPSB0aGlzLnJvd3MgLSAxIC0gdGhpcy5zY3JvbGxCb3R0b207XG4gICAgaiA9IHRoaXMucm93cyAtIDEgKyB0aGlzLnliYXNlIC0gajtcblxuICAgIHdoaWxlIChwYXJhbS0tKSB7XG4gICAgICAgIC8vIHRlc3Q6IGVjaG8gLWUgJ1xcZVs0NG1cXGVbMU1cXGVbMG0nXG4gICAgICAgIC8vIGJsYW5rTGluZSh0cnVlKSAtIHh0ZXJtL2xpbnV4IGJlaGF2aW9yXG4gICAgICAgIHRoaXMubGluZXMuc3BsaWNlKGogKyAxLCAwLCB0aGlzLmJsYW5rTGluZSh0cnVlKSk7XG4gICAgICAgIHRoaXMubGluZXMuc3BsaWNlKHJvdywgMSk7XG4gICAgfVxuXG4gICAgLy8gdGhpcy5tYXhSYW5nZSgpO1xuICAgIHRoaXMudXBkYXRlUmFuZ2UodGhpcy55KTtcbiAgICB0aGlzLnVwZGF0ZVJhbmdlKHRoaXMuc2Nyb2xsQm90dG9tKTtcbn07XG5cbi8vIENTSSBQcyBQXG4vLyBEZWxldGUgUHMgQ2hhcmFjdGVyKHMpIChkZWZhdWx0ID0gMSkgKERDSCkuXG5UZXJtaW5hbC5wcm90b3R5cGUuZGVsZXRlQ2hhcnMgPSBmdW5jdGlvbihwYXJhbXMpIHtcbiAgICB2YXIgcGFyYW0sIHJvdywgY2g7XG5cbiAgICBwYXJhbSA9IHBhcmFtc1swXTtcbiAgICBpZiAocGFyYW0gPCAxKSBwYXJhbSA9IDE7XG5cbiAgICByb3cgPSB0aGlzLnkgKyB0aGlzLnliYXNlO1xuICAgIGNoID0gW3RoaXMuY3VyQXR0ciwgJyAnXTsgLy8geHRlcm1cblxuICAgIHdoaWxlIChwYXJhbS0tKSB7XG4gICAgICAgIHRoaXMubGluZXNbcm93XS5zcGxpY2UodGhpcy54LCAxKTtcbiAgICAgICAgdGhpcy5saW5lc1tyb3ddLnB1c2goY2gpO1xuICAgIH1cbn07XG5cbi8vIENTSSBQcyBYXG4vLyBFcmFzZSBQcyBDaGFyYWN0ZXIocykgKGRlZmF1bHQgPSAxKSAoRUNIKS5cblRlcm1pbmFsLnByb3RvdHlwZS5lcmFzZUNoYXJzID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gICAgdmFyIHBhcmFtLCByb3csIGosIGNoO1xuXG4gICAgcGFyYW0gPSBwYXJhbXNbMF07XG4gICAgaWYgKHBhcmFtIDwgMSkgcGFyYW0gPSAxO1xuXG4gICAgcm93ID0gdGhpcy55ICsgdGhpcy55YmFzZTtcbiAgICBqID0gdGhpcy54O1xuICAgIGNoID0gW3RoaXMuY3VyQXR0ciwgJyAnXTsgLy8geHRlcm1cblxuICAgIHdoaWxlIChwYXJhbS0tICYmIGogPCB0aGlzLmNvbHMpIHtcbiAgICAgICAgdGhpcy5saW5lc1tyb3ddW2orK10gPSBjaDtcbiAgICB9XG59O1xuXG4vLyBDU0kgUG0gYCBDaGFyYWN0ZXIgUG9zaXRpb24gQWJzb2x1dGVcbi8vIFtjb2x1bW5dIChkZWZhdWx0ID0gW3JvdywxXSkgKEhQQSkuXG5UZXJtaW5hbC5wcm90b3R5cGUuY2hhclBvc0Fic29sdXRlID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gICAgdmFyIHBhcmFtID0gcGFyYW1zWzBdO1xuICAgIGlmIChwYXJhbSA8IDEpIHBhcmFtID0gMTtcbiAgICB0aGlzLnggPSBwYXJhbSAtIDE7XG4gICAgaWYgKHRoaXMueCA+PSB0aGlzLmNvbHMpIHtcbiAgICAgICAgdGhpcy54ID0gdGhpcy5jb2xzIC0gMTtcbiAgICB9XG59O1xuXG4vLyAxNDEgNjEgYSAqIEhQUiAtXG4vLyBIb3Jpem9udGFsIFBvc2l0aW9uIFJlbGF0aXZlXG4vLyByZXVzZSBDU0kgUHMgQyA/XG5UZXJtaW5hbC5wcm90b3R5cGUuSFBvc2l0aW9uUmVsYXRpdmUgPSBmdW5jdGlvbihwYXJhbXMpIHtcbiAgICB2YXIgcGFyYW0gPSBwYXJhbXNbMF07XG4gICAgaWYgKHBhcmFtIDwgMSkgcGFyYW0gPSAxO1xuICAgIHRoaXMueCArPSBwYXJhbTtcbiAgICBpZiAodGhpcy54ID49IHRoaXMuY29scykge1xuICAgICAgICB0aGlzLnggPSB0aGlzLmNvbHMgLSAxO1xuICAgIH1cbn07XG5cbi8vIENTSSBQcyBjIFNlbmQgRGV2aWNlIEF0dHJpYnV0ZXMgKFByaW1hcnkgREEpLlxuLy8gUHMgPSAwIG9yIG9taXR0ZWQgLT4gcmVxdWVzdCBhdHRyaWJ1dGVzIGZyb20gdGVybWluYWwuIFRoZVxuLy8gcmVzcG9uc2UgZGVwZW5kcyBvbiB0aGUgZGVjVGVybWluYWxJRCByZXNvdXJjZSBzZXR0aW5nLlxuLy8gLT4gQ1NJID8gMSA7IDIgYyAoYGBWVDEwMCB3aXRoIEFkdmFuY2VkIFZpZGVvIE9wdGlvbicnKVxuLy8gLT4gQ1NJID8gMSA7IDAgYyAoYGBWVDEwMSB3aXRoIE5vIE9wdGlvbnMnJylcbi8vIC0+IENTSSA/IDYgYyAoYGBWVDEwMicnKVxuLy8gLT4gQ1NJID8gNiAwIDsgMSA7IDIgOyA2IDsgOCA7IDkgOyAxIDUgOyBjIChgYFZUMjIwJycpXG4vLyBUaGUgVlQxMDAtc3R5bGUgcmVzcG9uc2UgcGFyYW1ldGVycyBkbyBub3QgbWVhbiBhbnl0aGluZyBieVxuLy8gdGhlbXNlbHZlcy4gVlQyMjAgcGFyYW1ldGVycyBkbywgdGVsbGluZyB0aGUgaG9zdCB3aGF0IGZlYS1cbi8vIHR1cmVzIHRoZSB0ZXJtaW5hbCBzdXBwb3J0czpcbi8vIFBzID0gMSAtPiAxMzItY29sdW1ucy5cbi8vIFBzID0gMiAtPiBQcmludGVyLlxuLy8gUHMgPSA2IC0+IFNlbGVjdGl2ZSBlcmFzZS5cbi8vIFBzID0gOCAtPiBVc2VyLWRlZmluZWQga2V5cy5cbi8vIFBzID0gOSAtPiBOYXRpb25hbCByZXBsYWNlbWVudCBjaGFyYWN0ZXIgc2V0cy5cbi8vIFBzID0gMSA1IC0+IFRlY2huaWNhbCBjaGFyYWN0ZXJzLlxuLy8gUHMgPSAyIDIgLT4gQU5TSSBjb2xvciwgZS5nLiwgVlQ1MjUuXG4vLyBQcyA9IDIgOSAtPiBBTlNJIHRleHQgbG9jYXRvciAoaS5lLiwgREVDIExvY2F0b3IgbW9kZSkuXG4vLyBDU0kgPiBQcyBjXG4vLyBTZW5kIERldmljZSBBdHRyaWJ1dGVzIChTZWNvbmRhcnkgREEpLlxuLy8gUHMgPSAwIG9yIG9taXR0ZWQgLT4gcmVxdWVzdCB0aGUgdGVybWluYWwncyBpZGVudGlmaWNhdGlvblxuLy8gY29kZS4gVGhlIHJlc3BvbnNlIGRlcGVuZHMgb24gdGhlIGRlY1Rlcm1pbmFsSUQgcmVzb3VyY2Ugc2V0LVxuLy8gdGluZy4gSXQgc2hvdWxkIGFwcGx5IG9ubHkgdG8gVlQyMjAgYW5kIHVwLCBidXQgeHRlcm0gZXh0ZW5kc1xuLy8gdGhpcyB0byBWVDEwMC5cbi8vIC0+IENTSSA+IFBwIDsgUHYgOyBQYyBjXG4vLyB3aGVyZSBQcCBkZW5vdGVzIHRoZSB0ZXJtaW5hbCB0eXBlXG4vLyBQcCA9IDAgLT4gYGBWVDEwMCcnLlxuLy8gUHAgPSAxIC0+IGBgVlQyMjAnJy5cbi8vIGFuZCBQdiBpcyB0aGUgZmlybXdhcmUgdmVyc2lvbiAoZm9yIHh0ZXJtLCB0aGlzIHdhcyBvcmlnaW5hbGx5XG4vLyB0aGUgWEZyZWU4NiBwYXRjaCBudW1iZXIsIHN0YXJ0aW5nIHdpdGggOTUpLiBJbiBhIERFQyB0ZXJtaS1cbi8vIG5hbCwgUGMgaW5kaWNhdGVzIHRoZSBST00gY2FydHJpZGdlIHJlZ2lzdHJhdGlvbiBudW1iZXIgYW5kIGlzXG4vLyBhbHdheXMgemVyby5cbi8vIE1vcmUgaW5mb3JtYXRpb246XG4vLyB4dGVybS9jaGFycHJvYy5jIC0gbGluZSAyMDEyLCBmb3IgbW9yZSBpbmZvcm1hdGlvbi5cbi8vIHZpbSByZXNwb25kcyB3aXRoIF5bWz8wYyBvciBeW1s/MWMgYWZ0ZXIgdGhlIHRlcm1pbmFsJ3MgcmVzcG9uc2UgKD8pXG5UZXJtaW5hbC5wcm90b3R5cGUuc2VuZERldmljZUF0dHJpYnV0ZXMgPSBmdW5jdGlvbihwYXJhbXMpIHtcbiAgICBpZiAocGFyYW1zWzBdID4gMCkgcmV0dXJuO1xuXG4gICAgaWYgKCF0aGlzLnByZWZpeCkge1xuICAgICAgICBpZiAodGhpcy5pcygneHRlcm0nKSB8fCB0aGlzLmlzKCdyeHZ0LXVuaWNvZGUnKSB8fCB0aGlzLmlzKCdzY3JlZW4nKSkge1xuICAgICAgICAgICAgdGhpcy5zZW5kKCdcXHgxYls/MTsyYycpO1xuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuaXMoJ2xpbnV4JykpIHtcbiAgICAgICAgICAgIHRoaXMuc2VuZCgnXFx4MWJbPzZjJyk7XG4gICAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMucHJlZml4ID09PSAnPicpIHtcbiAgICAgICAgLy8geHRlcm0gYW5kIHVyeHZ0XG4gICAgICAgIC8vIHNlZW0gdG8gc3BpdCB0aGlzXG4gICAgICAgIC8vIG91dCBhcm91bmQgfjM3MCB0aW1lcyAoPykuXG4gICAgICAgIGlmICh0aGlzLmlzKCd4dGVybScpKSB7XG4gICAgICAgICAgICB0aGlzLnNlbmQoJ1xceDFiWz4wOzI3NjswYycpO1xuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuaXMoJ3J4dnQtdW5pY29kZScpKSB7XG4gICAgICAgICAgICB0aGlzLnNlbmQoJ1xceDFiWz44NTs5NTswYycpO1xuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuaXMoJ2xpbnV4JykpIHtcbiAgICAgICAgICAgIC8vIG5vdCBzdXBwb3J0ZWQgYnkgbGludXggY29uc29sZS5cbiAgICAgICAgICAgIC8vIGxpbnV4IGNvbnNvbGUgZWNob2VzIHBhcmFtZXRlcnMuXG4gICAgICAgICAgICB0aGlzLnNlbmQocGFyYW1zWzBdICsgJ2MnKTtcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmlzKCdzY3JlZW4nKSkge1xuICAgICAgICAgICAgdGhpcy5zZW5kKCdcXHgxYls+ODM7NDAwMDM7MGMnKTtcbiAgICAgICAgfVxuICAgIH1cbn07XG5cbi8vIENTSSBQbSBkXG4vLyBMaW5lIFBvc2l0aW9uIEFic29sdXRlIFtyb3ddIChkZWZhdWx0ID0gWzEsY29sdW1uXSkgKFZQQSkuXG5UZXJtaW5hbC5wcm90b3R5cGUubGluZVBvc0Fic29sdXRlID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gICAgdmFyIHBhcmFtID0gcGFyYW1zWzBdO1xuICAgIGlmIChwYXJhbSA8IDEpIHBhcmFtID0gMTtcbiAgICB0aGlzLnkgPSBwYXJhbSAtIDE7XG4gICAgaWYgKHRoaXMueSA+PSB0aGlzLnJvd3MpIHtcbiAgICAgICAgdGhpcy55ID0gdGhpcy5yb3dzIC0gMTtcbiAgICB9XG59O1xuXG4vLyAxNDUgNjUgZSAqIFZQUiAtIFZlcnRpY2FsIFBvc2l0aW9uIFJlbGF0aXZlXG4vLyByZXVzZSBDU0kgUHMgQiA/XG5UZXJtaW5hbC5wcm90b3R5cGUuVlBvc2l0aW9uUmVsYXRpdmUgPSBmdW5jdGlvbihwYXJhbXMpIHtcbiAgICB2YXIgcGFyYW0gPSBwYXJhbXNbMF07XG4gICAgaWYgKHBhcmFtIDwgMSkgcGFyYW0gPSAxO1xuICAgIHRoaXMueSArPSBwYXJhbTtcbiAgICBpZiAodGhpcy55ID49IHRoaXMucm93cykge1xuICAgICAgICB0aGlzLnkgPSB0aGlzLnJvd3MgLSAxO1xuICAgIH1cbn07XG5cbi8vIENTSSBQcyA7IFBzIGZcbi8vIEhvcml6b250YWwgYW5kIFZlcnRpY2FsIFBvc2l0aW9uIFtyb3c7Y29sdW1uXSAoZGVmYXVsdCA9XG4vLyBbMSwxXSkgKEhWUCkuXG5UZXJtaW5hbC5wcm90b3R5cGUuSFZQb3NpdGlvbiA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICAgIGlmIChwYXJhbXNbMF0gPCAxKSBwYXJhbXNbMF0gPSAxO1xuICAgIGlmIChwYXJhbXNbMV0gPCAxKSBwYXJhbXNbMV0gPSAxO1xuXG4gICAgdGhpcy55ID0gcGFyYW1zWzBdIC0gMTtcbiAgICBpZiAodGhpcy55ID49IHRoaXMucm93cykge1xuICAgICAgICB0aGlzLnkgPSB0aGlzLnJvd3MgLSAxO1xuICAgIH1cblxuICAgIHRoaXMueCA9IHBhcmFtc1sxXSAtIDE7XG4gICAgaWYgKHRoaXMueCA+PSB0aGlzLmNvbHMpIHtcbiAgICAgICAgdGhpcy54ID0gdGhpcy5jb2xzIC0gMTtcbiAgICB9XG59O1xuXG4vLyBDU0kgUG0gaCBTZXQgTW9kZSAoU00pLlxuLy8gUHMgPSAyIC0+IEtleWJvYXJkIEFjdGlvbiBNb2RlIChBTSkuXG4vLyBQcyA9IDQgLT4gSW5zZXJ0IE1vZGUgKElSTSkuXG4vLyBQcyA9IDEgMiAtPiBTZW5kL3JlY2VpdmUgKFNSTSkuXG4vLyBQcyA9IDIgMCAtPiBBdXRvbWF0aWMgTmV3bGluZSAoTE5NKS5cbi8vIENTSSA/IFBtIGhcbi8vIERFQyBQcml2YXRlIE1vZGUgU2V0IChERUNTRVQpLlxuLy8gUHMgPSAxIC0+IEFwcGxpY2F0aW9uIEN1cnNvciBLZXlzIChERUNDS00pLlxuLy8gUHMgPSAyIC0+IERlc2lnbmF0ZSBVU0FTQ0lJIGZvciBjaGFyYWN0ZXIgc2V0cyBHMC1HM1xuLy8gKERFQ0FOTSksIGFuZCBzZXQgVlQxMDAgbW9kZS5cbi8vIFBzID0gMyAtPiAxMzIgQ29sdW1uIE1vZGUgKERFQ0NPTE0pLlxuLy8gUHMgPSA0IC0+IFNtb290aCAoU2xvdykgU2Nyb2xsIChERUNTQ0xNKS5cbi8vIFBzID0gNSAtPiBSZXZlcnNlIFZpZGVvIChERUNTQ05NKS5cbi8vIFBzID0gNiAtPiBPcmlnaW4gTW9kZSAoREVDT00pLlxuLy8gUHMgPSA3IC0+IFdyYXBhcm91bmQgTW9kZSAoREVDQVdNKS5cbi8vIFBzID0gOCAtPiBBdXRvLXJlcGVhdCBLZXlzIChERUNBUk0pLlxuLy8gUHMgPSA5IC0+IFNlbmQgTW91c2UgWCAmIFkgb24gYnV0dG9uIHByZXNzLiBTZWUgdGhlIHNlYy1cbi8vIHRpb24gTW91c2UgVHJhY2tpbmcuXG4vLyBQcyA9IDEgMCAtPiBTaG93IHRvb2xiYXIgKHJ4dnQpLlxuLy8gUHMgPSAxIDIgLT4gU3RhcnQgQmxpbmtpbmcgQ3Vyc29yIChhdHQ2MTApLlxuLy8gUHMgPSAxIDggLT4gUHJpbnQgZm9ybSBmZWVkIChERUNQRkYpLlxuLy8gUHMgPSAxIDkgLT4gU2V0IHByaW50IGV4dGVudCB0byBmdWxsIHNjcmVlbiAoREVDUEVYKS5cbi8vIFBzID0gMiA1IC0+IFNob3cgQ3Vyc29yIChERUNUQ0VNKS5cbi8vIFBzID0gMyAwIC0+IFNob3cgc2Nyb2xsYmFyIChyeHZ0KS5cbi8vIFBzID0gMyA1IC0+IEVuYWJsZSBmb250LXNoaWZ0aW5nIGZ1bmN0aW9ucyAocnh2dCkuXG4vLyBQcyA9IDMgOCAtPiBFbnRlciBUZWt0cm9uaXggTW9kZSAoREVDVEVLKS5cbi8vIFBzID0gNCAwIC0+IEFsbG93IDgwIC0+IDEzMiBNb2RlLlxuLy8gUHMgPSA0IDEgLT4gbW9yZSgxKSBmaXggKHNlZSBjdXJzZXMgcmVzb3VyY2UpLlxuLy8gUHMgPSA0IDIgLT4gRW5hYmxlIE5hdGlvbiBSZXBsYWNlbWVudCBDaGFyYWN0ZXIgc2V0cyAoREVDTi1cbi8vIFJDTSkuXG4vLyBQcyA9IDQgNCAtPiBUdXJuIE9uIE1hcmdpbiBCZWxsLlxuLy8gUHMgPSA0IDUgLT4gUmV2ZXJzZS13cmFwYXJvdW5kIE1vZGUuXG4vLyBQcyA9IDQgNiAtPiBTdGFydCBMb2dnaW5nLiBUaGlzIGlzIG5vcm1hbGx5IGRpc2FibGVkIGJ5IGFcbi8vIGNvbXBpbGUtdGltZSBvcHRpb24uXG4vLyBQcyA9IDQgNyAtPiBVc2UgQWx0ZXJuYXRlIFNjcmVlbiBCdWZmZXIuIChUaGlzIG1heSBiZSBkaXMtXG4vLyBhYmxlZCBieSB0aGUgdGl0ZUluaGliaXQgcmVzb3VyY2UpLlxuLy8gUHMgPSA2IDYgLT4gQXBwbGljYXRpb24ga2V5cGFkIChERUNOS00pLlxuLy8gUHMgPSA2IDcgLT4gQmFja2Fycm93IGtleSBzZW5kcyBiYWNrc3BhY2UgKERFQ0JLTSkuXG4vLyBQcyA9IDEgMCAwIDAgLT4gU2VuZCBNb3VzZSBYICYgWSBvbiBidXR0b24gcHJlc3MgYW5kXG4vLyByZWxlYXNlLiBTZWUgdGhlIHNlY3Rpb24gTW91c2UgVHJhY2tpbmcuXG4vLyBQcyA9IDEgMCAwIDEgLT4gVXNlIEhpbGl0ZSBNb3VzZSBUcmFja2luZy5cbi8vIFBzID0gMSAwIDAgMiAtPiBVc2UgQ2VsbCBNb3Rpb24gTW91c2UgVHJhY2tpbmcuXG4vLyBQcyA9IDEgMCAwIDMgLT4gVXNlIEFsbCBNb3Rpb24gTW91c2UgVHJhY2tpbmcuXG4vLyBQcyA9IDEgMCAwIDQgLT4gU2VuZCBGb2N1c0luL0ZvY3VzT3V0IGV2ZW50cy5cbi8vIFBzID0gMSAwIDAgNSAtPiBFbmFibGUgRXh0ZW5kZWQgTW91c2UgTW9kZS5cbi8vIFBzID0gMSAwIDEgMCAtPiBTY3JvbGwgdG8gYm90dG9tIG9uIHR0eSBvdXRwdXQgKHJ4dnQpLlxuLy8gUHMgPSAxIDAgMSAxIC0+IFNjcm9sbCB0byBib3R0b20gb24ga2V5IHByZXNzIChyeHZ0KS5cbi8vIFBzID0gMSAwIDMgNCAtPiBJbnRlcnByZXQgXCJtZXRhXCIga2V5LCBzZXRzIGVpZ2h0aCBiaXQuXG4vLyAoZW5hYmxlcyB0aGUgZWlnaHRCaXRJbnB1dCByZXNvdXJjZSkuXG4vLyBQcyA9IDEgMCAzIDUgLT4gRW5hYmxlIHNwZWNpYWwgbW9kaWZpZXJzIGZvciBBbHQgYW5kIE51bS1cbi8vIExvY2sga2V5cy4gKFRoaXMgZW5hYmxlcyB0aGUgbnVtTG9jayByZXNvdXJjZSkuXG4vLyBQcyA9IDEgMCAzIDYgLT4gU2VuZCBFU0Mgd2hlbiBNZXRhIG1vZGlmaWVzIGEga2V5LiAoVGhpc1xuLy8gZW5hYmxlcyB0aGUgbWV0YVNlbmRzRXNjYXBlIHJlc291cmNlKS5cbi8vIFBzID0gMSAwIDMgNyAtPiBTZW5kIERFTCBmcm9tIHRoZSBlZGl0aW5nLWtleXBhZCBEZWxldGVcbi8vIGtleS5cbi8vIFBzID0gMSAwIDMgOSAtPiBTZW5kIEVTQyB3aGVuIEFsdCBtb2RpZmllcyBhIGtleS4gKFRoaXNcbi8vIGVuYWJsZXMgdGhlIGFsdFNlbmRzRXNjYXBlIHJlc291cmNlKS5cbi8vIFBzID0gMSAwIDQgMCAtPiBLZWVwIHNlbGVjdGlvbiBldmVuIGlmIG5vdCBoaWdobGlnaHRlZC5cbi8vIChUaGlzIGVuYWJsZXMgdGhlIGtlZXBTZWxlY3Rpb24gcmVzb3VyY2UpLlxuLy8gUHMgPSAxIDAgNCAxIC0+IFVzZSB0aGUgQ0xJUEJPQVJEIHNlbGVjdGlvbi4gKFRoaXMgZW5hYmxlc1xuLy8gdGhlIHNlbGVjdFRvQ2xpcGJvYXJkIHJlc291cmNlKS5cbi8vIFBzID0gMSAwIDQgMiAtPiBFbmFibGUgVXJnZW5jeSB3aW5kb3cgbWFuYWdlciBoaW50IHdoZW5cbi8vIENvbnRyb2wtRyBpcyByZWNlaXZlZC4gKFRoaXMgZW5hYmxlcyB0aGUgYmVsbElzVXJnZW50XG4vLyByZXNvdXJjZSkuXG4vLyBQcyA9IDEgMCA0IDMgLT4gRW5hYmxlIHJhaXNpbmcgb2YgdGhlIHdpbmRvdyB3aGVuIENvbnRyb2wtR1xuLy8gaXMgcmVjZWl2ZWQuIChlbmFibGVzIHRoZSBwb3BPbkJlbGwgcmVzb3VyY2UpLlxuLy8gUHMgPSAxIDAgNCA3IC0+IFVzZSBBbHRlcm5hdGUgU2NyZWVuIEJ1ZmZlci4gKFRoaXMgbWF5IGJlXG4vLyBkaXNhYmxlZCBieSB0aGUgdGl0ZUluaGliaXQgcmVzb3VyY2UpLlxuLy8gUHMgPSAxIDAgNCA4IC0+IFNhdmUgY3Vyc29yIGFzIGluIERFQ1NDLiAoVGhpcyBtYXkgYmUgZGlzLVxuLy8gYWJsZWQgYnkgdGhlIHRpdGVJbmhpYml0IHJlc291cmNlKS5cbi8vIFBzID0gMSAwIDQgOSAtPiBTYXZlIGN1cnNvciBhcyBpbiBERUNTQyBhbmQgdXNlIEFsdGVybmF0ZVxuLy8gU2NyZWVuIEJ1ZmZlciwgY2xlYXJpbmcgaXQgZmlyc3QuIChUaGlzIG1heSBiZSBkaXNhYmxlZCBieVxuLy8gdGhlIHRpdGVJbmhpYml0IHJlc291cmNlKS4gVGhpcyBjb21iaW5lcyB0aGUgZWZmZWN0cyBvZiB0aGUgMVxuLy8gMCA0IDcgYW5kIDEgMCA0IDggbW9kZXMuIFVzZSB0aGlzIHdpdGggdGVybWluZm8tYmFzZWRcbi8vIGFwcGxpY2F0aW9ucyByYXRoZXIgdGhhbiB0aGUgNCA3IG1vZGUuXG4vLyBQcyA9IDEgMCA1IDAgLT4gU2V0IHRlcm1pbmZvL3Rlcm1jYXAgZnVuY3Rpb24ta2V5IG1vZGUuXG4vLyBQcyA9IDEgMCA1IDEgLT4gU2V0IFN1biBmdW5jdGlvbi1rZXkgbW9kZS5cbi8vIFBzID0gMSAwIDUgMiAtPiBTZXQgSFAgZnVuY3Rpb24ta2V5IG1vZGUuXG4vLyBQcyA9IDEgMCA1IDMgLT4gU2V0IFNDTyBmdW5jdGlvbi1rZXkgbW9kZS5cbi8vIFBzID0gMSAwIDYgMCAtPiBTZXQgbGVnYWN5IGtleWJvYXJkIGVtdWxhdGlvbiAoWDExUjYpLlxuLy8gUHMgPSAxIDAgNiAxIC0+IFNldCBWVDIyMCBrZXlib2FyZCBlbXVsYXRpb24uXG4vLyBQcyA9IDIgMCAwIDQgLT4gU2V0IGJyYWNrZXRlZCBwYXN0ZSBtb2RlLlxuLy8gTW9kZXM6XG4vLyBodHRwOi8vdnQxMDAubmV0L2RvY3MvdnQyMjAtcm0vY2hhcHRlcjQuaHRtbFxuVGVybWluYWwucHJvdG90eXBlLnNldE1vZGUgPSBmdW5jdGlvbihwYXJhbXMpIHtcbiAgICBpZiAodHlwZW9mIHBhcmFtcyA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgdmFyIGwgPSBwYXJhbXMubGVuZ3RoLFxuICAgICAgICAgICAgaSA9IDA7XG5cbiAgICAgICAgZm9yICg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgICAgIHRoaXMuc2V0TW9kZShwYXJhbXNbaV0pO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5wcmVmaXgpIHtcbiAgICAgICAgc3dpdGNoIChwYXJhbXMpIHtcbiAgICAgICAgY2FzZSA0OlxuICAgICAgICAgICAgdGhpcy5pbnNlcnRNb2RlID0gdHJ1ZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDIwOlxuICAgICAgICAgICAgLy90aGlzLmNvbnZlcnRFb2wgPSB0cnVlO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMucHJlZml4ID09PSAnPycpIHtcbiAgICAgICAgc3dpdGNoIChwYXJhbXMpIHtcbiAgICAgICAgY2FzZSAxOlxuICAgICAgICAgICAgdGhpcy5hcHBsaWNhdGlvbktleXBhZCA9IHRydWU7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAyOlxuICAgICAgICAgICAgdGhpcy5zZXRnQ2hhcnNldCgwLCBUZXJtaW5hbC5jaGFyc2V0cy5VUyk7XG4gICAgICAgICAgICB0aGlzLnNldGdDaGFyc2V0KDEsIFRlcm1pbmFsLmNoYXJzZXRzLlVTKTtcbiAgICAgICAgICAgIHRoaXMuc2V0Z0NoYXJzZXQoMiwgVGVybWluYWwuY2hhcnNldHMuVVMpO1xuICAgICAgICAgICAgdGhpcy5zZXRnQ2hhcnNldCgzLCBUZXJtaW5hbC5jaGFyc2V0cy5VUyk7XG4gICAgICAgICAgICAvLyBzZXQgVlQxMDAgbW9kZSBoZXJlXG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAzOlxuICAgICAgICAgICAgLy8gMTMyIGNvbCBtb2RlXG4gICAgICAgICAgICB0aGlzLnNhdmVkQ29scyA9IHRoaXMuY29scztcbiAgICAgICAgICAgIHRoaXMucmVzaXplKDEzMiwgdGhpcy5yb3dzKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDY6XG4gICAgICAgICAgICB0aGlzLm9yaWdpbk1vZGUgPSB0cnVlO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgNzpcbiAgICAgICAgICAgIHRoaXMud3JhcGFyb3VuZE1vZGUgPSB0cnVlO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgMTI6XG4gICAgICAgICAgICAvLyB0aGlzLmN1cnNvckJsaW5rID0gdHJ1ZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDk6XG4gICAgICAgICAgICAvLyBYMTAgTW91c2VcbiAgICAgICAgICAgIC8vIG5vIHJlbGVhc2UsIG5vIG1vdGlvbiwgbm8gd2hlZWwsIG5vIG1vZGlmaWVycy5cbiAgICAgICAgY2FzZSAxMDAwOlxuICAgICAgICAgICAgLy8gdnQyMDAgbW91c2VcbiAgICAgICAgICAgIC8vIG5vIG1vdGlvbi5cbiAgICAgICAgICAgIC8vIG5vIG1vZGlmaWVycywgZXhjZXB0IGNvbnRyb2wgb24gdGhlIHdoZWVsLlxuICAgICAgICBjYXNlIDEwMDI6XG4gICAgICAgICAgICAvLyBidXR0b24gZXZlbnQgbW91c2VcbiAgICAgICAgY2FzZSAxMDAzOlxuICAgICAgICAgICAgLy8gYW55IGV2ZW50IG1vdXNlXG4gICAgICAgICAgICAvLyBhbnkgZXZlbnQgLSBzZW5kcyBtb3Rpb24gZXZlbnRzLFxuICAgICAgICAgICAgLy8gZXZlbiBpZiB0aGVyZSBpcyBubyBidXR0b24gaGVsZCBkb3duLlxuICAgICAgICAgICAgdGhpcy54MTBNb3VzZSA9IHBhcmFtcyA9PT0gOTtcbiAgICAgICAgICAgIHRoaXMudnQyMDBNb3VzZSA9IHBhcmFtcyA9PT0gMTAwMDtcbiAgICAgICAgICAgIHRoaXMubm9ybWFsTW91c2UgPSBwYXJhbXMgPiAxMDAwO1xuICAgICAgICAgICAgdGhpcy5tb3VzZUV2ZW50cyA9IHRydWU7XG4gICAgICAgICAgICB0aGlzLmVsZW1lbnQuc3R5bGUuY3Vyc29yID0gJ2RlZmF1bHQnO1xuICAgICAgICAgICAgdGhpcy5sb2coJ0JpbmRpbmcgdG8gbW91c2UgZXZlbnRzLicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgMTAwNDpcbiAgICAgICAgICAgIC8vIHNlbmQgZm9jdXNpbi9mb2N1c291dCBldmVudHNcbiAgICAgICAgICAgIC8vIGZvY3VzaW46IF5bW0lcbiAgICAgICAgICAgIC8vIGZvY3Vzb3V0OiBeW1tPXG4gICAgICAgICAgICB0aGlzLnNlbmRGb2N1cyA9IHRydWU7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAxMDA1OlxuICAgICAgICAgICAgLy8gdXRmOCBleHQgbW9kZSBtb3VzZVxuICAgICAgICAgICAgdGhpcy51dGZNb3VzZSA9IHRydWU7XG4gICAgICAgICAgICAvLyBmb3Igd2lkZSB0ZXJtaW5hbHNcbiAgICAgICAgICAgIC8vIHNpbXBseSBlbmNvZGVzIGxhcmdlIHZhbHVlcyBhcyB1dGY4IGNoYXJhY3RlcnNcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDEwMDY6XG4gICAgICAgICAgICAvLyBzZ3IgZXh0IG1vZGUgbW91c2VcbiAgICAgICAgICAgIHRoaXMuc2dyTW91c2UgPSB0cnVlO1xuICAgICAgICAgICAgLy8gZm9yIHdpZGUgdGVybWluYWxzXG4gICAgICAgICAgICAvLyBkb2VzIG5vdCBhZGQgMzIgdG8gZmllbGRzXG4gICAgICAgICAgICAvLyBwcmVzczogXltbPGI7eDt5TVxuICAgICAgICAgICAgLy8gcmVsZWFzZTogXltbPGI7eDt5bVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgMTAxNTpcbiAgICAgICAgICAgIC8vIHVyeHZ0IGV4dCBtb2RlIG1vdXNlXG4gICAgICAgICAgICB0aGlzLnVyeHZ0TW91c2UgPSB0cnVlO1xuICAgICAgICAgICAgLy8gZm9yIHdpZGUgdGVybWluYWxzXG4gICAgICAgICAgICAvLyBudW1iZXJzIGZvciBmaWVsZHNcbiAgICAgICAgICAgIC8vIHByZXNzOiBeW1tiO3g7eU1cbiAgICAgICAgICAgIC8vIG1vdGlvbjogXltbYjt4O3lUXG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAyNTpcbiAgICAgICAgICAgIC8vIHNob3cgY3Vyc29yXG4gICAgICAgICAgICB0aGlzLmN1cnNvckhpZGRlbiA9IGZhbHNlO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgMTA0OTpcbiAgICAgICAgICAgIC8vIGFsdCBzY3JlZW4gYnVmZmVyIGN1cnNvclxuICAgICAgICAgICAgLy90aGlzLnNhdmVDdXJzb3IoKTtcbiAgICAgICAgICAgIDsgLy8gRkFMTC1USFJPVUdIXG4gICAgICAgIGNhc2UgNDc6XG4gICAgICAgICAgICAvLyBhbHQgc2NyZWVuIGJ1ZmZlclxuICAgICAgICBjYXNlIDEwNDc6XG4gICAgICAgICAgICAvLyBhbHQgc2NyZWVuIGJ1ZmZlclxuICAgICAgICAgICAgaWYgKCF0aGlzLm5vcm1hbCkge1xuICAgICAgICAgICAgICAgIHZhciBub3JtYWwgPSB7XG4gICAgICAgICAgICAgICAgICAgIGxpbmVzOiB0aGlzLmxpbmVzLFxuICAgICAgICAgICAgICAgICAgICB5YmFzZTogdGhpcy55YmFzZSxcbiAgICAgICAgICAgICAgICAgICAgeWRpc3A6IHRoaXMueWRpc3AsXG4gICAgICAgICAgICAgICAgICAgIHg6IHRoaXMueCxcbiAgICAgICAgICAgICAgICAgICAgeTogdGhpcy55LFxuICAgICAgICAgICAgICAgICAgICBzY3JvbGxUb3A6IHRoaXMuc2Nyb2xsVG9wLFxuICAgICAgICAgICAgICAgICAgICBzY3JvbGxCb3R0b206IHRoaXMuc2Nyb2xsQm90dG9tLFxuICAgICAgICAgICAgICAgICAgICB0YWJzOiB0aGlzLnRhYnNcbiAgICAgICAgICAgICAgICAgICAgLy8gWFhYIHNhdmUgY2hhcnNldChzKSBoZXJlP1xuICAgICAgICAgICAgICAgICAgICAvLyBjaGFyc2V0OiB0aGlzLmNoYXJzZXQsXG4gICAgICAgICAgICAgICAgICAgIC8vIGdsZXZlbDogdGhpcy5nbGV2ZWwsXG4gICAgICAgICAgICAgICAgICAgIC8vIGNoYXJzZXRzOiB0aGlzLmNoYXJzZXRzXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICB0aGlzLnJlc2V0KCk7XG4gICAgICAgICAgICAgICAgdGhpcy5ub3JtYWwgPSBub3JtYWw7XG4gICAgICAgICAgICAgICAgdGhpcy5zaG93Q3Vyc29yKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgIH1cbn07XG5cbi8vIENTSSBQbSBsIFJlc2V0IE1vZGUgKFJNKS5cbi8vIFBzID0gMiAtPiBLZXlib2FyZCBBY3Rpb24gTW9kZSAoQU0pLlxuLy8gUHMgPSA0IC0+IFJlcGxhY2UgTW9kZSAoSVJNKS5cbi8vIFBzID0gMSAyIC0+IFNlbmQvcmVjZWl2ZSAoU1JNKS5cbi8vIFBzID0gMiAwIC0+IE5vcm1hbCBMaW5lZmVlZCAoTE5NKS5cbi8vIENTSSA/IFBtIGxcbi8vIERFQyBQcml2YXRlIE1vZGUgUmVzZXQgKERFQ1JTVCkuXG4vLyBQcyA9IDEgLT4gTm9ybWFsIEN1cnNvciBLZXlzIChERUNDS00pLlxuLy8gUHMgPSAyIC0+IERlc2lnbmF0ZSBWVDUyIG1vZGUgKERFQ0FOTSkuXG4vLyBQcyA9IDMgLT4gODAgQ29sdW1uIE1vZGUgKERFQ0NPTE0pLlxuLy8gUHMgPSA0IC0+IEp1bXAgKEZhc3QpIFNjcm9sbCAoREVDU0NMTSkuXG4vLyBQcyA9IDUgLT4gTm9ybWFsIFZpZGVvIChERUNTQ05NKS5cbi8vIFBzID0gNiAtPiBOb3JtYWwgQ3Vyc29yIE1vZGUgKERFQ09NKS5cbi8vIFBzID0gNyAtPiBObyBXcmFwYXJvdW5kIE1vZGUgKERFQ0FXTSkuXG4vLyBQcyA9IDggLT4gTm8gQXV0by1yZXBlYXQgS2V5cyAoREVDQVJNKS5cbi8vIFBzID0gOSAtPiBEb24ndCBzZW5kIE1vdXNlIFggJiBZIG9uIGJ1dHRvbiBwcmVzcy5cbi8vIFBzID0gMSAwIC0+IEhpZGUgdG9vbGJhciAocnh2dCkuXG4vLyBQcyA9IDEgMiAtPiBTdG9wIEJsaW5raW5nIEN1cnNvciAoYXR0NjEwKS5cbi8vIFBzID0gMSA4IC0+IERvbid0IHByaW50IGZvcm0gZmVlZCAoREVDUEZGKS5cbi8vIFBzID0gMSA5IC0+IExpbWl0IHByaW50IHRvIHNjcm9sbGluZyByZWdpb24gKERFQ1BFWCkuXG4vLyBQcyA9IDIgNSAtPiBIaWRlIEN1cnNvciAoREVDVENFTSkuXG4vLyBQcyA9IDMgMCAtPiBEb24ndCBzaG93IHNjcm9sbGJhciAocnh2dCkuXG4vLyBQcyA9IDMgNSAtPiBEaXNhYmxlIGZvbnQtc2hpZnRpbmcgZnVuY3Rpb25zIChyeHZ0KS5cbi8vIFBzID0gNCAwIC0+IERpc2FsbG93IDgwIC0+IDEzMiBNb2RlLlxuLy8gUHMgPSA0IDEgLT4gTm8gbW9yZSgxKSBmaXggKHNlZSBjdXJzZXMgcmVzb3VyY2UpLlxuLy8gUHMgPSA0IDIgLT4gRGlzYWJsZSBOYXRpb24gUmVwbGFjZW1lbnQgQ2hhcmFjdGVyIHNldHMgKERFQy1cbi8vIE5SQ00pLlxuLy8gUHMgPSA0IDQgLT4gVHVybiBPZmYgTWFyZ2luIEJlbGwuXG4vLyBQcyA9IDQgNSAtPiBObyBSZXZlcnNlLXdyYXBhcm91bmQgTW9kZS5cbi8vIFBzID0gNCA2IC0+IFN0b3AgTG9nZ2luZy4gKFRoaXMgaXMgbm9ybWFsbHkgZGlzYWJsZWQgYnkgYVxuLy8gY29tcGlsZS10aW1lIG9wdGlvbikuXG4vLyBQcyA9IDQgNyAtPiBVc2UgTm9ybWFsIFNjcmVlbiBCdWZmZXIuXG4vLyBQcyA9IDYgNiAtPiBOdW1lcmljIGtleXBhZCAoREVDTktNKS5cbi8vIFBzID0gNiA3IC0+IEJhY2thcnJvdyBrZXkgc2VuZHMgZGVsZXRlIChERUNCS00pLlxuLy8gUHMgPSAxIDAgMCAwIC0+IERvbid0IHNlbmQgTW91c2UgWCAmIFkgb24gYnV0dG9uIHByZXNzIGFuZFxuLy8gcmVsZWFzZS4gU2VlIHRoZSBzZWN0aW9uIE1vdXNlIFRyYWNraW5nLlxuLy8gUHMgPSAxIDAgMCAxIC0+IERvbid0IHVzZSBIaWxpdGUgTW91c2UgVHJhY2tpbmcuXG4vLyBQcyA9IDEgMCAwIDIgLT4gRG9uJ3QgdXNlIENlbGwgTW90aW9uIE1vdXNlIFRyYWNraW5nLlxuLy8gUHMgPSAxIDAgMCAzIC0+IERvbid0IHVzZSBBbGwgTW90aW9uIE1vdXNlIFRyYWNraW5nLlxuLy8gUHMgPSAxIDAgMCA0IC0+IERvbid0IHNlbmQgRm9jdXNJbi9Gb2N1c091dCBldmVudHMuXG4vLyBQcyA9IDEgMCAwIDUgLT4gRGlzYWJsZSBFeHRlbmRlZCBNb3VzZSBNb2RlLlxuLy8gUHMgPSAxIDAgMSAwIC0+IERvbid0IHNjcm9sbCB0byBib3R0b20gb24gdHR5IG91dHB1dFxuLy8gKHJ4dnQpLlxuLy8gUHMgPSAxIDAgMSAxIC0+IERvbid0IHNjcm9sbCB0byBib3R0b20gb24ga2V5IHByZXNzIChyeHZ0KS5cbi8vIFBzID0gMSAwIDMgNCAtPiBEb24ndCBpbnRlcnByZXQgXCJtZXRhXCIga2V5LiAoVGhpcyBkaXNhYmxlc1xuLy8gdGhlIGVpZ2h0Qml0SW5wdXQgcmVzb3VyY2UpLlxuLy8gUHMgPSAxIDAgMyA1IC0+IERpc2FibGUgc3BlY2lhbCBtb2RpZmllcnMgZm9yIEFsdCBhbmQgTnVtLVxuLy8gTG9jayBrZXlzLiAoVGhpcyBkaXNhYmxlcyB0aGUgbnVtTG9jayByZXNvdXJjZSkuXG4vLyBQcyA9IDEgMCAzIDYgLT4gRG9uJ3Qgc2VuZCBFU0Mgd2hlbiBNZXRhIG1vZGlmaWVzIGEga2V5LlxuLy8gKFRoaXMgZGlzYWJsZXMgdGhlIG1ldGFTZW5kc0VzY2FwZSByZXNvdXJjZSkuXG4vLyBQcyA9IDEgMCAzIDcgLT4gU2VuZCBWVDIyMCBSZW1vdmUgZnJvbSB0aGUgZWRpdGluZy1rZXlwYWRcbi8vIERlbGV0ZSBrZXkuXG4vLyBQcyA9IDEgMCAzIDkgLT4gRG9uJ3Qgc2VuZCBFU0Mgd2hlbiBBbHQgbW9kaWZpZXMgYSBrZXkuXG4vLyAoVGhpcyBkaXNhYmxlcyB0aGUgYWx0U2VuZHNFc2NhcGUgcmVzb3VyY2UpLlxuLy8gUHMgPSAxIDAgNCAwIC0+IERvIG5vdCBrZWVwIHNlbGVjdGlvbiB3aGVuIG5vdCBoaWdobGlnaHRlZC5cbi8vIChUaGlzIGRpc2FibGVzIHRoZSBrZWVwU2VsZWN0aW9uIHJlc291cmNlKS5cbi8vIFBzID0gMSAwIDQgMSAtPiBVc2UgdGhlIFBSSU1BUlkgc2VsZWN0aW9uLiAoVGhpcyBkaXNhYmxlc1xuLy8gdGhlIHNlbGVjdFRvQ2xpcGJvYXJkIHJlc291cmNlKS5cbi8vIFBzID0gMSAwIDQgMiAtPiBEaXNhYmxlIFVyZ2VuY3kgd2luZG93IG1hbmFnZXIgaGludCB3aGVuXG4vLyBDb250cm9sLUcgaXMgcmVjZWl2ZWQuIChUaGlzIGRpc2FibGVzIHRoZSBiZWxsSXNVcmdlbnRcbi8vIHJlc291cmNlKS5cbi8vIFBzID0gMSAwIDQgMyAtPiBEaXNhYmxlIHJhaXNpbmcgb2YgdGhlIHdpbmRvdyB3aGVuIENvbnRyb2wtXG4vLyBHIGlzIHJlY2VpdmVkLiAoVGhpcyBkaXNhYmxlcyB0aGUgcG9wT25CZWxsIHJlc291cmNlKS5cbi8vIFBzID0gMSAwIDQgNyAtPiBVc2UgTm9ybWFsIFNjcmVlbiBCdWZmZXIsIGNsZWFyaW5nIHNjcmVlblxuLy8gZmlyc3QgaWYgaW4gdGhlIEFsdGVybmF0ZSBTY3JlZW4uIChUaGlzIG1heSBiZSBkaXNhYmxlZCBieVxuLy8gdGhlIHRpdGVJbmhpYml0IHJlc291cmNlKS5cbi8vIFBzID0gMSAwIDQgOCAtPiBSZXN0b3JlIGN1cnNvciBhcyBpbiBERUNSQy4gKFRoaXMgbWF5IGJlXG4vLyBkaXNhYmxlZCBieSB0aGUgdGl0ZUluaGliaXQgcmVzb3VyY2UpLlxuLy8gUHMgPSAxIDAgNCA5IC0+IFVzZSBOb3JtYWwgU2NyZWVuIEJ1ZmZlciBhbmQgcmVzdG9yZSBjdXJzb3Jcbi8vIGFzIGluIERFQ1JDLiAoVGhpcyBtYXkgYmUgZGlzYWJsZWQgYnkgdGhlIHRpdGVJbmhpYml0XG4vLyByZXNvdXJjZSkuIFRoaXMgY29tYmluZXMgdGhlIGVmZmVjdHMgb2YgdGhlIDEgMCA0IDcgYW5kIDEgMFxuLy8gNCA4IG1vZGVzLiBVc2UgdGhpcyB3aXRoIHRlcm1pbmZvLWJhc2VkIGFwcGxpY2F0aW9ucyByYXRoZXJcbi8vIHRoYW4gdGhlIDQgNyBtb2RlLlxuLy8gUHMgPSAxIDAgNSAwIC0+IFJlc2V0IHRlcm1pbmZvL3Rlcm1jYXAgZnVuY3Rpb24ta2V5IG1vZGUuXG4vLyBQcyA9IDEgMCA1IDEgLT4gUmVzZXQgU3VuIGZ1bmN0aW9uLWtleSBtb2RlLlxuLy8gUHMgPSAxIDAgNSAyIC0+IFJlc2V0IEhQIGZ1bmN0aW9uLWtleSBtb2RlLlxuLy8gUHMgPSAxIDAgNSAzIC0+IFJlc2V0IFNDTyBmdW5jdGlvbi1rZXkgbW9kZS5cbi8vIFBzID0gMSAwIDYgMCAtPiBSZXNldCBsZWdhY3kga2V5Ym9hcmQgZW11bGF0aW9uIChYMTFSNikuXG4vLyBQcyA9IDEgMCA2IDEgLT4gUmVzZXQga2V5Ym9hcmQgZW11bGF0aW9uIHRvIFN1bi9QQyBzdHlsZS5cbi8vIFBzID0gMiAwIDAgNCAtPiBSZXNldCBicmFja2V0ZWQgcGFzdGUgbW9kZS5cblRlcm1pbmFsLnByb3RvdHlwZS5yZXNldE1vZGUgPSBmdW5jdGlvbihwYXJhbXMpIHtcbiAgICBpZiAodHlwZW9mIHBhcmFtcyA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgdmFyIGwgPSBwYXJhbXMubGVuZ3RoLFxuICAgICAgICAgICAgaSA9IDA7XG5cbiAgICAgICAgZm9yICg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgICAgIHRoaXMucmVzZXRNb2RlKHBhcmFtc1tpXSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLnByZWZpeCkge1xuICAgICAgICBzd2l0Y2ggKHBhcmFtcykge1xuICAgICAgICBjYXNlIDQ6XG4gICAgICAgICAgICB0aGlzLmluc2VydE1vZGUgPSBmYWxzZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDIwOlxuICAgICAgICAgICAgLy90aGlzLmNvbnZlcnRFb2wgPSBmYWxzZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgfSBlbHNlIGlmICh0aGlzLnByZWZpeCA9PT0gJz8nKSB7XG4gICAgICAgIHN3aXRjaCAocGFyYW1zKSB7XG4gICAgICAgIGNhc2UgMTpcbiAgICAgICAgICAgIHRoaXMuYXBwbGljYXRpb25LZXlwYWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDM6XG4gICAgICAgICAgICBpZiAodGhpcy5jb2xzID09PSAxMzIgJiYgdGhpcy5zYXZlZENvbHMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlc2l6ZSh0aGlzLnNhdmVkQ29scywgdGhpcy5yb3dzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnNhdmVkQ29scztcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDY6XG4gICAgICAgICAgICB0aGlzLm9yaWdpbk1vZGUgPSBmYWxzZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDc6XG4gICAgICAgICAgICB0aGlzLndyYXBhcm91bmRNb2RlID0gZmFsc2U7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAxMjpcbiAgICAgICAgICAgIC8vIHRoaXMuY3Vyc29yQmxpbmsgPSBmYWxzZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDk6XG4gICAgICAgICAgICAvLyBYMTAgTW91c2VcbiAgICAgICAgY2FzZSAxMDAwOlxuICAgICAgICAgICAgLy8gdnQyMDAgbW91c2VcbiAgICAgICAgY2FzZSAxMDAyOlxuICAgICAgICAgICAgLy8gYnV0dG9uIGV2ZW50IG1vdXNlXG4gICAgICAgIGNhc2UgMTAwMzpcbiAgICAgICAgICAgIC8vIGFueSBldmVudCBtb3VzZVxuICAgICAgICAgICAgdGhpcy54MTBNb3VzZSA9IGZhbHNlO1xuICAgICAgICAgICAgdGhpcy52dDIwME1vdXNlID0gZmFsc2U7XG4gICAgICAgICAgICB0aGlzLm5vcm1hbE1vdXNlID0gZmFsc2U7XG4gICAgICAgICAgICB0aGlzLm1vdXNlRXZlbnRzID0gZmFsc2U7XG4gICAgICAgICAgICB0aGlzLmVsZW1lbnQuc3R5bGUuY3Vyc29yID0gJyc7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAxMDA0OlxuICAgICAgICAgICAgLy8gc2VuZCBmb2N1c2luL2ZvY3Vzb3V0IGV2ZW50c1xuICAgICAgICAgICAgdGhpcy5zZW5kRm9jdXMgPSBmYWxzZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIDEwMDU6XG4gICAgICAgICAgICAvLyB1dGY4IGV4dCBtb2RlIG1vdXNlXG4gICAgICAgICAgICB0aGlzLnV0Zk1vdXNlID0gZmFsc2U7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAxMDA2OlxuICAgICAgICAgICAgLy8gc2dyIGV4dCBtb2RlIG1vdXNlXG4gICAgICAgICAgICB0aGlzLnNnck1vdXNlID0gZmFsc2U7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAxMDE1OlxuICAgICAgICAgICAgLy8gdXJ4dnQgZXh0IG1vZGUgbW91c2VcbiAgICAgICAgICAgIHRoaXMudXJ4dnRNb3VzZSA9IGZhbHNlO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgMjU6XG4gICAgICAgICAgICAvLyBoaWRlIGN1cnNvclxuICAgICAgICAgICAgdGhpcy5jdXJzb3JIaWRkZW4gPSB0cnVlO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgMTA0OTpcbiAgICAgICAgICAgIC8vIGFsdCBzY3JlZW4gYnVmZmVyIGN1cnNvclxuICAgICAgICAgICAgOyAvLyBGQUxMLVRIUk9VR0hcbiAgICAgICAgY2FzZSA0NzpcbiAgICAgICAgICAgIC8vIG5vcm1hbCBzY3JlZW4gYnVmZmVyXG4gICAgICAgIGNhc2UgMTA0NzpcbiAgICAgICAgICAgIC8vIG5vcm1hbCBzY3JlZW4gYnVmZmVyIC0gY2xlYXJpbmcgaXQgZmlyc3RcbiAgICAgICAgICAgIGlmICh0aGlzLm5vcm1hbCkge1xuICAgICAgICAgICAgICAgIHRoaXMubGluZXMgPSB0aGlzLm5vcm1hbC5saW5lcztcbiAgICAgICAgICAgICAgICB0aGlzLnliYXNlID0gdGhpcy5ub3JtYWwueWJhc2U7XG4gICAgICAgICAgICAgICAgdGhpcy55ZGlzcCA9IHRoaXMubm9ybWFsLnlkaXNwO1xuICAgICAgICAgICAgICAgIHRoaXMueCA9IHRoaXMubm9ybWFsLng7XG4gICAgICAgICAgICAgICAgdGhpcy55ID0gdGhpcy5ub3JtYWwueTtcbiAgICAgICAgICAgICAgICB0aGlzLnNjcm9sbFRvcCA9IHRoaXMubm9ybWFsLnNjcm9sbFRvcDtcbiAgICAgICAgICAgICAgICB0aGlzLnNjcm9sbEJvdHRvbSA9IHRoaXMubm9ybWFsLnNjcm9sbEJvdHRvbTtcbiAgICAgICAgICAgICAgICB0aGlzLnRhYnMgPSB0aGlzLm5vcm1hbC50YWJzO1xuICAgICAgICAgICAgICAgIHRoaXMubm9ybWFsID0gbnVsbDtcbiAgICAgICAgICAgICAgICAvLyBpZiAocGFyYW1zID09PSAxMDQ5KSB7XG4gICAgICAgICAgICAgICAgLy8gdGhpcy54ID0gdGhpcy5zYXZlZFg7XG4gICAgICAgICAgICAgICAgLy8gdGhpcy55ID0gdGhpcy5zYXZlZFk7XG4gICAgICAgICAgICAgICAgLy8gfVxuICAgICAgICAgICAgICAgIHRoaXMucmVmcmVzaCgwLCB0aGlzLnJvd3MgLSAxKTtcbiAgICAgICAgICAgICAgICB0aGlzLnNob3dDdXJzb3IoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgfVxufTtcblxuLy8gQ1NJIFBzIDsgUHMgclxuLy8gU2V0IFNjcm9sbGluZyBSZWdpb24gW3RvcDtib3R0b21dIChkZWZhdWx0ID0gZnVsbCBzaXplIG9mIHdpbi1cbi8vIGRvdykgKERFQ1NUQk0pLlxuLy8gQ1NJID8gUG0gclxuVGVybWluYWwucHJvdG90eXBlLnNldFNjcm9sbFJlZ2lvbiA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICAgIGlmICh0aGlzLnByZWZpeCkgcmV0dXJuO1xuICAgIHRoaXMuc2Nyb2xsVG9wID0gKHBhcmFtc1swXSB8fCAxKSAtIDE7XG4gICAgdGhpcy5zY3JvbGxCb3R0b20gPSAocGFyYW1zWzFdIHx8IHRoaXMucm93cykgLSAxO1xuICAgIHRoaXMueCA9IDA7XG4gICAgdGhpcy55ID0gMDtcbn07XG5cbi8vIENTSSBzXG4vLyBTYXZlIGN1cnNvciAoQU5TSS5TWVMpLlxuVGVybWluYWwucHJvdG90eXBlLnNhdmVDdXJzb3IgPSBmdW5jdGlvbihwYXJhbXMpIHtcbiAgICB0aGlzLnNhdmVkWCA9IHRoaXMueDtcbiAgICB0aGlzLnNhdmVkWSA9IHRoaXMueTtcbn07XG5cbi8vIENTSSB1XG4vLyBSZXN0b3JlIGN1cnNvciAoQU5TSS5TWVMpLlxuVGVybWluYWwucHJvdG90eXBlLnJlc3RvcmVDdXJzb3IgPSBmdW5jdGlvbihwYXJhbXMpIHtcbiAgICB0aGlzLnggPSB0aGlzLnNhdmVkWCB8fCAwO1xuICAgIHRoaXMueSA9IHRoaXMuc2F2ZWRZIHx8IDA7XG59O1xuXG4vKipcbiogTGVzc2VyIFVzZWRcbiovXG5cbi8vIENTSSBQcyBJXG4vLyBDdXJzb3IgRm9yd2FyZCBUYWJ1bGF0aW9uIFBzIHRhYiBzdG9wcyAoZGVmYXVsdCA9IDEpIChDSFQpLlxuVGVybWluYWwucHJvdG90eXBlLmN1cnNvckZvcndhcmRUYWIgPSBmdW5jdGlvbihwYXJhbXMpIHtcbiAgICB2YXIgcGFyYW0gPSBwYXJhbXNbMF0gfHwgMTtcbiAgICB3aGlsZSAocGFyYW0tLSkge1xuICAgICAgICB0aGlzLnggPSB0aGlzLm5leHRTdG9wKCk7XG4gICAgfVxufTtcblxuLy8gQ1NJIFBzIFMgU2Nyb2xsIHVwIFBzIGxpbmVzIChkZWZhdWx0ID0gMSkgKFNVKS5cblRlcm1pbmFsLnByb3RvdHlwZS5zY3JvbGxVcCA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICAgIHZhciBwYXJhbSA9IHBhcmFtc1swXSB8fCAxO1xuICAgIHdoaWxlIChwYXJhbS0tKSB7XG4gICAgICAgIHRoaXMubGluZXMuc3BsaWNlKHRoaXMueWJhc2UgKyB0aGlzLnNjcm9sbFRvcCwgMSk7XG4gICAgICAgIHRoaXMubGluZXMuc3BsaWNlKHRoaXMueWJhc2UgKyB0aGlzLnNjcm9sbEJvdHRvbSwgMCwgdGhpcy5ibGFua0xpbmUoKSk7XG4gICAgfVxuICAgIC8vIHRoaXMubWF4UmFuZ2UoKTtcbiAgICB0aGlzLnVwZGF0ZVJhbmdlKHRoaXMuc2Nyb2xsVG9wKTtcbiAgICB0aGlzLnVwZGF0ZVJhbmdlKHRoaXMuc2Nyb2xsQm90dG9tKTtcbn07XG5cbi8vIENTSSBQcyBUIFNjcm9sbCBkb3duIFBzIGxpbmVzIChkZWZhdWx0ID0gMSkgKFNEKS5cblRlcm1pbmFsLnByb3RvdHlwZS5zY3JvbGxEb3duID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gICAgdmFyIHBhcmFtID0gcGFyYW1zWzBdIHx8IDE7XG4gICAgd2hpbGUgKHBhcmFtLS0pIHtcbiAgICAgICAgdGhpcy5saW5lcy5zcGxpY2UodGhpcy55YmFzZSArIHRoaXMuc2Nyb2xsQm90dG9tLCAxKTtcbiAgICAgICAgdGhpcy5saW5lcy5zcGxpY2UodGhpcy55YmFzZSArIHRoaXMuc2Nyb2xsVG9wLCAwLCB0aGlzLmJsYW5rTGluZSgpKTtcbiAgICB9XG4gICAgLy8gdGhpcy5tYXhSYW5nZSgpO1xuICAgIHRoaXMudXBkYXRlUmFuZ2UodGhpcy5zY3JvbGxUb3ApO1xuICAgIHRoaXMudXBkYXRlUmFuZ2UodGhpcy5zY3JvbGxCb3R0b20pO1xufTtcblxuLy8gQ1NJIFBzIDsgUHMgOyBQcyA7IFBzIDsgUHMgVFxuLy8gSW5pdGlhdGUgaGlnaGxpZ2h0IG1vdXNlIHRyYWNraW5nLiBQYXJhbWV0ZXJzIGFyZVxuLy8gW2Z1bmM7c3RhcnR4O3N0YXJ0eTtmaXJzdHJvdztsYXN0cm93XS4gU2VlIHRoZSBzZWN0aW9uIE1vdXNlXG4vLyBUcmFja2luZy5cblRlcm1pbmFsLnByb3RvdHlwZS5pbml0TW91c2VUcmFja2luZyA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICAgIC8vIFJlbGV2YW50OiBERUNTRVQgMTAwMVxufTtcblxuLy8gQ1NJID4gUHM7IFBzIFRcbi8vIFJlc2V0IG9uZSBvciBtb3JlIGZlYXR1cmVzIG9mIHRoZSB0aXRsZSBtb2RlcyB0byB0aGUgZGVmYXVsdFxuLy8gdmFsdWUuIE5vcm1hbGx5LCBcInJlc2V0XCIgZGlzYWJsZXMgdGhlIGZlYXR1cmUuIEl0IGlzIHBvc3NpLVxuLy8gYmxlIHRvIGRpc2FibGUgdGhlIGFiaWxpdHkgdG8gcmVzZXQgZmVhdHVyZXMgYnkgY29tcGlsaW5nIGFcbi8vIGRpZmZlcmVudCBkZWZhdWx0IGZvciB0aGUgdGl0bGUgbW9kZXMgaW50byB4dGVybS5cbi8vIFBzID0gMCAtPiBEbyBub3Qgc2V0IHdpbmRvdy9pY29uIGxhYmVscyB1c2luZyBoZXhhZGVjaW1hbC5cbi8vIFBzID0gMSAtPiBEbyBub3QgcXVlcnkgd2luZG93L2ljb24gbGFiZWxzIHVzaW5nIGhleGFkZWNpLVxuLy8gbWFsLlxuLy8gUHMgPSAyIC0+IERvIG5vdCBzZXQgd2luZG93L2ljb24gbGFiZWxzIHVzaW5nIFVURi04LlxuLy8gUHMgPSAzIC0+IERvIG5vdCBxdWVyeSB3aW5kb3cvaWNvbiBsYWJlbHMgdXNpbmcgVVRGLTguXG4vLyAoU2VlIGRpc2N1c3Npb24gb2YgXCJUaXRsZSBNb2Rlc1wiKS5cblRlcm1pbmFsLnByb3RvdHlwZS5yZXNldFRpdGxlTW9kZXMgPSBmdW5jdGlvbihwYXJhbXMpIHs7XG59O1xuXG4vLyBDU0kgUHMgWiBDdXJzb3IgQmFja3dhcmQgVGFidWxhdGlvbiBQcyB0YWIgc3RvcHMgKGRlZmF1bHQgPSAxKSAoQ0JUKS5cblRlcm1pbmFsLnByb3RvdHlwZS5jdXJzb3JCYWNrd2FyZFRhYiA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICAgIHZhciBwYXJhbSA9IHBhcmFtc1swXSB8fCAxO1xuICAgIHdoaWxlIChwYXJhbS0tKSB7XG4gICAgICAgIHRoaXMueCA9IHRoaXMucHJldlN0b3AoKTtcbiAgICB9XG59O1xuXG4vLyBDU0kgUHMgYiBSZXBlYXQgdGhlIHByZWNlZGluZyBncmFwaGljIGNoYXJhY3RlciBQcyB0aW1lcyAoUkVQKS5cblRlcm1pbmFsLnByb3RvdHlwZS5yZXBlYXRQcmVjZWRpbmdDaGFyYWN0ZXIgPSBmdW5jdGlvbihwYXJhbXMpIHtcbiAgICB2YXIgcGFyYW0gPSBwYXJhbXNbMF0gfHwgMSxcbiAgICAgICAgbGluZSA9IHRoaXMubGluZXNbdGhpcy55YmFzZSArIHRoaXMueV0sXG4gICAgICAgIGNoID0gbGluZVt0aGlzLnggLSAxXSB8fCBbdGhpcy5kZWZBdHRyLCAnICddO1xuXG4gICAgd2hpbGUgKHBhcmFtLS0pIGxpbmVbdGhpcy54KytdID0gY2g7XG59O1xuXG4vLyBDU0kgUHMgZyBUYWIgQ2xlYXIgKFRCQykuXG4vLyBQcyA9IDAgLT4gQ2xlYXIgQ3VycmVudCBDb2x1bW4gKGRlZmF1bHQpLlxuLy8gUHMgPSAzIC0+IENsZWFyIEFsbC5cbi8vIFBvdGVudGlhbGx5OlxuLy8gUHMgPSAyIC0+IENsZWFyIFN0b3BzIG9uIExpbmUuXG4vLyBodHRwOi8vdnQxMDAubmV0L2FubmFyYm9yL2FhYS11Zy9zZWN0aW9uNi5odG1sXG5UZXJtaW5hbC5wcm90b3R5cGUudGFiQ2xlYXIgPSBmdW5jdGlvbihwYXJhbXMpIHtcbiAgICB2YXIgcGFyYW0gPSBwYXJhbXNbMF07XG4gICAgaWYgKHBhcmFtIDw9IDApIHtcbiAgICAgICAgZGVsZXRlIHRoaXMudGFic1t0aGlzLnhdO1xuICAgIH0gZWxzZSBpZiAocGFyYW0gPT09IDMpIHtcbiAgICAgICAgdGhpcy50YWJzID0ge307XG4gICAgfVxufTtcblxuLy8gQ1NJIFBtIGkgTWVkaWEgQ29weSAoTUMpLlxuLy8gUHMgPSAwIC0+IFByaW50IHNjcmVlbiAoZGVmYXVsdCkuXG4vLyBQcyA9IDQgLT4gVHVybiBvZmYgcHJpbnRlciBjb250cm9sbGVyIG1vZGUuXG4vLyBQcyA9IDUgLT4gVHVybiBvbiBwcmludGVyIGNvbnRyb2xsZXIgbW9kZS5cbi8vIENTSSA/IFBtIGlcbi8vIE1lZGlhIENvcHkgKE1DLCBERUMtc3BlY2lmaWMpLlxuLy8gUHMgPSAxIC0+IFByaW50IGxpbmUgY29udGFpbmluZyBjdXJzb3IuXG4vLyBQcyA9IDQgLT4gVHVybiBvZmYgYXV0b3ByaW50IG1vZGUuXG4vLyBQcyA9IDUgLT4gVHVybiBvbiBhdXRvcHJpbnQgbW9kZS5cbi8vIFBzID0gMSAwIC0+IFByaW50IGNvbXBvc2VkIGRpc3BsYXksIGlnbm9yZXMgREVDUEVYLlxuLy8gUHMgPSAxIDEgLT4gUHJpbnQgYWxsIHBhZ2VzLlxuVGVybWluYWwucHJvdG90eXBlLm1lZGlhQ29weSA9IGZ1bmN0aW9uKHBhcmFtcykgeztcbn07XG5cbi8vIENTSSA+IFBzOyBQcyBtXG4vLyBTZXQgb3IgcmVzZXQgcmVzb3VyY2UtdmFsdWVzIHVzZWQgYnkgeHRlcm0gdG8gZGVjaWRlIHdoZXRoZXJcbi8vIHRvIGNvbnN0cnVjdCBlc2NhcGUgc2VxdWVuY2VzIGhvbGRpbmcgaW5mb3JtYXRpb24gYWJvdXQgdGhlXG4vLyBtb2RpZmllcnMgcHJlc3NlZCB3aXRoIGEgZ2l2ZW4ga2V5LiBUaGUgZmlyc3QgcGFyYW1ldGVyIGlkZW4tXG4vLyB0aWZpZXMgdGhlIHJlc291cmNlIHRvIHNldC9yZXNldC4gVGhlIHNlY29uZCBwYXJhbWV0ZXIgaXMgdGhlXG4vLyB2YWx1ZSB0byBhc3NpZ24gdG8gdGhlIHJlc291cmNlLiBJZiB0aGUgc2Vjb25kIHBhcmFtZXRlciBpc1xuLy8gb21pdHRlZCwgdGhlIHJlc291cmNlIGlzIHJlc2V0IHRvIGl0cyBpbml0aWFsIHZhbHVlLlxuLy8gUHMgPSAxIC0+IG1vZGlmeUN1cnNvcktleXMuXG4vLyBQcyA9IDIgLT4gbW9kaWZ5RnVuY3Rpb25LZXlzLlxuLy8gUHMgPSA0IC0+IG1vZGlmeU90aGVyS2V5cy5cbi8vIElmIG5vIHBhcmFtZXRlcnMgYXJlIGdpdmVuLCBhbGwgcmVzb3VyY2VzIGFyZSByZXNldCB0byB0aGVpclxuLy8gaW5pdGlhbCB2YWx1ZXMuXG5UZXJtaW5hbC5wcm90b3R5cGUuc2V0UmVzb3VyY2VzID0gZnVuY3Rpb24ocGFyYW1zKSB7O1xufTtcblxuLy8gQ1NJID4gUHMgblxuLy8gRGlzYWJsZSBtb2RpZmllcnMgd2hpY2ggbWF5IGJlIGVuYWJsZWQgdmlhIHRoZSBDU0kgPiBQczsgUHMgbVxuLy8gc2VxdWVuY2UuIFRoaXMgY29ycmVzcG9uZHMgdG8gYSByZXNvdXJjZSB2YWx1ZSBvZiBcIi0xXCIsIHdoaWNoXG4vLyBjYW5ub3QgYmUgc2V0IHdpdGggdGhlIG90aGVyIHNlcXVlbmNlLiBUaGUgcGFyYW1ldGVyIGlkZW50aS1cbi8vIGZpZXMgdGhlIHJlc291cmNlIHRvIGJlIGRpc2FibGVkOlxuLy8gUHMgPSAxIC0+IG1vZGlmeUN1cnNvcktleXMuXG4vLyBQcyA9IDIgLT4gbW9kaWZ5RnVuY3Rpb25LZXlzLlxuLy8gUHMgPSA0IC0+IG1vZGlmeU90aGVyS2V5cy5cbi8vIElmIHRoZSBwYXJhbWV0ZXIgaXMgb21pdHRlZCwgbW9kaWZ5RnVuY3Rpb25LZXlzIGlzIGRpc2FibGVkLlxuLy8gV2hlbiBtb2RpZnlGdW5jdGlvbktleXMgaXMgZGlzYWJsZWQsIHh0ZXJtIHVzZXMgdGhlIG1vZGlmaWVyXG4vLyBrZXlzIHRvIG1ha2UgYW4gZXh0ZW5kZWQgc2VxdWVuY2Ugb2YgZnVuY3Rpb25zIHJhdGhlciB0aGFuXG4vLyBhZGRpbmcgYSBwYXJhbWV0ZXIgdG8gZWFjaCBmdW5jdGlvbiBrZXkgdG8gZGVub3RlIHRoZSBtb2RpLVxuLy8gZmllcnMuXG5UZXJtaW5hbC5wcm90b3R5cGUuZGlzYWJsZU1vZGlmaWVycyA9IGZ1bmN0aW9uKHBhcmFtcykgeztcbn07XG5cbi8vIENTSSA+IFBzIHBcbi8vIFNldCByZXNvdXJjZSB2YWx1ZSBwb2ludGVyTW9kZS4gVGhpcyBpcyB1c2VkIGJ5IHh0ZXJtIHRvXG4vLyBkZWNpZGUgd2hldGhlciB0byBoaWRlIHRoZSBwb2ludGVyIGN1cnNvciBhcyB0aGUgdXNlciB0eXBlcy5cbi8vIFZhbGlkIHZhbHVlcyBmb3IgdGhlIHBhcmFtZXRlcjpcbi8vIFBzID0gMCAtPiBuZXZlciBoaWRlIHRoZSBwb2ludGVyLlxuLy8gUHMgPSAxIC0+IGhpZGUgaWYgdGhlIG1vdXNlIHRyYWNraW5nIG1vZGUgaXMgbm90IGVuYWJsZWQuXG4vLyBQcyA9IDIgLT4gYWx3YXlzIGhpZGUgdGhlIHBvaW50ZXIuIElmIG5vIHBhcmFtZXRlciBpc1xuLy8gZ2l2ZW4sIHh0ZXJtIHVzZXMgdGhlIGRlZmF1bHQsIHdoaWNoIGlzIDEgLlxuVGVybWluYWwucHJvdG90eXBlLnNldFBvaW50ZXJNb2RlID0gZnVuY3Rpb24ocGFyYW1zKSB7O1xufTtcblxuLy8gQ1NJICEgcCBTb2Z0IHRlcm1pbmFsIHJlc2V0IChERUNTVFIpLlxuLy8gaHR0cDovL3Z0MTAwLm5ldC9kb2NzL3Z0MjIwLXJtL3RhYmxlNC0xMC5odG1sXG5UZXJtaW5hbC5wcm90b3R5cGUuc29mdFJlc2V0ID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gICAgdGhpcy5jdXJzb3JIaWRkZW4gPSBmYWxzZTtcbiAgICB0aGlzLmluc2VydE1vZGUgPSBmYWxzZTtcbiAgICB0aGlzLm9yaWdpbk1vZGUgPSBmYWxzZTtcbiAgICB0aGlzLndyYXBhcm91bmRNb2RlID0gZmFsc2U7IC8vIGF1dG93cmFwXG4gICAgdGhpcy5hcHBsaWNhdGlvbktleXBhZCA9IGZhbHNlOyAvLyA/XG4gICAgdGhpcy5zY3JvbGxUb3AgPSAwO1xuICAgIHRoaXMuc2Nyb2xsQm90dG9tID0gdGhpcy5yb3dzIC0gMTtcbiAgICB0aGlzLmN1ckF0dHIgPSB0aGlzLmRlZkF0dHI7XG4gICAgdGhpcy54ID0gdGhpcy55ID0gMDsgLy8gP1xuICAgIHRoaXMuY2hhcnNldCA9IG51bGw7XG4gICAgdGhpcy5nbGV2ZWwgPSAwOyAvLyA/P1xuICAgIHRoaXMuY2hhcnNldHMgPSBbbnVsbF07IC8vID8/XG59O1xuXG4vLyBDU0kgUHMkIHBcbi8vIFJlcXVlc3QgQU5TSSBtb2RlIChERUNSUU0pLiBGb3IgVlQzMDAgYW5kIHVwLCByZXBseSBpc1xuLy8gQ1NJIFBzOyBQbSQgeVxuLy8gd2hlcmUgUHMgaXMgdGhlIG1vZGUgbnVtYmVyIGFzIGluIFJNLCBhbmQgUG0gaXMgdGhlIG1vZGVcbi8vIHZhbHVlOlxuLy8gMCAtIG5vdCByZWNvZ25pemVkXG4vLyAxIC0gc2V0XG4vLyAyIC0gcmVzZXRcbi8vIDMgLSBwZXJtYW5lbnRseSBzZXRcbi8vIDQgLSBwZXJtYW5lbnRseSByZXNldFxuVGVybWluYWwucHJvdG90eXBlLnJlcXVlc3RBbnNpTW9kZSA9IGZ1bmN0aW9uKHBhcmFtcykgeztcbn07XG5cbi8vIENTSSA/IFBzJCBwXG4vLyBSZXF1ZXN0IERFQyBwcml2YXRlIG1vZGUgKERFQ1JRTSkuIEZvciBWVDMwMCBhbmQgdXAsIHJlcGx5IGlzXG4vLyBDU0kgPyBQczsgUG0kIHBcbi8vIHdoZXJlIFBzIGlzIHRoZSBtb2RlIG51bWJlciBhcyBpbiBERUNTRVQsIFBtIGlzIHRoZSBtb2RlIHZhbHVlXG4vLyBhcyBpbiB0aGUgQU5TSSBERUNSUU0uXG5UZXJtaW5hbC5wcm90b3R5cGUucmVxdWVzdFByaXZhdGVNb2RlID0gZnVuY3Rpb24ocGFyYW1zKSB7O1xufTtcblxuLy8gQ1NJIFBzIDsgUHMgXCIgcFxuLy8gU2V0IGNvbmZvcm1hbmNlIGxldmVsIChERUNTQ0wpLiBWYWxpZCB2YWx1ZXMgZm9yIHRoZSBmaXJzdFxuLy8gcGFyYW1ldGVyOlxuLy8gUHMgPSA2IDEgLT4gVlQxMDAuXG4vLyBQcyA9IDYgMiAtPiBWVDIwMC5cbi8vIFBzID0gNiAzIC0+IFZUMzAwLlxuLy8gVmFsaWQgdmFsdWVzIGZvciB0aGUgc2Vjb25kIHBhcmFtZXRlcjpcbi8vIFBzID0gMCAtPiA4LWJpdCBjb250cm9scy5cbi8vIFBzID0gMSAtPiA3LWJpdCBjb250cm9scyAoYWx3YXlzIHNldCBmb3IgVlQxMDApLlxuLy8gUHMgPSAyIC0+IDgtYml0IGNvbnRyb2xzLlxuVGVybWluYWwucHJvdG90eXBlLnNldENvbmZvcm1hbmNlTGV2ZWwgPSBmdW5jdGlvbihwYXJhbXMpIHs7XG59O1xuXG4vLyBDU0kgUHMgcSBMb2FkIExFRHMgKERFQ0xMKS5cbi8vIFBzID0gMCAtPiBDbGVhciBhbGwgTEVEUyAoZGVmYXVsdCkuXG4vLyBQcyA9IDEgLT4gTGlnaHQgTnVtIExvY2suXG4vLyBQcyA9IDIgLT4gTGlnaHQgQ2FwcyBMb2NrLlxuLy8gUHMgPSAzIC0+IExpZ2h0IFNjcm9sbCBMb2NrLlxuLy8gUHMgPSAyIDEgLT4gRXh0aW5ndWlzaCBOdW0gTG9jay5cbi8vIFBzID0gMiAyIC0+IEV4dGluZ3Vpc2ggQ2FwcyBMb2NrLlxuLy8gUHMgPSAyIDMgLT4gRXh0aW5ndWlzaCBTY3JvbGwgTG9jay5cblRlcm1pbmFsLnByb3RvdHlwZS5sb2FkTEVEcyA9IGZ1bmN0aW9uKHBhcmFtcykgeztcbn07XG5cbi8vIENTSSBQcyBTUCBxXG4vLyBTZXQgY3Vyc29yIHN0eWxlIChERUNTQ1VTUiwgVlQ1MjApLlxuLy8gUHMgPSAwIC0+IGJsaW5raW5nIGJsb2NrLlxuLy8gUHMgPSAxIC0+IGJsaW5raW5nIGJsb2NrIChkZWZhdWx0KS5cbi8vIFBzID0gMiAtPiBzdGVhZHkgYmxvY2suXG4vLyBQcyA9IDMgLT4gYmxpbmtpbmcgdW5kZXJsaW5lLlxuLy8gUHMgPSA0IC0+IHN0ZWFkeSB1bmRlcmxpbmUuXG5UZXJtaW5hbC5wcm90b3R5cGUuc2V0Q3Vyc29yU3R5bGUgPSBmdW5jdGlvbihwYXJhbXMpIHs7XG59O1xuXG4vLyBDU0kgUHMgXCIgcVxuLy8gU2VsZWN0IGNoYXJhY3RlciBwcm90ZWN0aW9uIGF0dHJpYnV0ZSAoREVDU0NBKS4gVmFsaWQgdmFsdWVzXG4vLyBmb3IgdGhlIHBhcmFtZXRlcjpcbi8vIFBzID0gMCAtPiBERUNTRUQgYW5kIERFQ1NFTCBjYW4gZXJhc2UgKGRlZmF1bHQpLlxuLy8gUHMgPSAxIC0+IERFQ1NFRCBhbmQgREVDU0VMIGNhbm5vdCBlcmFzZS5cbi8vIFBzID0gMiAtPiBERUNTRUQgYW5kIERFQ1NFTCBjYW4gZXJhc2UuXG5UZXJtaW5hbC5wcm90b3R5cGUuc2V0Q2hhclByb3RlY3Rpb25BdHRyID0gZnVuY3Rpb24ocGFyYW1zKSB7O1xufTtcblxuLy8gQ1NJID8gUG0gclxuLy8gUmVzdG9yZSBERUMgUHJpdmF0ZSBNb2RlIFZhbHVlcy4gVGhlIHZhbHVlIG9mIFBzIHByZXZpb3VzbHlcbi8vIHNhdmVkIGlzIHJlc3RvcmVkLiBQcyB2YWx1ZXMgYXJlIHRoZSBzYW1lIGFzIGZvciBERUNTRVQuXG5UZXJtaW5hbC5wcm90b3R5cGUucmVzdG9yZVByaXZhdGVWYWx1ZXMgPSBmdW5jdGlvbihwYXJhbXMpIHs7XG59O1xuXG4vLyBDU0kgUHQ7IFBsOyBQYjsgUHI7IFBzJCByXG4vLyBDaGFuZ2UgQXR0cmlidXRlcyBpbiBSZWN0YW5ndWxhciBBcmVhIChERUNDQVJBKSwgVlQ0MDAgYW5kIHVwLlxuLy8gUHQ7IFBsOyBQYjsgUHIgZGVub3RlcyB0aGUgcmVjdGFuZ2xlLlxuLy8gUHMgZGVub3RlcyB0aGUgU0dSIGF0dHJpYnV0ZXMgdG8gY2hhbmdlOiAwLCAxLCA0LCA1LCA3LlxuLy8gTk9URTogeHRlcm0gZG9lc24ndCBlbmFibGUgdGhpcyBjb2RlIGJ5IGRlZmF1bHQuXG5UZXJtaW5hbC5wcm90b3R5cGUuc2V0QXR0ckluUmVjdGFuZ2xlID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gICAgdmFyIHQgPSBwYXJhbXNbMF0sXG4gICAgICAgIGwgPSBwYXJhbXNbMV0sXG4gICAgICAgIGIgPSBwYXJhbXNbMl0sXG4gICAgICAgIHIgPSBwYXJhbXNbM10sXG4gICAgICAgIGF0dHIgPSBwYXJhbXNbNF07XG5cbiAgICB2YXIgbGluZSwgaTtcblxuICAgIGZvciAoOyB0IDwgYiArIDE7IHQrKykge1xuICAgICAgICBsaW5lID0gdGhpcy5saW5lc1t0aGlzLnliYXNlICsgdF07XG4gICAgICAgIGZvciAoaSA9IGw7IGkgPCByOyBpKyspIHtcbiAgICAgICAgICAgIGxpbmVbaV0gPSBbYXR0ciwgbGluZVtpXVsxXV07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyB0aGlzLm1heFJhbmdlKCk7XG4gICAgdGhpcy51cGRhdGVSYW5nZShwYXJhbXNbMF0pO1xuICAgIHRoaXMudXBkYXRlUmFuZ2UocGFyYW1zWzJdKTtcbn07XG5cbi8vIENTSSA/IFBtIHNcbi8vIFNhdmUgREVDIFByaXZhdGUgTW9kZSBWYWx1ZXMuIFBzIHZhbHVlcyBhcmUgdGhlIHNhbWUgYXMgZm9yXG4vLyBERUNTRVQuXG5UZXJtaW5hbC5wcm90b3R5cGUuc2F2ZVByaXZhdGVWYWx1ZXMgPSBmdW5jdGlvbihwYXJhbXMpIHs7XG59O1xuXG4vLyBDU0kgUHMgOyBQcyA7IFBzIHRcbi8vIFdpbmRvdyBtYW5pcHVsYXRpb24gKGZyb20gZHR0ZXJtLCBhcyB3ZWxsIGFzIGV4dGVuc2lvbnMpLlxuLy8gVGhlc2UgY29udHJvbHMgbWF5IGJlIGRpc2FibGVkIHVzaW5nIHRoZSBhbGxvd1dpbmRvd09wc1xuLy8gcmVzb3VyY2UuIFZhbGlkIHZhbHVlcyBmb3IgdGhlIGZpcnN0IChhbmQgYW55IGFkZGl0aW9uYWxcbi8vIHBhcmFtZXRlcnMpIGFyZTpcbi8vIFBzID0gMSAtPiBEZS1pY29uaWZ5IHdpbmRvdy5cbi8vIFBzID0gMiAtPiBJY29uaWZ5IHdpbmRvdy5cbi8vIFBzID0gMyA7IHggOyB5IC0+IE1vdmUgd2luZG93IHRvIFt4LCB5XS5cbi8vIFBzID0gNCA7IGhlaWdodCA7IHdpZHRoIC0+IFJlc2l6ZSB0aGUgeHRlcm0gd2luZG93IHRvXG4vLyBoZWlnaHQgYW5kIHdpZHRoIGluIHBpeGVscy5cbi8vIFBzID0gNSAtPiBSYWlzZSB0aGUgeHRlcm0gd2luZG93IHRvIHRoZSBmcm9udCBvZiB0aGUgc3RhY2stXG4vLyBpbmcgb3JkZXIuXG4vLyBQcyA9IDYgLT4gTG93ZXIgdGhlIHh0ZXJtIHdpbmRvdyB0byB0aGUgYm90dG9tIG9mIHRoZVxuLy8gc3RhY2tpbmcgb3JkZXIuXG4vLyBQcyA9IDcgLT4gUmVmcmVzaCB0aGUgeHRlcm0gd2luZG93LlxuLy8gUHMgPSA4IDsgaGVpZ2h0IDsgd2lkdGggLT4gUmVzaXplIHRoZSB0ZXh0IGFyZWEgdG9cbi8vIFtoZWlnaHQ7d2lkdGhdIGluIGNoYXJhY3RlcnMuXG4vLyBQcyA9IDkgOyAwIC0+IFJlc3RvcmUgbWF4aW1pemVkIHdpbmRvdy5cbi8vIFBzID0gOSA7IDEgLT4gTWF4aW1pemUgd2luZG93IChpLmUuLCByZXNpemUgdG8gc2NyZWVuXG4vLyBzaXplKS5cbi8vIFBzID0gMSAwIDsgMCAtPiBVbmRvIGZ1bGwtc2NyZWVuIG1vZGUuXG4vLyBQcyA9IDEgMCA7IDEgLT4gQ2hhbmdlIHRvIGZ1bGwtc2NyZWVuLlxuLy8gUHMgPSAxIDEgLT4gUmVwb3J0IHh0ZXJtIHdpbmRvdyBzdGF0ZS4gSWYgdGhlIHh0ZXJtIHdpbmRvd1xuLy8gaXMgb3BlbiAobm9uLWljb25pZmllZCksIGl0IHJldHVybnMgQ1NJIDEgdCAuIElmIHRoZSB4dGVybVxuLy8gd2luZG93IGlzIGljb25pZmllZCwgaXQgcmV0dXJucyBDU0kgMiB0IC5cbi8vIFBzID0gMSAzIC0+IFJlcG9ydCB4dGVybSB3aW5kb3cgcG9zaXRpb24uIFJlc3VsdCBpcyBDU0kgM1xuLy8gOyB4IDsgeSB0XG4vLyBQcyA9IDEgNCAtPiBSZXBvcnQgeHRlcm0gd2luZG93IGluIHBpeGVscy4gUmVzdWx0IGlzIENTSVxuLy8gNCA7IGhlaWdodCA7IHdpZHRoIHRcbi8vIFBzID0gMSA4IC0+IFJlcG9ydCB0aGUgc2l6ZSBvZiB0aGUgdGV4dCBhcmVhIGluIGNoYXJhY3RlcnMuXG4vLyBSZXN1bHQgaXMgQ1NJIDggOyBoZWlnaHQgOyB3aWR0aCB0XG4vLyBQcyA9IDEgOSAtPiBSZXBvcnQgdGhlIHNpemUgb2YgdGhlIHNjcmVlbiBpbiBjaGFyYWN0ZXJzLlxuLy8gUmVzdWx0IGlzIENTSSA5IDsgaGVpZ2h0IDsgd2lkdGggdFxuLy8gUHMgPSAyIDAgLT4gUmVwb3J0IHh0ZXJtIHdpbmRvdydzIGljb24gbGFiZWwuIFJlc3VsdCBpc1xuLy8gT1NDIEwgbGFiZWwgU1Rcbi8vIFBzID0gMiAxIC0+IFJlcG9ydCB4dGVybSB3aW5kb3cncyB0aXRsZS4gUmVzdWx0IGlzIE9TQyBsXG4vLyBsYWJlbCBTVFxuLy8gUHMgPSAyIDIgOyAwIC0+IFNhdmUgeHRlcm0gaWNvbiBhbmQgd2luZG93IHRpdGxlIG9uXG4vLyBzdGFjay5cbi8vIFBzID0gMiAyIDsgMSAtPiBTYXZlIHh0ZXJtIGljb24gdGl0bGUgb24gc3RhY2suXG4vLyBQcyA9IDIgMiA7IDIgLT4gU2F2ZSB4dGVybSB3aW5kb3cgdGl0bGUgb24gc3RhY2suXG4vLyBQcyA9IDIgMyA7IDAgLT4gUmVzdG9yZSB4dGVybSBpY29uIGFuZCB3aW5kb3cgdGl0bGUgZnJvbVxuLy8gc3RhY2suXG4vLyBQcyA9IDIgMyA7IDEgLT4gUmVzdG9yZSB4dGVybSBpY29uIHRpdGxlIGZyb20gc3RhY2suXG4vLyBQcyA9IDIgMyA7IDIgLT4gUmVzdG9yZSB4dGVybSB3aW5kb3cgdGl0bGUgZnJvbSBzdGFjay5cbi8vIFBzID49IDIgNCAtPiBSZXNpemUgdG8gUHMgbGluZXMgKERFQ1NMUFApLlxuVGVybWluYWwucHJvdG90eXBlLm1hbmlwdWxhdGVXaW5kb3cgPSBmdW5jdGlvbihwYXJhbXMpIHs7XG59O1xuXG4vLyBDU0kgUHQ7IFBsOyBQYjsgUHI7IFBzJCB0XG4vLyBSZXZlcnNlIEF0dHJpYnV0ZXMgaW4gUmVjdGFuZ3VsYXIgQXJlYSAoREVDUkFSQSksIFZUNDAwIGFuZFxuLy8gdXAuXG4vLyBQdDsgUGw7IFBiOyBQciBkZW5vdGVzIHRoZSByZWN0YW5nbGUuXG4vLyBQcyBkZW5vdGVzIHRoZSBhdHRyaWJ1dGVzIHRvIHJldmVyc2UsIGkuZS4sIDEsIDQsIDUsIDcuXG4vLyBOT1RFOiB4dGVybSBkb2Vzbid0IGVuYWJsZSB0aGlzIGNvZGUgYnkgZGVmYXVsdC5cblRlcm1pbmFsLnByb3RvdHlwZS5yZXZlcnNlQXR0ckluUmVjdGFuZ2xlID0gZnVuY3Rpb24ocGFyYW1zKSB7O1xufTtcblxuLy8gQ1NJID4gUHM7IFBzIHRcbi8vIFNldCBvbmUgb3IgbW9yZSBmZWF0dXJlcyBvZiB0aGUgdGl0bGUgbW9kZXMuIEVhY2ggcGFyYW1ldGVyXG4vLyBlbmFibGVzIGEgc2luZ2xlIGZlYXR1cmUuXG4vLyBQcyA9IDAgLT4gU2V0IHdpbmRvdy9pY29uIGxhYmVscyB1c2luZyBoZXhhZGVjaW1hbC5cbi8vIFBzID0gMSAtPiBRdWVyeSB3aW5kb3cvaWNvbiBsYWJlbHMgdXNpbmcgaGV4YWRlY2ltYWwuXG4vLyBQcyA9IDIgLT4gU2V0IHdpbmRvdy9pY29uIGxhYmVscyB1c2luZyBVVEYtOC5cbi8vIFBzID0gMyAtPiBRdWVyeSB3aW5kb3cvaWNvbiBsYWJlbHMgdXNpbmcgVVRGLTguIChTZWUgZGlzLVxuLy8gY3Vzc2lvbiBvZiBcIlRpdGxlIE1vZGVzXCIpXG5UZXJtaW5hbC5wcm90b3R5cGUuc2V0VGl0bGVNb2RlRmVhdHVyZSA9IGZ1bmN0aW9uKHBhcmFtcykgeztcbn07XG5cbi8vIENTSSBQcyBTUCB0XG4vLyBTZXQgd2FybmluZy1iZWxsIHZvbHVtZSAoREVDU1dCViwgVlQ1MjApLlxuLy8gUHMgPSAwIG9yIDEgLT4gb2ZmLlxuLy8gUHMgPSAyICwgMyBvciA0IC0+IGxvdy5cbi8vIFBzID0gNSAsIDYgLCA3ICwgb3IgOCAtPiBoaWdoLlxuVGVybWluYWwucHJvdG90eXBlLnNldFdhcm5pbmdCZWxsVm9sdW1lID0gZnVuY3Rpb24ocGFyYW1zKSB7O1xufTtcblxuLy8gQ1NJIFBzIFNQIHVcbi8vIFNldCBtYXJnaW4tYmVsbCB2b2x1bWUgKERFQ1NNQlYsIFZUNTIwKS5cbi8vIFBzID0gMSAtPiBvZmYuXG4vLyBQcyA9IDIgLCAzIG9yIDQgLT4gbG93LlxuLy8gUHMgPSAwICwgNSAsIDYgLCA3ICwgb3IgOCAtPiBoaWdoLlxuVGVybWluYWwucHJvdG90eXBlLnNldE1hcmdpbkJlbGxWb2x1bWUgPSBmdW5jdGlvbihwYXJhbXMpIHs7XG59O1xuXG4vLyBDU0kgUHQ7IFBsOyBQYjsgUHI7IFBwOyBQdDsgUGw7IFBwJCB2XG4vLyBDb3B5IFJlY3Rhbmd1bGFyIEFyZWEgKERFQ0NSQSwgVlQ0MDAgYW5kIHVwKS5cbi8vIFB0OyBQbDsgUGI7IFByIGRlbm90ZXMgdGhlIHJlY3RhbmdsZS5cbi8vIFBwIGRlbm90ZXMgdGhlIHNvdXJjZSBwYWdlLlxuLy8gUHQ7IFBsIGRlbm90ZXMgdGhlIHRhcmdldCBsb2NhdGlvbi5cbi8vIFBwIGRlbm90ZXMgdGhlIHRhcmdldCBwYWdlLlxuLy8gTk9URTogeHRlcm0gZG9lc24ndCBlbmFibGUgdGhpcyBjb2RlIGJ5IGRlZmF1bHQuXG5UZXJtaW5hbC5wcm90b3R5cGUuY29weVJlY3RhbmdsZSA9IGZ1bmN0aW9uKHBhcmFtcykgeztcbn07XG5cbi8vIENTSSBQdCA7IFBsIDsgUGIgOyBQciAnIHdcbi8vIEVuYWJsZSBGaWx0ZXIgUmVjdGFuZ2xlIChERUNFRlIpLCBWVDQyMCBhbmQgdXAuXG4vLyBQYXJhbWV0ZXJzIGFyZSBbdG9wO2xlZnQ7Ym90dG9tO3JpZ2h0XS5cbi8vIERlZmluZXMgdGhlIGNvb3JkaW5hdGVzIG9mIGEgZmlsdGVyIHJlY3RhbmdsZSBhbmQgYWN0aXZhdGVzXG4vLyBpdC4gQW55dGltZSB0aGUgbG9jYXRvciBpcyBkZXRlY3RlZCBvdXRzaWRlIG9mIHRoZSBmaWx0ZXJcbi8vIHJlY3RhbmdsZSwgYW4gb3V0c2lkZSByZWN0YW5nbGUgZXZlbnQgaXMgZ2VuZXJhdGVkIGFuZCB0aGVcbi8vIHJlY3RhbmdsZSBpcyBkaXNhYmxlZC4gRmlsdGVyIHJlY3RhbmdsZXMgYXJlIGFsd2F5cyB0cmVhdGVkXG4vLyBhcyBcIm9uZS1zaG90XCIgZXZlbnRzLiBBbnkgcGFyYW1ldGVycyB0aGF0IGFyZSBvbWl0dGVkIGRlZmF1bHRcbi8vIHRvIHRoZSBjdXJyZW50IGxvY2F0b3IgcG9zaXRpb24uIElmIGFsbCBwYXJhbWV0ZXJzIGFyZSBvbWl0LVxuLy8gdGVkLCBhbnkgbG9jYXRvciBtb3Rpb24gd2lsbCBiZSByZXBvcnRlZC4gREVDRUxSIGFsd2F5cyBjYW4tXG4vLyBjZWxzIGFueSBwcmV2b3VzIHJlY3RhbmdsZSBkZWZpbml0aW9uLlxuVGVybWluYWwucHJvdG90eXBlLmVuYWJsZUZpbHRlclJlY3RhbmdsZSA9IGZ1bmN0aW9uKHBhcmFtcykgeztcbn07XG5cbi8vIENTSSBQcyB4IFJlcXVlc3QgVGVybWluYWwgUGFyYW1ldGVycyAoREVDUkVRVFBBUk0pLlxuLy8gaWYgUHMgaXMgYSBcIjBcIiAoZGVmYXVsdCkgb3IgXCIxXCIsIGFuZCB4dGVybSBpcyBlbXVsYXRpbmcgVlQxMDAsXG4vLyB0aGUgY29udHJvbCBzZXF1ZW5jZSBlbGljaXRzIGEgcmVzcG9uc2Ugb2YgdGhlIHNhbWUgZm9ybSB3aG9zZVxuLy8gcGFyYW1ldGVycyBkZXNjcmliZSB0aGUgdGVybWluYWw6XG4vLyBQcyAtPiB0aGUgZ2l2ZW4gUHMgaW5jcmVtZW50ZWQgYnkgMi5cbi8vIFBuID0gMSA8LSBubyBwYXJpdHkuXG4vLyBQbiA9IDEgPC0gZWlnaHQgYml0cy5cbi8vIFBuID0gMSA8LSAyIDggdHJhbnNtaXQgMzguNGsgYmF1ZC5cbi8vIFBuID0gMSA8LSAyIDggcmVjZWl2ZSAzOC40ayBiYXVkLlxuLy8gUG4gPSAxIDwtIGNsb2NrIG11bHRpcGxpZXIuXG4vLyBQbiA9IDAgPC0gU1RQIGZsYWdzLlxuVGVybWluYWwucHJvdG90eXBlLnJlcXVlc3RQYXJhbWV0ZXJzID0gZnVuY3Rpb24ocGFyYW1zKSB7O1xufTtcblxuLy8gQ1NJIFBzIHggU2VsZWN0IEF0dHJpYnV0ZSBDaGFuZ2UgRXh0ZW50IChERUNTQUNFKS5cbi8vIFBzID0gMCAtPiBmcm9tIHN0YXJ0IHRvIGVuZCBwb3NpdGlvbiwgd3JhcHBlZC5cbi8vIFBzID0gMSAtPiBmcm9tIHN0YXJ0IHRvIGVuZCBwb3NpdGlvbiwgd3JhcHBlZC5cbi8vIFBzID0gMiAtPiByZWN0YW5nbGUgKGV4YWN0KS5cblRlcm1pbmFsLnByb3RvdHlwZS5zZWxlY3RDaGFuZ2VFeHRlbnQgPSBmdW5jdGlvbihwYXJhbXMpIHs7XG59O1xuXG4vLyBDU0kgUGM7IFB0OyBQbDsgUGI7IFByJCB4XG4vLyBGaWxsIFJlY3Rhbmd1bGFyIEFyZWEgKERFQ0ZSQSksIFZUNDIwIGFuZCB1cC5cbi8vIFBjIGlzIHRoZSBjaGFyYWN0ZXIgdG8gdXNlLlxuLy8gUHQ7IFBsOyBQYjsgUHIgZGVub3RlcyB0aGUgcmVjdGFuZ2xlLlxuLy8gTk9URTogeHRlcm0gZG9lc24ndCBlbmFibGUgdGhpcyBjb2RlIGJ5IGRlZmF1bHQuXG5UZXJtaW5hbC5wcm90b3R5cGUuZmlsbFJlY3RhbmdsZSA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICAgIHZhciBjaCA9IHBhcmFtc1swXSxcbiAgICAgICAgdCA9IHBhcmFtc1sxXSxcbiAgICAgICAgbCA9IHBhcmFtc1syXSxcbiAgICAgICAgYiA9IHBhcmFtc1szXSxcbiAgICAgICAgciA9IHBhcmFtc1s0XTtcblxuICAgIHZhciBsaW5lLCBpO1xuXG4gICAgZm9yICg7IHQgPCBiICsgMTsgdCsrKSB7XG4gICAgICAgIGxpbmUgPSB0aGlzLmxpbmVzW3RoaXMueWJhc2UgKyB0XTtcbiAgICAgICAgZm9yIChpID0gbDsgaSA8IHI7IGkrKykge1xuICAgICAgICAgICAgbGluZVtpXSA9IFtsaW5lW2ldWzBdLCBTdHJpbmcuZnJvbUNoYXJDb2RlKGNoKV07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyB0aGlzLm1heFJhbmdlKCk7XG4gICAgdGhpcy51cGRhdGVSYW5nZShwYXJhbXNbMV0pO1xuICAgIHRoaXMudXBkYXRlUmFuZ2UocGFyYW1zWzNdKTtcbn07XG5cbi8vIENTSSBQcyA7IFB1ICcgelxuLy8gRW5hYmxlIExvY2F0b3IgUmVwb3J0aW5nIChERUNFTFIpLlxuLy8gVmFsaWQgdmFsdWVzIGZvciB0aGUgZmlyc3QgcGFyYW1ldGVyOlxuLy8gUHMgPSAwIC0+IExvY2F0b3IgZGlzYWJsZWQgKGRlZmF1bHQpLlxuLy8gUHMgPSAxIC0+IExvY2F0b3IgZW5hYmxlZC5cbi8vIFBzID0gMiAtPiBMb2NhdG9yIGVuYWJsZWQgZm9yIG9uZSByZXBvcnQsIHRoZW4gZGlzYWJsZWQuXG4vLyBUaGUgc2Vjb25kIHBhcmFtZXRlciBzcGVjaWZpZXMgdGhlIGNvb3JkaW5hdGUgdW5pdCBmb3IgbG9jYXRvclxuLy8gcmVwb3J0cy5cbi8vIFZhbGlkIHZhbHVlcyBmb3IgdGhlIHNlY29uZCBwYXJhbWV0ZXI6XG4vLyBQdSA9IDAgPC0gb3Igb21pdHRlZCAtPiBkZWZhdWx0IHRvIGNoYXJhY3RlciBjZWxscy5cbi8vIFB1ID0gMSA8LSBkZXZpY2UgcGh5c2ljYWwgcGl4ZWxzLlxuLy8gUHUgPSAyIDwtIGNoYXJhY3RlciBjZWxscy5cblRlcm1pbmFsLnByb3RvdHlwZS5lbmFibGVMb2NhdG9yUmVwb3J0aW5nID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gICAgdmFyIHZhbCA9IHBhcmFtc1swXSA+IDA7XG4gICAgLy90aGlzLm1vdXNlRXZlbnRzID0gdmFsO1xuICAgIC8vdGhpcy5kZWNMb2NhdG9yID0gdmFsO1xufTtcblxuLy8gQ1NJIFB0OyBQbDsgUGI7IFByJCB6XG4vLyBFcmFzZSBSZWN0YW5ndWxhciBBcmVhIChERUNFUkEpLCBWVDQwMCBhbmQgdXAuXG4vLyBQdDsgUGw7IFBiOyBQciBkZW5vdGVzIHRoZSByZWN0YW5nbGUuXG4vLyBOT1RFOiB4dGVybSBkb2Vzbid0IGVuYWJsZSB0aGlzIGNvZGUgYnkgZGVmYXVsdC5cblRlcm1pbmFsLnByb3RvdHlwZS5lcmFzZVJlY3RhbmdsZSA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICAgIHZhciB0ID0gcGFyYW1zWzBdLFxuICAgICAgICBsID0gcGFyYW1zWzFdLFxuICAgICAgICBiID0gcGFyYW1zWzJdLFxuICAgICAgICByID0gcGFyYW1zWzNdO1xuXG4gICAgdmFyIGxpbmUsIGksIGNoO1xuXG4gICAgY2ggPSBbdGhpcy5jdXJBdHRyLCAnICddOyAvLyB4dGVybT9cblxuICAgIGZvciAoOyB0IDwgYiArIDE7IHQrKykge1xuICAgICAgICBsaW5lID0gdGhpcy5saW5lc1t0aGlzLnliYXNlICsgdF07XG4gICAgICAgIGZvciAoaSA9IGw7IGkgPCByOyBpKyspIHtcbiAgICAgICAgICAgIGxpbmVbaV0gPSBjaDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIHRoaXMubWF4UmFuZ2UoKTtcbiAgICB0aGlzLnVwZGF0ZVJhbmdlKHBhcmFtc1swXSk7XG4gICAgdGhpcy51cGRhdGVSYW5nZShwYXJhbXNbMl0pO1xufTtcblxuLy8gQ1NJIFBtICcge1xuLy8gU2VsZWN0IExvY2F0b3IgRXZlbnRzIChERUNTTEUpLlxuLy8gVmFsaWQgdmFsdWVzIGZvciB0aGUgZmlyc3QgKGFuZCBhbnkgYWRkaXRpb25hbCBwYXJhbWV0ZXJzKVxuLy8gYXJlOlxuLy8gUHMgPSAwIC0+IG9ubHkgcmVzcG9uZCB0byBleHBsaWNpdCBob3N0IHJlcXVlc3RzIChERUNSUUxQKS5cbi8vIChUaGlzIGlzIGRlZmF1bHQpLiBJdCBhbHNvIGNhbmNlbHMgYW55IGZpbHRlclxuLy8gcmVjdGFuZ2xlLlxuLy8gUHMgPSAxIC0+IHJlcG9ydCBidXR0b24gZG93biB0cmFuc2l0aW9ucy5cbi8vIFBzID0gMiAtPiBkbyBub3QgcmVwb3J0IGJ1dHRvbiBkb3duIHRyYW5zaXRpb25zLlxuLy8gUHMgPSAzIC0+IHJlcG9ydCBidXR0b24gdXAgdHJhbnNpdGlvbnMuXG4vLyBQcyA9IDQgLT4gZG8gbm90IHJlcG9ydCBidXR0b24gdXAgdHJhbnNpdGlvbnMuXG5UZXJtaW5hbC5wcm90b3R5cGUuc2V0TG9jYXRvckV2ZW50cyA9IGZ1bmN0aW9uKHBhcmFtcykgeztcbn07XG5cbi8vIENTSSBQdDsgUGw7IFBiOyBQciQge1xuLy8gU2VsZWN0aXZlIEVyYXNlIFJlY3Rhbmd1bGFyIEFyZWEgKERFQ1NFUkEpLCBWVDQwMCBhbmQgdXAuXG4vLyBQdDsgUGw7IFBiOyBQciBkZW5vdGVzIHRoZSByZWN0YW5nbGUuXG5UZXJtaW5hbC5wcm90b3R5cGUuc2VsZWN0aXZlRXJhc2VSZWN0YW5nbGUgPSBmdW5jdGlvbihwYXJhbXMpIHs7XG59O1xuXG4vLyBDU0kgUHMgJyB8XG4vLyBSZXF1ZXN0IExvY2F0b3IgUG9zaXRpb24gKERFQ1JRTFApLlxuLy8gVmFsaWQgdmFsdWVzIGZvciB0aGUgcGFyYW1ldGVyIGFyZTpcbi8vIFBzID0gMCAsIDEgb3Igb21pdHRlZCAtPiB0cmFuc21pdCBhIHNpbmdsZSBERUNMUlAgbG9jYXRvclxuLy8gcmVwb3J0LlxuXG4vLyBJZiBMb2NhdG9yIFJlcG9ydGluZyBoYXMgYmVlbiBlbmFibGVkIGJ5IGEgREVDRUxSLCB4dGVybSB3aWxsXG4vLyByZXNwb25kIHdpdGggYSBERUNMUlAgTG9jYXRvciBSZXBvcnQuIFRoaXMgcmVwb3J0IGlzIGFsc29cbi8vIGdlbmVyYXRlZCBvbiBidXR0b24gdXAgYW5kIGRvd24gZXZlbnRzIGlmIHRoZXkgaGF2ZSBiZWVuXG4vLyBlbmFibGVkIHdpdGggYSBERUNTTEUsIG9yIHdoZW4gdGhlIGxvY2F0b3IgaXMgZGV0ZWN0ZWQgb3V0c2lkZVxuLy8gb2YgYSBmaWx0ZXIgcmVjdGFuZ2xlLCBpZiBmaWx0ZXIgcmVjdGFuZ2xlcyBoYXZlIGJlZW4gZW5hYmxlZFxuLy8gd2l0aCBhIERFQ0VGUi5cblxuLy8gLT4gQ1NJIFBlIDsgUGIgOyBQciA7IFBjIDsgUHAgJiB3XG5cbi8vIFBhcmFtZXRlcnMgYXJlIFtldmVudDtidXR0b247cm93O2NvbHVtbjtwYWdlXS5cbi8vIFZhbGlkIHZhbHVlcyBmb3IgdGhlIGV2ZW50OlxuLy8gUGUgPSAwIC0+IGxvY2F0b3IgdW5hdmFpbGFibGUgLSBubyBvdGhlciBwYXJhbWV0ZXJzIHNlbnQuXG4vLyBQZSA9IDEgLT4gcmVxdWVzdCAtIHh0ZXJtIHJlY2VpdmVkIGEgREVDUlFMUC5cbi8vIFBlID0gMiAtPiBsZWZ0IGJ1dHRvbiBkb3duLlxuLy8gUGUgPSAzIC0+IGxlZnQgYnV0dG9uIHVwLlxuLy8gUGUgPSA0IC0+IG1pZGRsZSBidXR0b24gZG93bi5cbi8vIFBlID0gNSAtPiBtaWRkbGUgYnV0dG9uIHVwLlxuLy8gUGUgPSA2IC0+IHJpZ2h0IGJ1dHRvbiBkb3duLlxuLy8gUGUgPSA3IC0+IHJpZ2h0IGJ1dHRvbiB1cC5cbi8vIFBlID0gOCAtPiBNNCBidXR0b24gZG93bi5cbi8vIFBlID0gOSAtPiBNNCBidXR0b24gdXAuXG4vLyBQZSA9IDEgMCAtPiBsb2NhdG9yIG91dHNpZGUgZmlsdGVyIHJlY3RhbmdsZS5cbi8vIGBgYnV0dG9uJycgcGFyYW1ldGVyIGlzIGEgYml0bWFzayBpbmRpY2F0aW5nIHdoaWNoIGJ1dHRvbnMgYXJlXG4vLyBwcmVzc2VkOlxuLy8gUGIgPSAwIDwtIG5vIGJ1dHRvbnMgZG93bi5cbi8vIFBiICYgMSA8LSByaWdodCBidXR0b24gZG93bi5cbi8vIFBiICYgMiA8LSBtaWRkbGUgYnV0dG9uIGRvd24uXG4vLyBQYiAmIDQgPC0gbGVmdCBidXR0b24gZG93bi5cbi8vIFBiICYgOCA8LSBNNCBidXR0b24gZG93bi5cbi8vIGBgcm93JycgYW5kIGBgY29sdW1uJycgcGFyYW1ldGVycyBhcmUgdGhlIGNvb3JkaW5hdGVzIG9mIHRoZVxuLy8gbG9jYXRvciBwb3NpdGlvbiBpbiB0aGUgeHRlcm0gd2luZG93LCBlbmNvZGVkIGFzIEFTQ0lJIGRlY2ktXG4vLyBtYWwuXG4vLyBUaGUgYGBwYWdlJycgcGFyYW1ldGVyIGlzIG5vdCB1c2VkIGJ5IHh0ZXJtLCBhbmQgd2lsbCBiZSBvbWl0LVxuLy8gdGVkLlxuVGVybWluYWwucHJvdG90eXBlLnJlcXVlc3RMb2NhdG9yUG9zaXRpb24gPSBmdW5jdGlvbihwYXJhbXMpIHs7XG59O1xuXG4vLyBDU0kgUCBtIFNQIH1cbi8vIEluc2VydCBQIHMgQ29sdW1uKHMpIChkZWZhdWx0ID0gMSkgKERFQ0lDKSwgVlQ0MjAgYW5kIHVwLlxuLy8gTk9URTogeHRlcm0gZG9lc24ndCBlbmFibGUgdGhpcyBjb2RlIGJ5IGRlZmF1bHQuXG5UZXJtaW5hbC5wcm90b3R5cGUuaW5zZXJ0Q29sdW1ucyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBwYXJhbSA9IHBhcmFtc1swXSxcbiAgICAgICAgbCA9IHRoaXMueWJhc2UgKyB0aGlzLnJvd3MsXG4gICAgICAgIGNoID0gW3RoaXMuY3VyQXR0ciwgJyAnXSAvLyB4dGVybT9cbiAgICAgICAgLFxuICAgICAgICBpO1xuXG4gICAgd2hpbGUgKHBhcmFtLS0pIHtcbiAgICAgICAgZm9yIChpID0gdGhpcy55YmFzZTsgaSA8IGw7IGkrKykge1xuICAgICAgICAgICAgdGhpcy5saW5lc1tpXS5zcGxpY2UodGhpcy54ICsgMSwgMCwgY2gpO1xuICAgICAgICAgICAgdGhpcy5saW5lc1tpXS5wb3AoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMubWF4UmFuZ2UoKTtcbn07XG5cbi8vIENTSSBQIG0gU1AgflxuLy8gRGVsZXRlIFAgcyBDb2x1bW4ocykgKGRlZmF1bHQgPSAxKSAoREVDREMpLCBWVDQyMCBhbmQgdXBcbi8vIE5PVEU6IHh0ZXJtIGRvZXNuJ3QgZW5hYmxlIHRoaXMgY29kZSBieSBkZWZhdWx0LlxuVGVybWluYWwucHJvdG90eXBlLmRlbGV0ZUNvbHVtbnMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcGFyYW0gPSBwYXJhbXNbMF0sXG4gICAgICAgIGwgPSB0aGlzLnliYXNlICsgdGhpcy5yb3dzLFxuICAgICAgICBjaCA9IFt0aGlzLmN1ckF0dHIsICcgJ10gLy8geHRlcm0/XG4gICAgICAgICxcbiAgICAgICAgaTtcblxuICAgIHdoaWxlIChwYXJhbS0tKSB7XG4gICAgICAgIGZvciAoaSA9IHRoaXMueWJhc2U7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgICAgIHRoaXMubGluZXNbaV0uc3BsaWNlKHRoaXMueCwgMSk7XG4gICAgICAgICAgICB0aGlzLmxpbmVzW2ldLnB1c2goY2gpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5tYXhSYW5nZSgpO1xufTtcblxuLyoqXG4qIENoYXJhY3RlciBTZXRzXG4qL1xuXG5UZXJtaW5hbC5jaGFyc2V0cyA9IHt9O1xuXG4vLyBERUMgU3BlY2lhbCBDaGFyYWN0ZXIgYW5kIExpbmUgRHJhd2luZyBTZXQuXG4vLyBodHRwOi8vdnQxMDAubmV0L2RvY3MvdnQxMDItdWcvdGFibGU1LTEzLmh0bWxcbi8vIEEgbG90IG9mIGN1cnNlcyBhcHBzIHVzZSB0aGlzIGlmIHRoZXkgc2VlIFRFUk09eHRlcm0uXG4vLyB0ZXN0aW5nOiBlY2hvIC1lICdcXGUoMGFcXGUoQidcbi8vIFRoZSB4dGVybSBvdXRwdXQgc29tZXRpbWVzIHNlZW1zIHRvIGNvbmZsaWN0IHdpdGggdGhlXG4vLyByZWZlcmVuY2UgYWJvdmUuIHh0ZXJtIHNlZW1zIGluIGxpbmUgd2l0aCB0aGUgcmVmZXJlbmNlXG4vLyB3aGVuIHJ1bm5pbmcgdnR0ZXN0IGhvd2V2ZXIuXG4vLyBUaGUgdGFibGUgYmVsb3cgbm93IHVzZXMgeHRlcm0ncyBvdXRwdXQgZnJvbSB2dHRlc3QuXG5UZXJtaW5hbC5jaGFyc2V0cy5TQ0xEID0geyAvLyAoMFxuICAgICdgJzogJ1xcdTI1YzYnLCAvLyAn4peGJ1xuICAgICdhJzogJ1xcdTI1OTInLCAvLyAn4paSJ1xuICAgICdiJzogJ1xcdTAwMDknLCAvLyAnXFx0J1xuICAgICdjJzogJ1xcdTAwMGMnLCAvLyAnXFxmJ1xuICAgICdkJzogJ1xcdTAwMGQnLCAvLyAnXFxyJ1xuICAgICdlJzogJ1xcdTAwMGEnLCAvLyAnXFxuJ1xuICAgICdmJzogJ1xcdTAwYjAnLCAvLyAnwrAnXG4gICAgJ2cnOiAnXFx1MDBiMScsIC8vICfCsSdcbiAgICAnaCc6ICdcXHUyNDI0JywgLy8gJ1xcdTI0MjQnIChOTClcbiAgICAnaSc6ICdcXHUwMDBiJywgLy8gJ1xcdidcbiAgICAnaic6ICdcXHUyNTE4JywgLy8gJ+KUmCdcbiAgICAnayc6ICdcXHUyNTEwJywgLy8gJ+KUkCdcbiAgICAnbCc6ICdcXHUyNTBjJywgLy8gJ+KUjCdcbiAgICAnbSc6ICdcXHUyNTE0JywgLy8gJ+KUlCdcbiAgICAnbic6ICdcXHUyNTNjJywgLy8gJ+KUvCdcbiAgICAnbyc6ICdcXHUyM2JhJywgLy8gJ+KOuidcbiAgICAncCc6ICdcXHUyM2JiJywgLy8gJ+KOuydcbiAgICAncSc6ICdcXHUyNTAwJywgLy8gJ+KUgCdcbiAgICAncic6ICdcXHUyM2JjJywgLy8gJ+KOvCdcbiAgICAncyc6ICdcXHUyM2JkJywgLy8gJ+KOvSdcbiAgICAndCc6ICdcXHUyNTFjJywgLy8gJ+KUnCdcbiAgICAndSc6ICdcXHUyNTI0JywgLy8gJ+KUpCdcbiAgICAndic6ICdcXHUyNTM0JywgLy8gJ+KUtCdcbiAgICAndyc6ICdcXHUyNTJjJywgLy8gJ+KUrCdcbiAgICAneCc6ICdcXHUyNTAyJywgLy8gJ+KUgidcbiAgICAneSc6ICdcXHUyMjY0JywgLy8gJ+KJpCdcbiAgICAneic6ICdcXHUyMjY1JywgLy8gJ+KJpSdcbiAgICAneyc6ICdcXHUwM2MwJywgLy8gJ8+AJ1xuICAgICd8JzogJ1xcdTIyNjAnLCAvLyAn4omgJ1xuICAgICd9JzogJ1xcdTAwYTMnLCAvLyAnwqMnXG4gICAgJ34nOiAnXFx1MDBiNycgLy8gJ8K3J1xufTtcblxuVGVybWluYWwuY2hhcnNldHMuVUsgPSBudWxsOyAvLyAoQVxuVGVybWluYWwuY2hhcnNldHMuVVMgPSBudWxsOyAvLyAoQiAoVVNBU0NJSSlcblRlcm1pbmFsLmNoYXJzZXRzLkR1dGNoID0gbnVsbDsgLy8gKDRcblRlcm1pbmFsLmNoYXJzZXRzLkZpbm5pc2ggPSBudWxsOyAvLyAoQyBvciAoNVxuVGVybWluYWwuY2hhcnNldHMuRnJlbmNoID0gbnVsbDsgLy8gKFJcblRlcm1pbmFsLmNoYXJzZXRzLkZyZW5jaENhbmFkaWFuID0gbnVsbDsgLy8gKFFcblRlcm1pbmFsLmNoYXJzZXRzLkdlcm1hbiA9IG51bGw7IC8vIChLXG5UZXJtaW5hbC5jaGFyc2V0cy5JdGFsaWFuID0gbnVsbDsgLy8gKFlcblRlcm1pbmFsLmNoYXJzZXRzLk5vcndlZ2lhbkRhbmlzaCA9IG51bGw7IC8vIChFIG9yICg2XG5UZXJtaW5hbC5jaGFyc2V0cy5TcGFuaXNoID0gbnVsbDsgLy8gKFpcblRlcm1pbmFsLmNoYXJzZXRzLlN3ZWRpc2ggPSBudWxsOyAvLyAoSCBvciAoN1xuVGVybWluYWwuY2hhcnNldHMuU3dpc3MgPSBudWxsOyAvLyAoPVxuVGVybWluYWwuY2hhcnNldHMuSVNPTGF0aW4gPSBudWxsOyAvLyAvQVxuXG4vKipcbiogSGVscGVyc1xuKi9cblxuZnVuY3Rpb24gb24oZWwsIHR5cGUsIGhhbmRsZXIsIGNhcHR1cmUpIHtcbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKHR5cGUsIGhhbmRsZXIsIGNhcHR1cmUgfHwgZmFsc2UpO1xufVxuXG5mdW5jdGlvbiBvZmYoZWwsIHR5cGUsIGhhbmRsZXIsIGNhcHR1cmUpIHtcbiAgICBlbC5yZW1vdmVFdmVudExpc3RlbmVyKHR5cGUsIGhhbmRsZXIsIGNhcHR1cmUgfHwgZmFsc2UpO1xufVxuXG5mdW5jdGlvbiBjYW5jZWwoZXYpIHtcbiAgICBpZiAoZXYucHJldmVudERlZmF1bHQpIGV2LnByZXZlbnREZWZhdWx0KCk7XG4gICAgZXYucmV0dXJuVmFsdWUgPSBmYWxzZTtcbiAgICBpZiAoZXYuc3RvcFByb3BhZ2F0aW9uKSBldi5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICBldi5jYW5jZWxCdWJibGUgPSB0cnVlO1xuICAgIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gaW5oZXJpdHMoY2hpbGQsIHBhcmVudCkge1xuICAgIGZ1bmN0aW9uIGYoKSB7XG4gICAgICAgIHRoaXMuY29uc3RydWN0b3IgPSBjaGlsZDtcbiAgICB9XG4gICAgZi5wcm90b3R5cGUgPSBwYXJlbnQucHJvdG90eXBlO1xuICAgIGNoaWxkLnByb3RvdHlwZSA9IG5ldyBmO1xufVxuXG52YXIgaXNNYWMgPSB+bmF2aWdhdG9yLnVzZXJBZ2VudC5pbmRleE9mKCdNYWMnKTtcblxuLy8gaWYgYm9sZCBpcyBicm9rZW4sIHdlIGNhbid0XG4vLyB1c2UgaXQgaW4gdGhlIHRlcm1pbmFsLlxuZnVuY3Rpb24gaXNCb2xkQnJva2VuKCkge1xuICAgIHZhciBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NwYW4nKTtcbiAgICBlbC5pbm5lckhUTUwgPSAnaGVsbG8gd29ybGQnO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xuICAgIHZhciB3MSA9IGVsLnNjcm9sbFdpZHRoO1xuICAgIGVsLnN0eWxlLmZvbnRXZWlnaHQgPSAnYm9sZCc7XG4gICAgdmFyIHcyID0gZWwuc2Nyb2xsV2lkdGg7XG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChlbCk7XG4gICAgcmV0dXJuIHcxICE9PSB3Mjtcbn1cblxudmFyIFN0cmluZyA9IHRoaXMuU3RyaW5nO1xudmFyIHNldFRpbWVvdXQgPSB0aGlzLnNldFRpbWVvdXQ7XG52YXIgc2V0SW50ZXJ2YWwgPSB0aGlzLnNldEludGVydmFsO1xuXG4vKipcbiogRXhwb3NlXG4qL1xuXG5UZXJtaW5hbC5FdmVudEVtaXR0ZXIgPSBFdmVudEVtaXR0ZXI7XG5UZXJtaW5hbC5pc01hYyA9IGlzTWFjO1xuVGVybWluYWwub24gPSBvbjtcblRlcm1pbmFsLm9mZiA9IG9mZjtcblRlcm1pbmFsLmNhbmNlbCA9IGNhbmNlbDtcblxufSkoKSIsIid1c2Ugc3RyaWN0Jztcbi8qanNoaW50IGJyb3dzZXI6dHJ1ZSAqL1xuXG52YXIgdGVybSA9IHJlcXVpcmUoJy4uL2luZGV4JykoMTAwLCA4MCk7XG50ZXJtLmFwcGVuZFRvKCcjdGVybWluYWwnKTtcblxudmFyIGRpZmZsZXQgPSByZXF1aXJlKCdkaWZmbGV0Jykoe1xuICAgICAgaW5kZW50IDogMiBcbiAgICAsIGNvbW1hIDogJ2ZpcnN0J1xuICAgICwgY29tbWVudDogdHJ1ZVxuICAgIH0pO1xuXG52YXIgZGlmZiA9IGRpZmZsZXQuY29tcGFyZSh7IGEgOiBbMSwgMiwgMyBdLCBjIDogNSB9LCB7IGEgOiBbMSwgMiwgMywgNCBdLCBiIDogNCB9KTtcbnRlcm0ud3JpdGUoZGlmZik7XG5cbnZhciB0ZXJtY29kZSA9IHJlcXVpcmUoJy4uL2luZGV4JykoMTMwLCA4MCk7XG50ZXJtY29kZS5hcHBlbmRUbygnI3Rlcm1pbmFsLWNvZGUnKTtcblxuWyAnXFx1MDAxYls5Mm1cXCd1c2Ugc3RyaWN0XFwnXFx1MDAxYlszOW1cXHUwMDFiWzkwbTtcXHUwMDFiWzM5bScsXG4gICdcXHUwMDFiWzkwbS8qanNoaW50IGJyb3dzZXI6dHJ1ZSAqL1xcdTAwMWJbMzltJyxcbiAgJycsXG4gICdcXHUwMDFiWzMybXZhclxcdTAwMWJbMzltIFxcdTAwMWJbMzdtVGVybWluYWxcXHUwMDFiWzM5bSBcXHUwMDFiWzkzbT1cXHUwMDFiWzM5bSBcXHUwMDFiWzM3bXJlcXVpcmVcXHUwMDFiWzM5bVxcdTAwMWJbOTBtKFxcdTAwMWJbMzltXFx1MDAxYls5Mm1cXCcuL3Rlcm1cXCdcXHUwMDFiWzM5bVxcdTAwMWJbOTBtKVxcdTAwMWJbMzltJyxcbiAgJyAgXFx1MDAxYlszMm0sXFx1MDAxYlszOW0gXFx1MDAxYlszN210aHJvdWdoXFx1MDAxYlszOW0gXFx1MDAxYls5M209XFx1MDAxYlszOW0gXFx1MDAxYlszN21yZXF1aXJlXFx1MDAxYlszOW1cXHUwMDFiWzkwbShcXHUwMDFiWzM5bVxcdTAwMWJbOTJtXFwndGhyb3VnaFxcJ1xcdTAwMWJbMzltXFx1MDAxYls5MG0pXFx1MDAxYlszOW0nLFxuICAnICBcXHUwMDFiWzkwbTtcXHUwMDFiWzM5bScsXG4gICcnLFxuICAnXFx1MDAxYlszN21tb2R1bGVcXHUwMDFiWzM5bVxcdTAwMWJbMzJtLlxcdTAwMWJbMzltXFx1MDAxYlszN21leHBvcnRzXFx1MDAxYlszOW0gXFx1MDAxYls5M209XFx1MDAxYlszOW0gXFx1MDAxYls5NG1mdW5jdGlvblxcdTAwMWJbMzltIFxcdTAwMWJbOTBtKFxcdTAwMWJbMzltXFx1MDAxYlszN21jb2xzXFx1MDAxYlszOW1cXHUwMDFiWzMybSxcXHUwMDFiWzM5bSBcXHUwMDFiWzM3bXJvd3NcXHUwMDFiWzM5bVxcdTAwMWJbMzJtLFxcdTAwMWJbMzltIFxcdTAwMWJbMzdtaGFuZGxlclxcdTAwMWJbMzltXFx1MDAxYls5MG0pXFx1MDAxYlszOW0gXFx1MDAxYlszM217XFx1MDAxYlszOW0nLFxuICAnICBcXHUwMDFiWzMybXZhclxcdTAwMWJbMzltIFxcdTAwMWJbMzdtdGVybVxcdTAwMWJbMzltIFxcdTAwMWJbOTNtPVxcdTAwMWJbMzltIFxcdTAwMWJbMzFtbmV3XFx1MDAxYlszOW0gXFx1MDAxYlszN21UZXJtaW5hbFxcdTAwMWJbMzltXFx1MDAxYls5MG0oXFx1MDAxYlszOW1cXHUwMDFiWzM3bWNvbHNcXHUwMDFiWzM5bVxcdTAwMWJbMzJtLFxcdTAwMWJbMzltIFxcdTAwMWJbMzdtcm93c1xcdTAwMWJbMzltXFx1MDAxYlszMm0sXFx1MDAxYlszOW0gXFx1MDAxYlszN21oYW5kbGVyXFx1MDAxYlszOW1cXHUwMDFiWzkwbSlcXHUwMDFiWzM5bVxcdTAwMWJbOTBtO1xcdTAwMWJbMzltJyxcbiAgJyAgXFx1MDAxYlszN210ZXJtXFx1MDAxYlszOW1cXHUwMDFiWzMybS5cXHUwMDFiWzM5bVxcdTAwMWJbMzdtb3BlblxcdTAwMWJbMzltXFx1MDAxYls5MG0oXFx1MDAxYlszOW1cXHUwMDFiWzkwbSlcXHUwMDFiWzM5bVxcdTAwMWJbOTBtO1xcdTAwMWJbMzltJyxcbiAgJyAgJyxcbiAgJyAgXFx1MDAxYlszMm12YXJcXHUwMDFiWzM5bSBcXHUwMDFiWzM3bWh5cGVybmFsXFx1MDAxYlszOW0gXFx1MDAxYls5M209XFx1MDAxYlszOW0gXFx1MDAxYlszN210aHJvdWdoXFx1MDAxYlszOW1cXHUwMDFiWzkwbShcXHUwMDFiWzM5bVxcdTAwMWJbMzdtdGVybVxcdTAwMWJbMzltXFx1MDAxYlszMm0uXFx1MDAxYlszOW1cXHUwMDFiWzM3bXdyaXRlXFx1MDAxYlszOW1cXHUwMDFiWzMybS5cXHUwMDFiWzM5bVxcdTAwMWJbMzdtYmluZFxcdTAwMWJbMzltXFx1MDAxYls5MG0oXFx1MDAxYlszOW1cXHUwMDFiWzM3bXRlcm1cXHUwMDFiWzM5bVxcdTAwMWJbOTBtKVxcdTAwMWJbMzltXFx1MDAxYls5MG0pXFx1MDAxYlszOW1cXHUwMDFiWzkwbTtcXHUwMDFiWzM5bScsXG4gICcgIFxcdTAwMWJbMzdtaHlwZXJuYWxcXHUwMDFiWzM5bVxcdTAwMWJbMzJtLlxcdTAwMWJbMzltXFx1MDAxYlszN21hcHBlbmRUb1xcdTAwMWJbMzltIFxcdTAwMWJbOTNtPVxcdTAwMWJbMzltIFxcdTAwMWJbOTRtZnVuY3Rpb25cXHUwMDFiWzM5bSBcXHUwMDFiWzkwbShcXHUwMDFiWzM5bVxcdTAwMWJbMzdtZWxlbVxcdTAwMWJbMzltXFx1MDAxYls5MG0pXFx1MDAxYlszOW0gXFx1MDAxYlszM217XFx1MDAxYlszOW0nLFxuICAnICAgIFxcdTAwMWJbOTRtaWZcXHUwMDFiWzM5bSBcXHUwMDFiWzkwbShcXHUwMDFiWzM5bVxcdTAwMWJbOTRtdHlwZW9mXFx1MDAxYlszOW0gXFx1MDAxYlszN21lbGVtXFx1MDAxYlszOW0gXFx1MDAxYls5M209PT1cXHUwMDFiWzM5bSBcXHUwMDFiWzkybVxcJ3N0cmluZ1xcJ1xcdTAwMWJbMzltXFx1MDAxYls5MG0pXFx1MDAxYlszOW0gXFx1MDAxYlszN21lbGVtXFx1MDAxYlszOW0gXFx1MDAxYls5M209XFx1MDAxYlszOW0gXFx1MDAxYlszN21kb2N1bWVudFxcdTAwMWJbMzltXFx1MDAxYlszMm0uXFx1MDAxYlszOW1cXHUwMDFiWzM3bXF1ZXJ5U2VsZWN0b3JcXHUwMDFiWzM5bVxcdTAwMWJbOTBtKFxcdTAwMWJbMzltXFx1MDAxYlszN21lbGVtXFx1MDAxYlszOW1cXHUwMDFiWzkwbSlcXHUwMDFiWzM5bVxcdTAwMWJbOTBtO1xcdTAwMWJbMzltJyxcbiAgJycsXG4gICcgICAgXFx1MDAxYlszN21lbGVtXFx1MDAxYlszOW1cXHUwMDFiWzMybS5cXHUwMDFiWzM5bVxcdTAwMWJbMzdtYXBwZW5kQ2hpbGRcXHUwMDFiWzM5bVxcdTAwMWJbOTBtKFxcdTAwMWJbMzltXFx1MDAxYlszN210ZXJtXFx1MDAxYlszOW1cXHUwMDFiWzMybS5cXHUwMDFiWzM5bVxcdTAwMWJbMzdtZWxlbWVudFxcdTAwMWJbMzltXFx1MDAxYls5MG0pXFx1MDAxYlszOW1cXHUwMDFiWzkwbTtcXHUwMDFiWzM5bScsXG4gICcgICAgXFx1MDAxYlszN210ZXJtXFx1MDAxYlszOW1cXHUwMDFiWzMybS5cXHUwMDFiWzM5bVxcdTAwMWJbMzdtZWxlbWVudFxcdTAwMWJbMzltXFx1MDAxYlszMm0uXFx1MDAxYlszOW1cXHUwMDFiWzM3bXN0eWxlXFx1MDAxYlszOW1cXHUwMDFiWzMybS5cXHUwMDFiWzM5bVxcdTAwMWJbMzdtcG9zaXRpb25cXHUwMDFiWzM5bSBcXHUwMDFiWzkzbT1cXHUwMDFiWzM5bSBcXHUwMDFiWzkybVxcJ3JlbGF0aXZlXFwnXFx1MDAxYlszOW1cXHUwMDFiWzkwbTtcXHUwMDFiWzM5bScsXG4gICcgIFxcdTAwMWJbMzNtfVxcdTAwMWJbMzltXFx1MDAxYls5MG07XFx1MDAxYlszOW0nLFxuICAnJyxcbiAgJyAgXFx1MDAxYlszN21oeXBlcm5hbFxcdTAwMWJbMzltXFx1MDAxYlszMm0uXFx1MDAxYlszOW1cXHUwMDFiWzM3bXdyaXRlbG5cXHUwMDFiWzM5bSBcXHUwMDFiWzkzbT1cXHUwMDFiWzM5bSBcXHUwMDFiWzk0bWZ1bmN0aW9uXFx1MDAxYlszOW0gXFx1MDAxYls5MG0oXFx1MDAxYlszOW1cXHUwMDFiWzM3bWxpbmVcXHUwMDFiWzM5bVxcdTAwMWJbOTBtKVxcdTAwMWJbMzltIFxcdTAwMWJbMzNte1xcdTAwMWJbMzltJyxcbiAgJyAgICBcXHUwMDFiWzM3bXRlcm1cXHUwMDFiWzM5bVxcdTAwMWJbMzJtLlxcdTAwMWJbMzltXFx1MDAxYlszN213cml0ZWxuXFx1MDAxYlszOW1cXHUwMDFiWzkwbShcXHUwMDFiWzM5bVxcdTAwMWJbMzdtbGluZVxcdTAwMWJbMzltXFx1MDAxYls5MG0pXFx1MDAxYlszOW1cXHUwMDFiWzkwbTtcXHUwMDFiWzM5bScsXG4gICcgIFxcdTAwMWJbMzNtfVxcdTAwMWJbMzltXFx1MDAxYls5MG07XFx1MDAxYlszOW0nLFxuICAnJyxcbiAgJyAgXFx1MDAxYlszN21oeXBlcm5hbFxcdTAwMWJbMzltXFx1MDAxYlszMm0uXFx1MDAxYlszOW1cXHUwMDFiWzM3bXdyaXRlXFx1MDAxYlszOW0gXFx1MDAxYls5M209XFx1MDAxYlszOW0gXFx1MDAxYlszN210ZXJtXFx1MDAxYlszOW1cXHUwMDFiWzMybS5cXHUwMDFiWzM5bVxcdTAwMWJbMzdtd3JpdGVcXHUwMDFiWzM5bVxcdTAwMWJbMzJtLlxcdTAwMWJbMzltXFx1MDAxYlszN21iaW5kXFx1MDAxYlszOW1cXHUwMDFiWzkwbShcXHUwMDFiWzM5bVxcdTAwMWJbMzdtdGVybVxcdTAwMWJbMzltXFx1MDAxYls5MG0pXFx1MDAxYlszOW1cXHUwMDFiWzkwbTtcXHUwMDFiWzM5bScsXG4gICcnLFxuICAnICBcXHUwMDFiWzMxbXJldHVyblxcdTAwMWJbMzltIFxcdTAwMWJbMzdtaHlwZXJuYWxcXHUwMDFiWzM5bVxcdTAwMWJbOTBtO1xcdTAwMWJbMzltJyxcbiAgJ1xcdTAwMWJbMzNtfVxcdTAwMWJbMzltXFx1MDAxYls5MG07XFx1MDAxYlszOW0nLFxuICAnJyBcbl0uZm9yRWFjaChmdW5jdGlvbiAobGluZSkgeyB0ZXJtY29kZS53cml0ZWxuKGxpbmUpOyB9KTtcbiIsIid1c2Ugc3RyaWN0Jztcbi8qanNoaW50IGJyb3dzZXI6dHJ1ZSAqL1xuXG52YXIgVGVybWluYWwgPSByZXF1aXJlKCcuL3Rlcm0nKVxuICAsIHRocm91Z2ggPSByZXF1aXJlKCd0aHJvdWdoJylcbiAgO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChjb2xzLCByb3dzLCBvcHRzKSB7XG4gIHZhciB0ZXJtID0gbmV3IFRlcm1pbmFsKGNvbHMsIHJvd3MsIG9wdHMpO1xuICB0ZXJtLm9wZW4oKTtcbiAgXG4gIHZhciBoeXBlcm5hbCA9IHRocm91Z2godGVybS53cml0ZS5iaW5kKHRlcm0pKTtcbiAgaHlwZXJuYWwuYXBwZW5kVG8gPSBmdW5jdGlvbiAoZWxlbSkge1xuICAgIGlmICh0eXBlb2YgZWxlbSA9PT0gJ3N0cmluZycpIGVsZW0gPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKGVsZW0pO1xuXG4gICAgZWxlbS5hcHBlbmRDaGlsZCh0ZXJtLmVsZW1lbnQpO1xuICAgIHRlcm0uZWxlbWVudC5zdHlsZS5wb3NpdGlvbiA9ICdyZWxhdGl2ZSc7XG4gIH07XG5cbiAgaHlwZXJuYWwud3JpdGVsbiA9IGZ1bmN0aW9uIChsaW5lKSB7XG4gICAgdGVybS53cml0ZWxuKGxpbmUpO1xuICB9O1xuXG4gIGh5cGVybmFsLndyaXRlID0gdGVybS53cml0ZS5iaW5kKHRlcm0pO1xuXG4gIHJldHVybiBoeXBlcm5hbDtcbn07XG4iLCIvLyBzaGltIGZvciB1c2luZyBwcm9jZXNzIGluIGJyb3dzZXJcblxudmFyIHByb2Nlc3MgPSBtb2R1bGUuZXhwb3J0cyA9IHt9O1xuXG5wcm9jZXNzLm5leHRUaWNrID0gKGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgY2FuU2V0SW1tZWRpYXRlID0gdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCdcbiAgICAmJiB3aW5kb3cuc2V0SW1tZWRpYXRlO1xuICAgIHZhciBjYW5Qb3N0ID0gdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCdcbiAgICAmJiB3aW5kb3cucG9zdE1lc3NhZ2UgJiYgd2luZG93LmFkZEV2ZW50TGlzdGVuZXJcbiAgICA7XG5cbiAgICBpZiAoY2FuU2V0SW1tZWRpYXRlKSB7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoZikgeyByZXR1cm4gd2luZG93LnNldEltbWVkaWF0ZShmKSB9O1xuICAgIH1cblxuICAgIGlmIChjYW5Qb3N0KSB7XG4gICAgICAgIHZhciBxdWV1ZSA9IFtdO1xuICAgICAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGZ1bmN0aW9uIChldikge1xuICAgICAgICAgICAgaWYgKGV2LnNvdXJjZSA9PT0gd2luZG93ICYmIGV2LmRhdGEgPT09ICdwcm9jZXNzLXRpY2snKSB7XG4gICAgICAgICAgICAgICAgZXYuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICAgICAgaWYgKHF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGZuID0gcXVldWUuc2hpZnQoKTtcbiAgICAgICAgICAgICAgICAgICAgZm4oKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sIHRydWUpO1xuXG4gICAgICAgIHJldHVybiBmdW5jdGlvbiBuZXh0VGljayhmbikge1xuICAgICAgICAgICAgcXVldWUucHVzaChmbik7XG4gICAgICAgICAgICB3aW5kb3cucG9zdE1lc3NhZ2UoJ3Byb2Nlc3MtdGljaycsICcqJyk7XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcmV0dXJuIGZ1bmN0aW9uIG5leHRUaWNrKGZuKSB7XG4gICAgICAgIHNldFRpbWVvdXQoZm4sIDApO1xuICAgIH07XG59KSgpO1xuXG5wcm9jZXNzLnRpdGxlID0gJ2Jyb3dzZXInO1xucHJvY2Vzcy5icm93c2VyID0gdHJ1ZTtcbnByb2Nlc3MuZW52ID0ge307XG5wcm9jZXNzLmFyZ3YgPSBbXTtcblxucHJvY2Vzcy5iaW5kaW5nID0gZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuYmluZGluZyBpcyBub3Qgc3VwcG9ydGVkJyk7XG59XG5cbi8vIFRPRE8oc2h0eWxtYW4pXG5wcm9jZXNzLmN3ZCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuICcvJyB9O1xucHJvY2Vzcy5jaGRpciA9IGZ1bmN0aW9uIChkaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuY2hkaXIgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcbiIsIihmdW5jdGlvbihwcm9jZXNzKXtpZiAoIXByb2Nlc3MuRXZlbnRFbWl0dGVyKSBwcm9jZXNzLkV2ZW50RW1pdHRlciA9IGZ1bmN0aW9uICgpIHt9O1xuXG52YXIgRXZlbnRFbWl0dGVyID0gZXhwb3J0cy5FdmVudEVtaXR0ZXIgPSBwcm9jZXNzLkV2ZW50RW1pdHRlcjtcbnZhciBpc0FycmF5ID0gdHlwZW9mIEFycmF5LmlzQXJyYXkgPT09ICdmdW5jdGlvbidcbiAgICA/IEFycmF5LmlzQXJyYXlcbiAgICA6IGZ1bmN0aW9uICh4cykge1xuICAgICAgICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHhzKSA9PT0gJ1tvYmplY3QgQXJyYXldJ1xuICAgIH1cbjtcbmZ1bmN0aW9uIGluZGV4T2YgKHhzLCB4KSB7XG4gICAgaWYgKHhzLmluZGV4T2YpIHJldHVybiB4cy5pbmRleE9mKHgpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgeHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYgKHggPT09IHhzW2ldKSByZXR1cm4gaTtcbiAgICB9XG4gICAgcmV0dXJuIC0xO1xufVxuXG4vLyBCeSBkZWZhdWx0IEV2ZW50RW1pdHRlcnMgd2lsbCBwcmludCBhIHdhcm5pbmcgaWYgbW9yZSB0aGFuXG4vLyAxMCBsaXN0ZW5lcnMgYXJlIGFkZGVkIHRvIGl0LiBUaGlzIGlzIGEgdXNlZnVsIGRlZmF1bHQgd2hpY2hcbi8vIGhlbHBzIGZpbmRpbmcgbWVtb3J5IGxlYWtzLlxuLy9cbi8vIE9idmlvdXNseSBub3QgYWxsIEVtaXR0ZXJzIHNob3VsZCBiZSBsaW1pdGVkIHRvIDEwLiBUaGlzIGZ1bmN0aW9uIGFsbG93c1xuLy8gdGhhdCB0byBiZSBpbmNyZWFzZWQuIFNldCB0byB6ZXJvIGZvciB1bmxpbWl0ZWQuXG52YXIgZGVmYXVsdE1heExpc3RlbmVycyA9IDEwO1xuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5zZXRNYXhMaXN0ZW5lcnMgPSBmdW5jdGlvbihuKSB7XG4gIGlmICghdGhpcy5fZXZlbnRzKSB0aGlzLl9ldmVudHMgPSB7fTtcbiAgdGhpcy5fZXZlbnRzLm1heExpc3RlbmVycyA9IG47XG59O1xuXG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuZW1pdCA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgLy8gSWYgdGhlcmUgaXMgbm8gJ2Vycm9yJyBldmVudCBsaXN0ZW5lciB0aGVuIHRocm93LlxuICBpZiAodHlwZSA9PT0gJ2Vycm9yJykge1xuICAgIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHMuZXJyb3IgfHxcbiAgICAgICAgKGlzQXJyYXkodGhpcy5fZXZlbnRzLmVycm9yKSAmJiAhdGhpcy5fZXZlbnRzLmVycm9yLmxlbmd0aCkpXG4gICAge1xuICAgICAgaWYgKGFyZ3VtZW50c1sxXSBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIHRocm93IGFyZ3VtZW50c1sxXTsgLy8gVW5oYW5kbGVkICdlcnJvcicgZXZlbnRcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlVuY2F1Z2h0LCB1bnNwZWNpZmllZCAnZXJyb3InIGV2ZW50LlwiKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBpZiAoIXRoaXMuX2V2ZW50cykgcmV0dXJuIGZhbHNlO1xuICB2YXIgaGFuZGxlciA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgaWYgKCFoYW5kbGVyKSByZXR1cm4gZmFsc2U7XG5cbiAgaWYgKHR5cGVvZiBoYW5kbGVyID09ICdmdW5jdGlvbicpIHtcbiAgICBzd2l0Y2ggKGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgIC8vIGZhc3QgY2FzZXNcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIGFyZ3VtZW50c1sxXSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAzOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgYXJndW1lbnRzWzFdLCBhcmd1bWVudHNbMl0pO1xuICAgICAgICBicmVhaztcbiAgICAgIC8vIHNsb3dlclxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICAgICAgICBoYW5kbGVyLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcblxuICB9IGVsc2UgaWYgKGlzQXJyYXkoaGFuZGxlcikpIHtcbiAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG5cbiAgICB2YXIgbGlzdGVuZXJzID0gaGFuZGxlci5zbGljZSgpO1xuICAgIGZvciAodmFyIGkgPSAwLCBsID0gbGlzdGVuZXJzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgbGlzdGVuZXJzW2ldLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcblxuICB9IGVsc2Uge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcblxuLy8gRXZlbnRFbWl0dGVyIGlzIGRlZmluZWQgaW4gc3JjL25vZGVfZXZlbnRzLmNjXG4vLyBFdmVudEVtaXR0ZXIucHJvdG90eXBlLmVtaXQoKSBpcyBhbHNvIGRlZmluZWQgdGhlcmUuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmFkZExpc3RlbmVyID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgaWYgKCdmdW5jdGlvbicgIT09IHR5cGVvZiBsaXN0ZW5lcikge1xuICAgIHRocm93IG5ldyBFcnJvcignYWRkTGlzdGVuZXIgb25seSB0YWtlcyBpbnN0YW5jZXMgb2YgRnVuY3Rpb24nKTtcbiAgfVxuXG4gIGlmICghdGhpcy5fZXZlbnRzKSB0aGlzLl9ldmVudHMgPSB7fTtcblxuICAvLyBUbyBhdm9pZCByZWN1cnNpb24gaW4gdGhlIGNhc2UgdGhhdCB0eXBlID09IFwibmV3TGlzdGVuZXJzXCIhIEJlZm9yZVxuICAvLyBhZGRpbmcgaXQgdG8gdGhlIGxpc3RlbmVycywgZmlyc3QgZW1pdCBcIm5ld0xpc3RlbmVyc1wiLlxuICB0aGlzLmVtaXQoJ25ld0xpc3RlbmVyJywgdHlwZSwgbGlzdGVuZXIpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzW3R5cGVdKSB7XG4gICAgLy8gT3B0aW1pemUgdGhlIGNhc2Ugb2Ygb25lIGxpc3RlbmVyLiBEb24ndCBuZWVkIHRoZSBleHRyYSBhcnJheSBvYmplY3QuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdID0gbGlzdGVuZXI7XG4gIH0gZWxzZSBpZiAoaXNBcnJheSh0aGlzLl9ldmVudHNbdHlwZV0pKSB7XG5cbiAgICAvLyBDaGVjayBmb3IgbGlzdGVuZXIgbGVha1xuICAgIGlmICghdGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZCkge1xuICAgICAgdmFyIG07XG4gICAgICBpZiAodGhpcy5fZXZlbnRzLm1heExpc3RlbmVycyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIG0gPSB0aGlzLl9ldmVudHMubWF4TGlzdGVuZXJzO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbSA9IGRlZmF1bHRNYXhMaXN0ZW5lcnM7XG4gICAgICB9XG5cbiAgICAgIGlmIChtICYmIG0gPiAwICYmIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGggPiBtKSB7XG4gICAgICAgIHRoaXMuX2V2ZW50c1t0eXBlXS53YXJuZWQgPSB0cnVlO1xuICAgICAgICBjb25zb2xlLmVycm9yKCcobm9kZSkgd2FybmluZzogcG9zc2libGUgRXZlbnRFbWl0dGVyIG1lbW9yeSAnICtcbiAgICAgICAgICAgICAgICAgICAgICAnbGVhayBkZXRlY3RlZC4gJWQgbGlzdGVuZXJzIGFkZGVkLiAnICtcbiAgICAgICAgICAgICAgICAgICAgICAnVXNlIGVtaXR0ZXIuc2V0TWF4TGlzdGVuZXJzKCkgdG8gaW5jcmVhc2UgbGltaXQuJyxcbiAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9ldmVudHNbdHlwZV0ubGVuZ3RoKTtcbiAgICAgICAgY29uc29sZS50cmFjZSgpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIHdlJ3ZlIGFscmVhZHkgZ290IGFuIGFycmF5LCBqdXN0IGFwcGVuZC5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0ucHVzaChsaXN0ZW5lcik7XG4gIH0gZWxzZSB7XG4gICAgLy8gQWRkaW5nIHRoZSBzZWNvbmQgZWxlbWVudCwgbmVlZCB0byBjaGFuZ2UgdG8gYXJyYXkuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdID0gW3RoaXMuX2V2ZW50c1t0eXBlXSwgbGlzdGVuZXJdO1xuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLm9uID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5hZGRMaXN0ZW5lcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBzZWxmLm9uKHR5cGUsIGZ1bmN0aW9uIGcoKSB7XG4gICAgc2VsZi5yZW1vdmVMaXN0ZW5lcih0eXBlLCBnKTtcbiAgICBsaXN0ZW5lci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICB9KTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucmVtb3ZlTGlzdGVuZXIgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICBpZiAoJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGxpc3RlbmVyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdyZW1vdmVMaXN0ZW5lciBvbmx5IHRha2VzIGluc3RhbmNlcyBvZiBGdW5jdGlvbicpO1xuICB9XG5cbiAgLy8gZG9lcyBub3QgdXNlIGxpc3RlbmVycygpLCBzbyBubyBzaWRlIGVmZmVjdCBvZiBjcmVhdGluZyBfZXZlbnRzW3R5cGVdXG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHNbdHlwZV0pIHJldHVybiB0aGlzO1xuXG4gIHZhciBsaXN0ID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIGlmIChpc0FycmF5KGxpc3QpKSB7XG4gICAgdmFyIGkgPSBpbmRleE9mKGxpc3QsIGxpc3RlbmVyKTtcbiAgICBpZiAoaSA8IDApIHJldHVybiB0aGlzO1xuICAgIGxpc3Quc3BsaWNlKGksIDEpO1xuICAgIGlmIChsaXN0Lmxlbmd0aCA9PSAwKVxuICAgICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgfSBlbHNlIGlmICh0aGlzLl9ldmVudHNbdHlwZV0gPT09IGxpc3RlbmVyKSB7XG4gICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgdGhpcy5fZXZlbnRzID0ge307XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyBkb2VzIG5vdCB1c2UgbGlzdGVuZXJzKCksIHNvIG5vIHNpZGUgZWZmZWN0IG9mIGNyZWF0aW5nIF9ldmVudHNbdHlwZV1cbiAgaWYgKHR5cGUgJiYgdGhpcy5fZXZlbnRzICYmIHRoaXMuX2V2ZW50c1t0eXBlXSkgdGhpcy5fZXZlbnRzW3R5cGVdID0gbnVsbDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmxpc3RlbmVycyA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgaWYgKCF0aGlzLl9ldmVudHMpIHRoaXMuX2V2ZW50cyA9IHt9O1xuICBpZiAoIXRoaXMuX2V2ZW50c1t0eXBlXSkgdGhpcy5fZXZlbnRzW3R5cGVdID0gW107XG4gIGlmICghaXNBcnJheSh0aGlzLl9ldmVudHNbdHlwZV0pKSB7XG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdID0gW3RoaXMuX2V2ZW50c1t0eXBlXV07XG4gIH1cbiAgcmV0dXJuIHRoaXMuX2V2ZW50c1t0eXBlXTtcbn07XG5cbn0pKHJlcXVpcmUoXCJfX2Jyb3dzZXJpZnlfcHJvY2Vzc1wiKSkiLCIoZnVuY3Rpb24ocHJvY2Vzcyl7dmFyIFN0cmVhbSA9IHJlcXVpcmUoJ3N0cmVhbScpXG5cbi8vIHRocm91Z2hcbi8vXG4vLyBhIHN0cmVhbSB0aGF0IGRvZXMgbm90aGluZyBidXQgcmUtZW1pdCB0aGUgaW5wdXQuXG4vLyB1c2VmdWwgZm9yIGFnZ3JlZ2F0aW5nIGEgc2VyaWVzIG9mIGNoYW5naW5nIGJ1dCBub3QgZW5kaW5nIHN0cmVhbXMgaW50byBvbmUgc3RyZWFtKVxuXG5cblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gdGhyb3VnaFxudGhyb3VnaC50aHJvdWdoID0gdGhyb3VnaFxuXG4vL2NyZWF0ZSBhIHJlYWRhYmxlIHdyaXRhYmxlIHN0cmVhbS5cblxuZnVuY3Rpb24gdGhyb3VnaCAod3JpdGUsIGVuZCkge1xuICB3cml0ZSA9IHdyaXRlIHx8IGZ1bmN0aW9uIChkYXRhKSB7IHRoaXMucXVldWUoZGF0YSkgfVxuICBlbmQgPSBlbmQgfHwgZnVuY3Rpb24gKCkgeyB0aGlzLnF1ZXVlKG51bGwpIH1cblxuICB2YXIgZW5kZWQgPSBmYWxzZSwgZGVzdHJveWVkID0gZmFsc2UsIGJ1ZmZlciA9IFtdXG4gIHZhciBzdHJlYW0gPSBuZXcgU3RyZWFtKClcbiAgc3RyZWFtLnJlYWRhYmxlID0gc3RyZWFtLndyaXRhYmxlID0gdHJ1ZVxuICBzdHJlYW0ucGF1c2VkID0gZmFsc2VcblxuICBzdHJlYW0ud3JpdGUgPSBmdW5jdGlvbiAoZGF0YSkge1xuICAgIHdyaXRlLmNhbGwodGhpcywgZGF0YSlcbiAgICByZXR1cm4gIXN0cmVhbS5wYXVzZWRcbiAgfVxuXG4gIGZ1bmN0aW9uIGRyYWluKCkge1xuICAgIHdoaWxlKGJ1ZmZlci5sZW5ndGggJiYgIXN0cmVhbS5wYXVzZWQpIHtcbiAgICAgIHZhciBkYXRhID0gYnVmZmVyLnNoaWZ0KClcbiAgICAgIGlmKG51bGwgPT09IGRhdGEpXG4gICAgICAgIHJldHVybiBzdHJlYW0uZW1pdCgnZW5kJylcbiAgICAgIGVsc2VcbiAgICAgICAgc3RyZWFtLmVtaXQoJ2RhdGEnLCBkYXRhKVxuICAgIH1cbiAgfVxuXG4gIHN0cmVhbS5xdWV1ZSA9IHN0cmVhbS5wdXNoID0gZnVuY3Rpb24gKGRhdGEpIHtcbiAgICBidWZmZXIucHVzaChkYXRhKVxuICAgIGRyYWluKClcbiAgICByZXR1cm4gc3RyZWFtXG4gIH1cblxuICAvL3RoaXMgd2lsbCBiZSByZWdpc3RlcmVkIGFzIHRoZSBmaXJzdCAnZW5kJyBsaXN0ZW5lclxuICAvL211c3QgY2FsbCBkZXN0cm95IG5leHQgdGljaywgdG8gbWFrZSBzdXJlIHdlJ3JlIGFmdGVyIGFueVxuICAvL3N0cmVhbSBwaXBlZCBmcm9tIGhlcmUuXG4gIC8vdGhpcyBpcyBvbmx5IGEgcHJvYmxlbSBpZiBlbmQgaXMgbm90IGVtaXR0ZWQgc3luY2hyb25vdXNseS5cbiAgLy9hIG5pY2VyIHdheSB0byBkbyB0aGlzIGlzIHRvIG1ha2Ugc3VyZSB0aGlzIGlzIHRoZSBsYXN0IGxpc3RlbmVyIGZvciAnZW5kJ1xuXG4gIHN0cmVhbS5vbignZW5kJywgZnVuY3Rpb24gKCkge1xuICAgIHN0cmVhbS5yZWFkYWJsZSA9IGZhbHNlXG4gICAgaWYoIXN0cmVhbS53cml0YWJsZSlcbiAgICAgIHByb2Nlc3MubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICBzdHJlYW0uZGVzdHJveSgpXG4gICAgICB9KVxuICB9KVxuXG4gIGZ1bmN0aW9uIF9lbmQgKCkge1xuICAgIHN0cmVhbS53cml0YWJsZSA9IGZhbHNlXG4gICAgZW5kLmNhbGwoc3RyZWFtKVxuICAgIGlmKCFzdHJlYW0ucmVhZGFibGUpXG4gICAgICBzdHJlYW0uZGVzdHJveSgpXG4gIH1cblxuICBzdHJlYW0uZW5kID0gZnVuY3Rpb24gKGRhdGEpIHtcbiAgICBpZihlbmRlZCkgcmV0dXJuXG4gICAgZW5kZWQgPSB0cnVlXG4gICAgaWYoYXJndW1lbnRzLmxlbmd0aCkgc3RyZWFtLndyaXRlKGRhdGEpXG4gICAgX2VuZCgpIC8vIHdpbGwgZW1pdCBvciBxdWV1ZVxuICAgIHJldHVybiBzdHJlYW1cbiAgfVxuXG4gIHN0cmVhbS5kZXN0cm95ID0gZnVuY3Rpb24gKCkge1xuICAgIGlmKGRlc3Ryb3llZCkgcmV0dXJuXG4gICAgZGVzdHJveWVkID0gdHJ1ZVxuICAgIGVuZGVkID0gdHJ1ZVxuICAgIGJ1ZmZlci5sZW5ndGggPSAwXG4gICAgc3RyZWFtLndyaXRhYmxlID0gc3RyZWFtLnJlYWRhYmxlID0gZmFsc2VcbiAgICBzdHJlYW0uZW1pdCgnY2xvc2UnKVxuICAgIHJldHVybiBzdHJlYW1cbiAgfVxuXG4gIHN0cmVhbS5wYXVzZSA9IGZ1bmN0aW9uICgpIHtcbiAgICBpZihzdHJlYW0ucGF1c2VkKSByZXR1cm5cbiAgICBzdHJlYW0ucGF1c2VkID0gdHJ1ZVxuICAgIHN0cmVhbS5lbWl0KCdwYXVzZScpXG4gICAgcmV0dXJuIHN0cmVhbVxuICB9XG4gIHN0cmVhbS5yZXN1bWUgPSBmdW5jdGlvbiAoKSB7XG4gICAgaWYoc3RyZWFtLnBhdXNlZCkge1xuICAgICAgc3RyZWFtLnBhdXNlZCA9IGZhbHNlXG4gICAgfVxuICAgIGRyYWluKClcbiAgICAvL21heSBoYXZlIGJlY29tZSBwYXVzZWQgYWdhaW4sXG4gICAgLy9hcyBkcmFpbiBlbWl0cyAnZGF0YScuXG4gICAgaWYoIXN0cmVhbS5wYXVzZWQpXG4gICAgICBzdHJlYW0uZW1pdCgnZHJhaW4nKVxuICAgIHJldHVybiBzdHJlYW1cbiAgfVxuICByZXR1cm4gc3RyZWFtXG59XG5cblxufSkocmVxdWlyZShcIl9fYnJvd3NlcmlmeV9wcm9jZXNzXCIpKSIsInZhciBldmVudHMgPSByZXF1aXJlKCdldmVudHMnKTtcbnZhciB1dGlsID0gcmVxdWlyZSgndXRpbCcpO1xuXG5mdW5jdGlvbiBTdHJlYW0oKSB7XG4gIGV2ZW50cy5FdmVudEVtaXR0ZXIuY2FsbCh0aGlzKTtcbn1cbnV0aWwuaW5oZXJpdHMoU3RyZWFtLCBldmVudHMuRXZlbnRFbWl0dGVyKTtcbm1vZHVsZS5leHBvcnRzID0gU3RyZWFtO1xuLy8gQmFja3dhcmRzLWNvbXBhdCB3aXRoIG5vZGUgMC40LnhcblN0cmVhbS5TdHJlYW0gPSBTdHJlYW07XG5cblN0cmVhbS5wcm90b3R5cGUucGlwZSA9IGZ1bmN0aW9uKGRlc3QsIG9wdGlvbnMpIHtcbiAgdmFyIHNvdXJjZSA9IHRoaXM7XG5cbiAgZnVuY3Rpb24gb25kYXRhKGNodW5rKSB7XG4gICAgaWYgKGRlc3Qud3JpdGFibGUpIHtcbiAgICAgIGlmIChmYWxzZSA9PT0gZGVzdC53cml0ZShjaHVuaykgJiYgc291cmNlLnBhdXNlKSB7XG4gICAgICAgIHNvdXJjZS5wYXVzZSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHNvdXJjZS5vbignZGF0YScsIG9uZGF0YSk7XG5cbiAgZnVuY3Rpb24gb25kcmFpbigpIHtcbiAgICBpZiAoc291cmNlLnJlYWRhYmxlICYmIHNvdXJjZS5yZXN1bWUpIHtcbiAgICAgIHNvdXJjZS5yZXN1bWUoKTtcbiAgICB9XG4gIH1cblxuICBkZXN0Lm9uKCdkcmFpbicsIG9uZHJhaW4pO1xuXG4gIC8vIElmIHRoZSAnZW5kJyBvcHRpb24gaXMgbm90IHN1cHBsaWVkLCBkZXN0LmVuZCgpIHdpbGwgYmUgY2FsbGVkIHdoZW5cbiAgLy8gc291cmNlIGdldHMgdGhlICdlbmQnIG9yICdjbG9zZScgZXZlbnRzLiAgT25seSBkZXN0LmVuZCgpIG9uY2UsIGFuZFxuICAvLyBvbmx5IHdoZW4gYWxsIHNvdXJjZXMgaGF2ZSBlbmRlZC5cbiAgaWYgKCFkZXN0Ll9pc1N0ZGlvICYmICghb3B0aW9ucyB8fCBvcHRpb25zLmVuZCAhPT0gZmFsc2UpKSB7XG4gICAgZGVzdC5fcGlwZUNvdW50ID0gZGVzdC5fcGlwZUNvdW50IHx8IDA7XG4gICAgZGVzdC5fcGlwZUNvdW50Kys7XG5cbiAgICBzb3VyY2Uub24oJ2VuZCcsIG9uZW5kKTtcbiAgICBzb3VyY2Uub24oJ2Nsb3NlJywgb25jbG9zZSk7XG4gIH1cblxuICB2YXIgZGlkT25FbmQgPSBmYWxzZTtcbiAgZnVuY3Rpb24gb25lbmQoKSB7XG4gICAgaWYgKGRpZE9uRW5kKSByZXR1cm47XG4gICAgZGlkT25FbmQgPSB0cnVlO1xuXG4gICAgZGVzdC5fcGlwZUNvdW50LS07XG5cbiAgICAvLyByZW1vdmUgdGhlIGxpc3RlbmVyc1xuICAgIGNsZWFudXAoKTtcblxuICAgIGlmIChkZXN0Ll9waXBlQ291bnQgPiAwKSB7XG4gICAgICAvLyB3YWl0aW5nIGZvciBvdGhlciBpbmNvbWluZyBzdHJlYW1zIHRvIGVuZC5cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBkZXN0LmVuZCgpO1xuICB9XG5cblxuICBmdW5jdGlvbiBvbmNsb3NlKCkge1xuICAgIGlmIChkaWRPbkVuZCkgcmV0dXJuO1xuICAgIGRpZE9uRW5kID0gdHJ1ZTtcblxuICAgIGRlc3QuX3BpcGVDb3VudC0tO1xuXG4gICAgLy8gcmVtb3ZlIHRoZSBsaXN0ZW5lcnNcbiAgICBjbGVhbnVwKCk7XG5cbiAgICBpZiAoZGVzdC5fcGlwZUNvdW50ID4gMCkge1xuICAgICAgLy8gd2FpdGluZyBmb3Igb3RoZXIgaW5jb21pbmcgc3RyZWFtcyB0byBlbmQuXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgZGVzdC5kZXN0cm95KCk7XG4gIH1cblxuICAvLyBkb24ndCBsZWF2ZSBkYW5nbGluZyBwaXBlcyB3aGVuIHRoZXJlIGFyZSBlcnJvcnMuXG4gIGZ1bmN0aW9uIG9uZXJyb3IoZXIpIHtcbiAgICBjbGVhbnVwKCk7XG4gICAgaWYgKHRoaXMubGlzdGVuZXJzKCdlcnJvcicpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgZXI7IC8vIFVuaGFuZGxlZCBzdHJlYW0gZXJyb3IgaW4gcGlwZS5cbiAgICB9XG4gIH1cblxuICBzb3VyY2Uub24oJ2Vycm9yJywgb25lcnJvcik7XG4gIGRlc3Qub24oJ2Vycm9yJywgb25lcnJvcik7XG5cbiAgLy8gcmVtb3ZlIGFsbCB0aGUgZXZlbnQgbGlzdGVuZXJzIHRoYXQgd2VyZSBhZGRlZC5cbiAgZnVuY3Rpb24gY2xlYW51cCgpIHtcbiAgICBzb3VyY2UucmVtb3ZlTGlzdGVuZXIoJ2RhdGEnLCBvbmRhdGEpO1xuICAgIGRlc3QucmVtb3ZlTGlzdGVuZXIoJ2RyYWluJywgb25kcmFpbik7XG5cbiAgICBzb3VyY2UucmVtb3ZlTGlzdGVuZXIoJ2VuZCcsIG9uZW5kKTtcbiAgICBzb3VyY2UucmVtb3ZlTGlzdGVuZXIoJ2Nsb3NlJywgb25jbG9zZSk7XG5cbiAgICBzb3VyY2UucmVtb3ZlTGlzdGVuZXIoJ2Vycm9yJywgb25lcnJvcik7XG4gICAgZGVzdC5yZW1vdmVMaXN0ZW5lcignZXJyb3InLCBvbmVycm9yKTtcblxuICAgIHNvdXJjZS5yZW1vdmVMaXN0ZW5lcignZW5kJywgY2xlYW51cCk7XG4gICAgc291cmNlLnJlbW92ZUxpc3RlbmVyKCdjbG9zZScsIGNsZWFudXApO1xuXG4gICAgZGVzdC5yZW1vdmVMaXN0ZW5lcignZW5kJywgY2xlYW51cCk7XG4gICAgZGVzdC5yZW1vdmVMaXN0ZW5lcignY2xvc2UnLCBjbGVhbnVwKTtcbiAgfVxuXG4gIHNvdXJjZS5vbignZW5kJywgY2xlYW51cCk7XG4gIHNvdXJjZS5vbignY2xvc2UnLCBjbGVhbnVwKTtcblxuICBkZXN0Lm9uKCdlbmQnLCBjbGVhbnVwKTtcbiAgZGVzdC5vbignY2xvc2UnLCBjbGVhbnVwKTtcblxuICBkZXN0LmVtaXQoJ3BpcGUnLCBzb3VyY2UpO1xuXG4gIC8vIEFsbG93IGZvciB1bml4LWxpa2UgdXNhZ2U6IEEucGlwZShCKS5waXBlKEMpXG4gIHJldHVybiBkZXN0O1xufTtcbiIsInZhciBldmVudHMgPSByZXF1aXJlKCdldmVudHMnKTtcblxuZXhwb3J0cy5pc0FycmF5ID0gaXNBcnJheTtcbmV4cG9ydHMuaXNEYXRlID0gZnVuY3Rpb24ob2JqKXtyZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iaikgPT09ICdbb2JqZWN0IERhdGVdJ307XG5leHBvcnRzLmlzUmVnRXhwID0gZnVuY3Rpb24ob2JqKXtyZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iaikgPT09ICdbb2JqZWN0IFJlZ0V4cF0nfTtcblxuXG5leHBvcnRzLnByaW50ID0gZnVuY3Rpb24gKCkge307XG5leHBvcnRzLnB1dHMgPSBmdW5jdGlvbiAoKSB7fTtcbmV4cG9ydHMuZGVidWcgPSBmdW5jdGlvbigpIHt9O1xuXG5leHBvcnRzLmluc3BlY3QgPSBmdW5jdGlvbihvYmosIHNob3dIaWRkZW4sIGRlcHRoLCBjb2xvcnMpIHtcbiAgdmFyIHNlZW4gPSBbXTtcblxuICB2YXIgc3R5bGl6ZSA9IGZ1bmN0aW9uKHN0ciwgc3R5bGVUeXBlKSB7XG4gICAgLy8gaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9BTlNJX2VzY2FwZV9jb2RlI2dyYXBoaWNzXG4gICAgdmFyIHN0eWxlcyA9XG4gICAgICAgIHsgJ2JvbGQnIDogWzEsIDIyXSxcbiAgICAgICAgICAnaXRhbGljJyA6IFszLCAyM10sXG4gICAgICAgICAgJ3VuZGVybGluZScgOiBbNCwgMjRdLFxuICAgICAgICAgICdpbnZlcnNlJyA6IFs3LCAyN10sXG4gICAgICAgICAgJ3doaXRlJyA6IFszNywgMzldLFxuICAgICAgICAgICdncmV5JyA6IFs5MCwgMzldLFxuICAgICAgICAgICdibGFjaycgOiBbMzAsIDM5XSxcbiAgICAgICAgICAnYmx1ZScgOiBbMzQsIDM5XSxcbiAgICAgICAgICAnY3lhbicgOiBbMzYsIDM5XSxcbiAgICAgICAgICAnZ3JlZW4nIDogWzMyLCAzOV0sXG4gICAgICAgICAgJ21hZ2VudGEnIDogWzM1LCAzOV0sXG4gICAgICAgICAgJ3JlZCcgOiBbMzEsIDM5XSxcbiAgICAgICAgICAneWVsbG93JyA6IFszMywgMzldIH07XG5cbiAgICB2YXIgc3R5bGUgPVxuICAgICAgICB7ICdzcGVjaWFsJzogJ2N5YW4nLFxuICAgICAgICAgICdudW1iZXInOiAnYmx1ZScsXG4gICAgICAgICAgJ2Jvb2xlYW4nOiAneWVsbG93JyxcbiAgICAgICAgICAndW5kZWZpbmVkJzogJ2dyZXknLFxuICAgICAgICAgICdudWxsJzogJ2JvbGQnLFxuICAgICAgICAgICdzdHJpbmcnOiAnZ3JlZW4nLFxuICAgICAgICAgICdkYXRlJzogJ21hZ2VudGEnLFxuICAgICAgICAgIC8vIFwibmFtZVwiOiBpbnRlbnRpb25hbGx5IG5vdCBzdHlsaW5nXG4gICAgICAgICAgJ3JlZ2V4cCc6ICdyZWQnIH1bc3R5bGVUeXBlXTtcblxuICAgIGlmIChzdHlsZSkge1xuICAgICAgcmV0dXJuICdcXDAzM1snICsgc3R5bGVzW3N0eWxlXVswXSArICdtJyArIHN0ciArXG4gICAgICAgICAgICAgJ1xcMDMzWycgKyBzdHlsZXNbc3R5bGVdWzFdICsgJ20nO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gc3RyO1xuICAgIH1cbiAgfTtcbiAgaWYgKCEgY29sb3JzKSB7XG4gICAgc3R5bGl6ZSA9IGZ1bmN0aW9uKHN0ciwgc3R5bGVUeXBlKSB7IHJldHVybiBzdHI7IH07XG4gIH1cblxuICBmdW5jdGlvbiBmb3JtYXQodmFsdWUsIHJlY3Vyc2VUaW1lcykge1xuICAgIC8vIFByb3ZpZGUgYSBob29rIGZvciB1c2VyLXNwZWNpZmllZCBpbnNwZWN0IGZ1bmN0aW9ucy5cbiAgICAvLyBDaGVjayB0aGF0IHZhbHVlIGlzIGFuIG9iamVjdCB3aXRoIGFuIGluc3BlY3QgZnVuY3Rpb24gb24gaXRcbiAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlLmluc3BlY3QgPT09ICdmdW5jdGlvbicgJiZcbiAgICAgICAgLy8gRmlsdGVyIG91dCB0aGUgdXRpbCBtb2R1bGUsIGl0J3MgaW5zcGVjdCBmdW5jdGlvbiBpcyBzcGVjaWFsXG4gICAgICAgIHZhbHVlICE9PSBleHBvcnRzICYmXG4gICAgICAgIC8vIEFsc28gZmlsdGVyIG91dCBhbnkgcHJvdG90eXBlIG9iamVjdHMgdXNpbmcgdGhlIGNpcmN1bGFyIGNoZWNrLlxuICAgICAgICAhKHZhbHVlLmNvbnN0cnVjdG9yICYmIHZhbHVlLmNvbnN0cnVjdG9yLnByb3RvdHlwZSA9PT0gdmFsdWUpKSB7XG4gICAgICByZXR1cm4gdmFsdWUuaW5zcGVjdChyZWN1cnNlVGltZXMpO1xuICAgIH1cblxuICAgIC8vIFByaW1pdGl2ZSB0eXBlcyBjYW5ub3QgaGF2ZSBwcm9wZXJ0aWVzXG4gICAgc3dpdGNoICh0eXBlb2YgdmFsdWUpIHtcbiAgICAgIGNhc2UgJ3VuZGVmaW5lZCc6XG4gICAgICAgIHJldHVybiBzdHlsaXplKCd1bmRlZmluZWQnLCAndW5kZWZpbmVkJyk7XG5cbiAgICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICAgIHZhciBzaW1wbGUgPSAnXFwnJyArIEpTT04uc3RyaW5naWZ5KHZhbHVlKS5yZXBsYWNlKC9eXCJ8XCIkL2csICcnKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC8nL2csIFwiXFxcXCdcIilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgvXFxcXFwiL2csICdcIicpICsgJ1xcJyc7XG4gICAgICAgIHJldHVybiBzdHlsaXplKHNpbXBsZSwgJ3N0cmluZycpO1xuXG4gICAgICBjYXNlICdudW1iZXInOlxuICAgICAgICByZXR1cm4gc3R5bGl6ZSgnJyArIHZhbHVlLCAnbnVtYmVyJyk7XG5cbiAgICAgIGNhc2UgJ2Jvb2xlYW4nOlxuICAgICAgICByZXR1cm4gc3R5bGl6ZSgnJyArIHZhbHVlLCAnYm9vbGVhbicpO1xuICAgIH1cbiAgICAvLyBGb3Igc29tZSByZWFzb24gdHlwZW9mIG51bGwgaXMgXCJvYmplY3RcIiwgc28gc3BlY2lhbCBjYXNlIGhlcmUuXG4gICAgaWYgKHZhbHVlID09PSBudWxsKSB7XG4gICAgICByZXR1cm4gc3R5bGl6ZSgnbnVsbCcsICdudWxsJyk7XG4gICAgfVxuXG4gICAgLy8gTG9vayB1cCB0aGUga2V5cyBvZiB0aGUgb2JqZWN0LlxuICAgIHZhciB2aXNpYmxlX2tleXMgPSBPYmplY3Rfa2V5cyh2YWx1ZSk7XG4gICAgdmFyIGtleXMgPSBzaG93SGlkZGVuID8gT2JqZWN0X2dldE93blByb3BlcnR5TmFtZXModmFsdWUpIDogdmlzaWJsZV9rZXlzO1xuXG4gICAgLy8gRnVuY3Rpb25zIHdpdGhvdXQgcHJvcGVydGllcyBjYW4gYmUgc2hvcnRjdXR0ZWQuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJyAmJiBrZXlzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgaWYgKGlzUmVnRXhwKHZhbHVlKSkge1xuICAgICAgICByZXR1cm4gc3R5bGl6ZSgnJyArIHZhbHVlLCAncmVnZXhwJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgbmFtZSA9IHZhbHVlLm5hbWUgPyAnOiAnICsgdmFsdWUubmFtZSA6ICcnO1xuICAgICAgICByZXR1cm4gc3R5bGl6ZSgnW0Z1bmN0aW9uJyArIG5hbWUgKyAnXScsICdzcGVjaWFsJyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRGF0ZXMgd2l0aG91dCBwcm9wZXJ0aWVzIGNhbiBiZSBzaG9ydGN1dHRlZFxuICAgIGlmIChpc0RhdGUodmFsdWUpICYmIGtleXMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gc3R5bGl6ZSh2YWx1ZS50b1VUQ1N0cmluZygpLCAnZGF0ZScpO1xuICAgIH1cblxuICAgIHZhciBiYXNlLCB0eXBlLCBicmFjZXM7XG4gICAgLy8gRGV0ZXJtaW5lIHRoZSBvYmplY3QgdHlwZVxuICAgIGlmIChpc0FycmF5KHZhbHVlKSkge1xuICAgICAgdHlwZSA9ICdBcnJheSc7XG4gICAgICBicmFjZXMgPSBbJ1snLCAnXSddO1xuICAgIH0gZWxzZSB7XG4gICAgICB0eXBlID0gJ09iamVjdCc7XG4gICAgICBicmFjZXMgPSBbJ3snLCAnfSddO1xuICAgIH1cblxuICAgIC8vIE1ha2UgZnVuY3Rpb25zIHNheSB0aGF0IHRoZXkgYXJlIGZ1bmN0aW9uc1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHZhciBuID0gdmFsdWUubmFtZSA/ICc6ICcgKyB2YWx1ZS5uYW1lIDogJyc7XG4gICAgICBiYXNlID0gKGlzUmVnRXhwKHZhbHVlKSkgPyAnICcgKyB2YWx1ZSA6ICcgW0Z1bmN0aW9uJyArIG4gKyAnXSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIGJhc2UgPSAnJztcbiAgICB9XG5cbiAgICAvLyBNYWtlIGRhdGVzIHdpdGggcHJvcGVydGllcyBmaXJzdCBzYXkgdGhlIGRhdGVcbiAgICBpZiAoaXNEYXRlKHZhbHVlKSkge1xuICAgICAgYmFzZSA9ICcgJyArIHZhbHVlLnRvVVRDU3RyaW5nKCk7XG4gICAgfVxuXG4gICAgaWYgKGtleXMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gYnJhY2VzWzBdICsgYmFzZSArIGJyYWNlc1sxXTtcbiAgICB9XG5cbiAgICBpZiAocmVjdXJzZVRpbWVzIDwgMCkge1xuICAgICAgaWYgKGlzUmVnRXhwKHZhbHVlKSkge1xuICAgICAgICByZXR1cm4gc3R5bGl6ZSgnJyArIHZhbHVlLCAncmVnZXhwJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gc3R5bGl6ZSgnW09iamVjdF0nLCAnc3BlY2lhbCcpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHNlZW4ucHVzaCh2YWx1ZSk7XG5cbiAgICB2YXIgb3V0cHV0ID0ga2V5cy5tYXAoZnVuY3Rpb24oa2V5KSB7XG4gICAgICB2YXIgbmFtZSwgc3RyO1xuICAgICAgaWYgKHZhbHVlLl9fbG9va3VwR2V0dGVyX18pIHtcbiAgICAgICAgaWYgKHZhbHVlLl9fbG9va3VwR2V0dGVyX18oa2V5KSkge1xuICAgICAgICAgIGlmICh2YWx1ZS5fX2xvb2t1cFNldHRlcl9fKGtleSkpIHtcbiAgICAgICAgICAgIHN0ciA9IHN0eWxpemUoJ1tHZXR0ZXIvU2V0dGVyXScsICdzcGVjaWFsJyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHN0ciA9IHN0eWxpemUoJ1tHZXR0ZXJdJywgJ3NwZWNpYWwnKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKHZhbHVlLl9fbG9va3VwU2V0dGVyX18oa2V5KSkge1xuICAgICAgICAgICAgc3RyID0gc3R5bGl6ZSgnW1NldHRlcl0nLCAnc3BlY2lhbCcpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHZpc2libGVfa2V5cy5pbmRleE9mKGtleSkgPCAwKSB7XG4gICAgICAgIG5hbWUgPSAnWycgKyBrZXkgKyAnXSc7XG4gICAgICB9XG4gICAgICBpZiAoIXN0cikge1xuICAgICAgICBpZiAoc2Vlbi5pbmRleE9mKHZhbHVlW2tleV0pIDwgMCkge1xuICAgICAgICAgIGlmIChyZWN1cnNlVGltZXMgPT09IG51bGwpIHtcbiAgICAgICAgICAgIHN0ciA9IGZvcm1hdCh2YWx1ZVtrZXldKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc3RyID0gZm9ybWF0KHZhbHVlW2tleV0sIHJlY3Vyc2VUaW1lcyAtIDEpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoc3RyLmluZGV4T2YoJ1xcbicpID4gLTEpIHtcbiAgICAgICAgICAgIGlmIChpc0FycmF5KHZhbHVlKSkge1xuICAgICAgICAgICAgICBzdHIgPSBzdHIuc3BsaXQoJ1xcbicpLm1hcChmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICcgICcgKyBsaW5lO1xuICAgICAgICAgICAgICB9KS5qb2luKCdcXG4nKS5zdWJzdHIoMik7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBzdHIgPSAnXFxuJyArIHN0ci5zcGxpdCgnXFxuJykubWFwKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJyAgICcgKyBsaW5lO1xuICAgICAgICAgICAgICB9KS5qb2luKCdcXG4nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc3RyID0gc3R5bGl6ZSgnW0NpcmN1bGFyXScsICdzcGVjaWFsJyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgbmFtZSA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgaWYgKHR5cGUgPT09ICdBcnJheScgJiYga2V5Lm1hdGNoKC9eXFxkKyQvKSkge1xuICAgICAgICAgIHJldHVybiBzdHI7XG4gICAgICAgIH1cbiAgICAgICAgbmFtZSA9IEpTT04uc3RyaW5naWZ5KCcnICsga2V5KTtcbiAgICAgICAgaWYgKG5hbWUubWF0Y2goL15cIihbYS16QS1aX11bYS16QS1aXzAtOV0qKVwiJC8pKSB7XG4gICAgICAgICAgbmFtZSA9IG5hbWUuc3Vic3RyKDEsIG5hbWUubGVuZ3RoIC0gMik7XG4gICAgICAgICAgbmFtZSA9IHN0eWxpemUobmFtZSwgJ25hbWUnKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBuYW1lID0gbmFtZS5yZXBsYWNlKC8nL2csIFwiXFxcXCdcIilcbiAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC9cXFxcXCIvZywgJ1wiJylcbiAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC8oXlwifFwiJCkvZywgXCInXCIpO1xuICAgICAgICAgIG5hbWUgPSBzdHlsaXplKG5hbWUsICdzdHJpbmcnKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gbmFtZSArICc6ICcgKyBzdHI7XG4gICAgfSk7XG5cbiAgICBzZWVuLnBvcCgpO1xuXG4gICAgdmFyIG51bUxpbmVzRXN0ID0gMDtcbiAgICB2YXIgbGVuZ3RoID0gb3V0cHV0LnJlZHVjZShmdW5jdGlvbihwcmV2LCBjdXIpIHtcbiAgICAgIG51bUxpbmVzRXN0Kys7XG4gICAgICBpZiAoY3VyLmluZGV4T2YoJ1xcbicpID49IDApIG51bUxpbmVzRXN0Kys7XG4gICAgICByZXR1cm4gcHJldiArIGN1ci5sZW5ndGggKyAxO1xuICAgIH0sIDApO1xuXG4gICAgaWYgKGxlbmd0aCA+IDUwKSB7XG4gICAgICBvdXRwdXQgPSBicmFjZXNbMF0gK1xuICAgICAgICAgICAgICAgKGJhc2UgPT09ICcnID8gJycgOiBiYXNlICsgJ1xcbiAnKSArXG4gICAgICAgICAgICAgICAnICcgK1xuICAgICAgICAgICAgICAgb3V0cHV0LmpvaW4oJyxcXG4gICcpICtcbiAgICAgICAgICAgICAgICcgJyArXG4gICAgICAgICAgICAgICBicmFjZXNbMV07XG5cbiAgICB9IGVsc2Uge1xuICAgICAgb3V0cHV0ID0gYnJhY2VzWzBdICsgYmFzZSArICcgJyArIG91dHB1dC5qb2luKCcsICcpICsgJyAnICsgYnJhY2VzWzFdO1xuICAgIH1cblxuICAgIHJldHVybiBvdXRwdXQ7XG4gIH1cbiAgcmV0dXJuIGZvcm1hdChvYmosICh0eXBlb2YgZGVwdGggPT09ICd1bmRlZmluZWQnID8gMiA6IGRlcHRoKSk7XG59O1xuXG5cbmZ1bmN0aW9uIGlzQXJyYXkoYXIpIHtcbiAgcmV0dXJuIGFyIGluc3RhbmNlb2YgQXJyYXkgfHxcbiAgICAgICAgIEFycmF5LmlzQXJyYXkoYXIpIHx8XG4gICAgICAgICAoYXIgJiYgYXIgIT09IE9iamVjdC5wcm90b3R5cGUgJiYgaXNBcnJheShhci5fX3Byb3RvX18pKTtcbn1cblxuXG5mdW5jdGlvbiBpc1JlZ0V4cChyZSkge1xuICByZXR1cm4gcmUgaW5zdGFuY2VvZiBSZWdFeHAgfHxcbiAgICAodHlwZW9mIHJlID09PSAnb2JqZWN0JyAmJiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwocmUpID09PSAnW29iamVjdCBSZWdFeHBdJyk7XG59XG5cblxuZnVuY3Rpb24gaXNEYXRlKGQpIHtcbiAgaWYgKGQgaW5zdGFuY2VvZiBEYXRlKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHR5cGVvZiBkICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuICB2YXIgcHJvcGVydGllcyA9IERhdGUucHJvdG90eXBlICYmIE9iamVjdF9nZXRPd25Qcm9wZXJ0eU5hbWVzKERhdGUucHJvdG90eXBlKTtcbiAgdmFyIHByb3RvID0gZC5fX3Byb3RvX18gJiYgT2JqZWN0X2dldE93blByb3BlcnR5TmFtZXMoZC5fX3Byb3RvX18pO1xuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkocHJvdG8pID09PSBKU09OLnN0cmluZ2lmeShwcm9wZXJ0aWVzKTtcbn1cblxuZnVuY3Rpb24gcGFkKG4pIHtcbiAgcmV0dXJuIG4gPCAxMCA/ICcwJyArIG4udG9TdHJpbmcoMTApIDogbi50b1N0cmluZygxMCk7XG59XG5cbnZhciBtb250aHMgPSBbJ0phbicsICdGZWInLCAnTWFyJywgJ0FwcicsICdNYXknLCAnSnVuJywgJ0p1bCcsICdBdWcnLCAnU2VwJyxcbiAgICAgICAgICAgICAgJ09jdCcsICdOb3YnLCAnRGVjJ107XG5cbi8vIDI2IEZlYiAxNjoxOTozNFxuZnVuY3Rpb24gdGltZXN0YW1wKCkge1xuICB2YXIgZCA9IG5ldyBEYXRlKCk7XG4gIHZhciB0aW1lID0gW3BhZChkLmdldEhvdXJzKCkpLFxuICAgICAgICAgICAgICBwYWQoZC5nZXRNaW51dGVzKCkpLFxuICAgICAgICAgICAgICBwYWQoZC5nZXRTZWNvbmRzKCkpXS5qb2luKCc6Jyk7XG4gIHJldHVybiBbZC5nZXREYXRlKCksIG1vbnRoc1tkLmdldE1vbnRoKCldLCB0aW1lXS5qb2luKCcgJyk7XG59XG5cbmV4cG9ydHMubG9nID0gZnVuY3Rpb24gKG1zZykge307XG5cbmV4cG9ydHMucHVtcCA9IG51bGw7XG5cbnZhciBPYmplY3Rfa2V5cyA9IE9iamVjdC5rZXlzIHx8IGZ1bmN0aW9uIChvYmopIHtcbiAgICB2YXIgcmVzID0gW107XG4gICAgZm9yICh2YXIga2V5IGluIG9iaikgcmVzLnB1c2goa2V5KTtcbiAgICByZXR1cm4gcmVzO1xufTtcblxudmFyIE9iamVjdF9nZXRPd25Qcm9wZXJ0eU5hbWVzID0gT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMgfHwgZnVuY3Rpb24gKG9iaikge1xuICAgIHZhciByZXMgPSBbXTtcbiAgICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgICAgIGlmIChPYmplY3QuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIGtleSkpIHJlcy5wdXNoKGtleSk7XG4gICAgfVxuICAgIHJldHVybiByZXM7XG59O1xuXG52YXIgT2JqZWN0X2NyZWF0ZSA9IE9iamVjdC5jcmVhdGUgfHwgZnVuY3Rpb24gKHByb3RvdHlwZSwgcHJvcGVydGllcykge1xuICAgIC8vIGZyb20gZXM1LXNoaW1cbiAgICB2YXIgb2JqZWN0O1xuICAgIGlmIChwcm90b3R5cGUgPT09IG51bGwpIHtcbiAgICAgICAgb2JqZWN0ID0geyAnX19wcm90b19fJyA6IG51bGwgfTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGlmICh0eXBlb2YgcHJvdG90eXBlICE9PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgICAgICAgICAndHlwZW9mIHByb3RvdHlwZVsnICsgKHR5cGVvZiBwcm90b3R5cGUpICsgJ10gIT0gXFwnb2JqZWN0XFwnJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgVHlwZSA9IGZ1bmN0aW9uICgpIHt9O1xuICAgICAgICBUeXBlLnByb3RvdHlwZSA9IHByb3RvdHlwZTtcbiAgICAgICAgb2JqZWN0ID0gbmV3IFR5cGUoKTtcbiAgICAgICAgb2JqZWN0Ll9fcHJvdG9fXyA9IHByb3RvdHlwZTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBwcm9wZXJ0aWVzICE9PSAndW5kZWZpbmVkJyAmJiBPYmplY3QuZGVmaW5lUHJvcGVydGllcykge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyhvYmplY3QsIHByb3BlcnRpZXMpO1xuICAgIH1cbiAgICByZXR1cm4gb2JqZWN0O1xufTtcblxuZXhwb3J0cy5pbmhlcml0cyA9IGZ1bmN0aW9uKGN0b3IsIHN1cGVyQ3Rvcikge1xuICBjdG9yLnN1cGVyXyA9IHN1cGVyQ3RvcjtcbiAgY3Rvci5wcm90b3R5cGUgPSBPYmplY3RfY3JlYXRlKHN1cGVyQ3Rvci5wcm90b3R5cGUsIHtcbiAgICBjb25zdHJ1Y3Rvcjoge1xuICAgICAgdmFsdWU6IGN0b3IsXG4gICAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICAgIHdyaXRhYmxlOiB0cnVlLFxuICAgICAgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgfVxuICB9KTtcbn07XG5cbnZhciBmb3JtYXRSZWdFeHAgPSAvJVtzZGolXS9nO1xuZXhwb3J0cy5mb3JtYXQgPSBmdW5jdGlvbihmKSB7XG4gIGlmICh0eXBlb2YgZiAhPT0gJ3N0cmluZycpIHtcbiAgICB2YXIgb2JqZWN0cyA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBvYmplY3RzLnB1c2goZXhwb3J0cy5pbnNwZWN0KGFyZ3VtZW50c1tpXSkpO1xuICAgIH1cbiAgICByZXR1cm4gb2JqZWN0cy5qb2luKCcgJyk7XG4gIH1cblxuICB2YXIgaSA9IDE7XG4gIHZhciBhcmdzID0gYXJndW1lbnRzO1xuICB2YXIgbGVuID0gYXJncy5sZW5ndGg7XG4gIHZhciBzdHIgPSBTdHJpbmcoZikucmVwbGFjZShmb3JtYXRSZWdFeHAsIGZ1bmN0aW9uKHgpIHtcbiAgICBpZiAoeCA9PT0gJyUlJykgcmV0dXJuICclJztcbiAgICBpZiAoaSA+PSBsZW4pIHJldHVybiB4O1xuICAgIHN3aXRjaCAoeCkge1xuICAgICAgY2FzZSAnJXMnOiByZXR1cm4gU3RyaW5nKGFyZ3NbaSsrXSk7XG4gICAgICBjYXNlICclZCc6IHJldHVybiBOdW1iZXIoYXJnc1tpKytdKTtcbiAgICAgIGNhc2UgJyVqJzogcmV0dXJuIEpTT04uc3RyaW5naWZ5KGFyZ3NbaSsrXSk7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4geDtcbiAgICB9XG4gIH0pO1xuICBmb3IodmFyIHggPSBhcmdzW2ldOyBpIDwgbGVuOyB4ID0gYXJnc1srK2ldKXtcbiAgICBpZiAoeCA9PT0gbnVsbCB8fCB0eXBlb2YgeCAhPT0gJ29iamVjdCcpIHtcbiAgICAgIHN0ciArPSAnICcgKyB4O1xuICAgIH0gZWxzZSB7XG4gICAgICBzdHIgKz0gJyAnICsgZXhwb3J0cy5pbnNwZWN0KHgpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gc3RyO1xufTtcbiIsIihmdW5jdGlvbihwcm9jZXNzKXt2YXIgdHJhdmVyc2UgPSByZXF1aXJlKCd0cmF2ZXJzZScpO1xudmFyIFN0cmVhbSA9IHJlcXVpcmUoJ3N0cmVhbScpLlN0cmVhbTtcbnZhciBjaGFybSA9IHJlcXVpcmUoJ2NoYXJtJyk7XG52YXIgZGVlcEVxdWFsID0gcmVxdWlyZSgnZGVlcC1lcXVhbCcpO1xuXG52YXIgZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9wdHNfKSB7XG4gICAgdmFyIGZuID0gZGlmZmxldC5iaW5kKG51bGwsIG9wdHNfKTtcbiAgICBmbi5jb21wYXJlID0gZnVuY3Rpb24gKHByZXYsIG5leHQpIHtcbiAgICAgICAgdmFyIG9wdHMgPSBPYmplY3Qua2V5cyhvcHRzXyB8fCB7fSkucmVkdWNlKGZ1bmN0aW9uIChhY2MsIGtleSkge1xuICAgICAgICAgICAgYWNjW2tleV0gPSBvcHRzX1trZXldO1xuICAgICAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgICAgfSwge30pO1xuICAgICAgICB2YXIgcyA9IG9wdHMuc3RyZWFtID0gbmV3IFN0cmVhbTtcbiAgICAgICAgdmFyIGRhdGEgPSAnJztcbiAgICAgICAgcy53cml0ZSA9IGZ1bmN0aW9uIChidWYpIHsgZGF0YSArPSBidWYgfTtcbiAgICAgICAgcy5lbmQgPSBmdW5jdGlvbiAoKSB7fTtcbiAgICAgICAgcy5yZWFkYWJsZSA9IHRydWU7XG4gICAgICAgIHMud3JpdGFibGUgPSB0cnVlO1xuICAgICAgICBcbiAgICAgICAgZGlmZmxldChvcHRzLCBwcmV2LCBuZXh0KTtcbiAgICAgICAgcmV0dXJuIGRhdGE7XG4gICAgfTtcbiAgICByZXR1cm4gZm47XG59O1xuXG5leHBvcnRzLmNvbXBhcmUgPSBmdW5jdGlvbiAocHJldiwgbmV4dCkge1xuICAgIHJldHVybiBleHBvcnRzKHt9KS5jb21wYXJlKHByZXYsIG5leHQpO1xufTtcblxuZnVuY3Rpb24gZGlmZmxldCAob3B0cywgcHJldiwgbmV4dCkge1xuICAgIHZhciBzdHJlYW0gPSBvcHRzLnN0cmVhbSB8fCBuZXcgU3RyZWFtO1xuICAgIGlmICghb3B0cy5zdHJlYW0pIHtcbiAgICAgICAgc3RyZWFtLnJlYWRhYmxlID0gdHJ1ZTtcbiAgICAgICAgc3RyZWFtLndyaXRhYmxlID0gdHJ1ZTtcbiAgICAgICAgc3RyZWFtLndyaXRlID0gZnVuY3Rpb24gKGJ1ZikgeyB0aGlzLmVtaXQoJ2RhdGEnLCBidWYpIH07XG4gICAgICAgIHN0cmVhbS5lbmQgPSBmdW5jdGlvbiAoKSB7IHRoaXMuZW1pdCgnZW5kJykgfTtcbiAgICB9XG4gICAgXG4gICAgaWYgKCFvcHRzKSBvcHRzID0ge307XG4gICAgaWYgKG9wdHMuc3RhcnQgPT09IHVuZGVmaW5lZCAmJiBvcHRzLnN0b3AgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB2YXIgYyA9IGNoYXJtKHN0cmVhbSk7XG4gICAgICAgIG9wdHMuc3RhcnQgPSBmdW5jdGlvbiAodHlwZSkge1xuICAgICAgICAgICAgYy5mb3JlZ3JvdW5kKHtcbiAgICAgICAgICAgICAgICBpbnNlcnRlZCA6ICdncmVlbicsXG4gICAgICAgICAgICAgICAgdXBkYXRlZCA6ICdibHVlJyxcbiAgICAgICAgICAgICAgICBkZWxldGVkIDogJ3JlZCcsXG4gICAgICAgICAgICAgICAgY29tbWVudCA6ICdjeWFuJyxcbiAgICAgICAgICAgIH1bdHlwZV0pO1xuICAgICAgICAgICAgYy5kaXNwbGF5KCdicmlnaHQnKTtcbiAgICAgICAgfTtcbiAgICAgICAgb3B0cy5zdG9wID0gZnVuY3Rpb24gKHR5cGUpIHtcbiAgICAgICAgICAgIGMuZGlzcGxheSgncmVzZXQnKTtcbiAgICAgICAgfTtcbiAgICB9XG4gICAgdmFyIHdyaXRlID0gZnVuY3Rpb24gKGJ1Zikge1xuICAgICAgICBpZiAob3B0cy53cml0ZSkgb3B0cy53cml0ZShidWYsIHN0cmVhbSlcbiAgICAgICAgZWxzZSBzdHJlYW0ud3JpdGUoYnVmKVxuICAgIH07XG4gICAgXG4gICAgdmFyIGNvbW1hRmlyc3QgPSBvcHRzLmNvbW1hID09PSAnZmlyc3QnO1xuICAgIFxuICAgIHZhciBzdHJpbmdpZnkgPSBmdW5jdGlvbiAobm9kZSwgcGFyYW1zKSB7XG4gICAgICAgIHJldHVybiBzdHJpbmdpZmllci5jYWxsKHRoaXMsIHRydWUsIG5vZGUsIHBhcmFtcyB8fCBvcHRzKTtcbiAgICB9O1xuICAgIHZhciBwbGFpblN0cmluZ2lmeSA9IGZ1bmN0aW9uIChub2RlLCBwYXJhbXMpIHtcbiAgICAgICAgcmV0dXJuIHN0cmluZ2lmaWVyLmNhbGwodGhpcywgZmFsc2UsIG5vZGUsIHBhcmFtcyB8fCBvcHRzKTtcbiAgICB9O1xuICAgIFxuICAgIHZhciBsZXZlbHMgPSAwO1xuICAgIGZ1bmN0aW9uIHNldCAodHlwZSkge1xuICAgICAgICBpZiAobGV2ZWxzID09PSAwKSBvcHRzLnN0YXJ0KHR5cGUsIHN0cmVhbSk7XG4gICAgICAgIGxldmVscyArKztcbiAgICB9XG4gICAgXG4gICAgZnVuY3Rpb24gdW5zZXQgKHR5cGUpIHtcbiAgICAgICAgaWYgKC0tbGV2ZWxzID09PSAwKSBvcHRzLnN0b3AodHlwZSwgc3RyZWFtKTtcbiAgICB9XG4gICAgXG4gICAgZnVuY3Rpb24gc3RyaW5naWZpZXIgKGluc2VydGFibGUsIG5vZGUsIG9wdHMpIHtcbiAgICAgICAgdmFyIGluZGVudCA9IG9wdHMuaW5kZW50O1xuICAgICAgICBcbiAgICAgICAgaWYgKGluc2VydGFibGUpIHtcbiAgICAgICAgICAgIHZhciBwcmV2Tm9kZSA9IHRyYXZlcnNlLmdldChwcmV2LCB0aGlzLnBhdGggfHwgW10pO1xuICAgICAgICB9XG4gICAgICAgIHZhciBpbnNlcnRlZCA9IGluc2VydGFibGUgJiYgcHJldk5vZGUgPT09IHVuZGVmaW5lZDtcbiAgICAgICAgXG4gICAgICAgIHZhciBpbmRlbnR4ID0gaW5kZW50ID8gQXJyYXkoXG4gICAgICAgICAgICAoKHRoaXMucGF0aCB8fCBbXSkubGVuZ3RoICsgMSkgKiBpbmRlbnQgKyAxXG4gICAgICAgICkuam9pbignICcpIDogJyc7XG4gICAgICAgIGlmIChjb21tYUZpcnN0KSBpbmRlbnR4ID0gaW5kZW50eC5zbGljZShpbmRlbnQpO1xuICAgICAgICBcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobm9kZSkpIHtcbiAgICAgICAgICAgIHZhciB1cGRhdGVkID0gKHByZXZOb2RlIHx8IHRyYXZlcnNlLmhhcyhwcmV2LCB0aGlzLnBhdGgpKVxuICAgICAgICAgICAgICAgICYmICFBcnJheS5pc0FycmF5KHByZXZOb2RlKTtcbiAgICAgICAgICAgIGlmICh1cGRhdGVkKSB7XG4gICAgICAgICAgICAgICAgc2V0KCd1cGRhdGVkJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChvcHRzLmNvbW1lbnQgJiYgIUFycmF5LmlzQXJyYXkocHJldk5vZGUpKSB7XG4gICAgICAgICAgICAgICAgaW5kZW50ID0gMDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5iZWZvcmUoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGlmIChpbnNlcnRlZCkgc2V0KCdpbnNlcnRlZCcpO1xuICAgICAgICAgICAgICAgIGlmIChpbmRlbnQgJiYgY29tbWFGaXJzdCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoKHRoaXMucGF0aCB8fCBbXSkubGVuZ3RoID09PSAwXG4gICAgICAgICAgICAgICAgICAgIHx8IEFycmF5LmlzQXJyYXkodGhpcy5wYXJlbnQubm9kZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHdyaXRlKCdbICcpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGVsc2Ugd3JpdGUoJ1xcbicgKyBpbmRlbnR4ICsgJ1sgJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKGluZGVudCkge1xuICAgICAgICAgICAgICAgICAgICB3cml0ZSgnW1xcbicgKyBpbmRlbnR4KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHdyaXRlKCdbJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMucG9zdChmdW5jdGlvbiAoY2hpbGQpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWNoaWxkLmlzTGFzdCAmJiAhKGluZGVudCAmJiBjb21tYUZpcnN0KSkge1xuICAgICAgICAgICAgICAgICAgICB3cml0ZSgnLCcpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICB2YXIgcHJldiA9IHByZXZOb2RlICYmIHByZXZOb2RlW2NoaWxkLmtleV07XG4gICAgICAgICAgICAgICAgaWYgKGluZGVudCAmJiBvcHRzLmNvbW1lbnQgJiYgY2hpbGQubm9kZSAhPT0gcHJldlxuICAgICAgICAgICAgICAgICYmICh0eXBlb2YgY2hpbGQubm9kZSAhPT0gJ29iamVjdCcgfHwgdHlwZW9mIHByZXYgIT09ICdvYmplY3QnKVxuICAgICAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgICAgICBzZXQoJ2NvbW1lbnQnKTtcbiAgICAgICAgICAgICAgICAgICAgd3JpdGUoJyAvLyAhPSAnKTtcbiAgICAgICAgICAgICAgICAgICAgdHJhdmVyc2UocHJldikuZm9yRWFjaChmdW5jdGlvbiAoeCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGxhaW5TdHJpbmdpZnkuY2FsbCh0aGlzLCB4LCB7IGluZGVudCA6IDAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB1bnNldCgnY29tbWVudCcpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoIWNoaWxkLmlzTGFzdCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoaW5kZW50ICYmIGNvbW1hRmlyc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHdyaXRlKCdcXG4nICsgaW5kZW50eCArICcsICcpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKGluZGVudCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgd3JpdGUoJ1xcbicgKyBpbmRlbnR4KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmFmdGVyKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBpZiAoaW5kZW50ICYmIGNvbW1hRmlyc3QpIHdyaXRlKCdcXG4nICsgaW5kZW50eCk7XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoaW5kZW50KSB3cml0ZSgnXFxuJyArIGluZGVudHguc2xpY2UoaW5kZW50KSk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgd3JpdGUoJ10nKTtcbiAgICAgICAgICAgICAgICBpZiAodXBkYXRlZCkgdW5zZXQoJ3VwZGF0ZWQnKTtcbiAgICAgICAgICAgICAgICBpZiAoaW5zZXJ0ZWQpIHVuc2V0KCdpbnNlcnRlZCcpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoaXNSZWdFeHAobm9kZSkpIHtcbiAgICAgICAgICAgIHRoaXMuYmxvY2soKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGluc2VydGVkKSB7XG4gICAgICAgICAgICAgICAgc2V0KCdpbnNlcnRlZCcpO1xuICAgICAgICAgICAgICAgIHdyaXRlKG5vZGUudG9TdHJpbmcoKSk7XG4gICAgICAgICAgICAgICAgdW5zZXQoJ2luc2VydGVkJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChpbnNlcnRhYmxlICYmIHByZXZOb2RlICE9PSBub2RlKSB7XG4gICAgICAgICAgICAgICAgc2V0KCd1cGRhdGVkJyk7XG4gICAgICAgICAgICAgICAgd3JpdGUobm9kZS50b1N0cmluZygpKTtcbiAgICAgICAgICAgICAgICB1bnNldCgndXBkYXRlZCcpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB3cml0ZShub2RlLnRvU3RyaW5nKCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHR5cGVvZiBub2RlID09PSAnb2JqZWN0J1xuICAgICAgICAmJiBub2RlICYmIHR5cGVvZiBub2RlLmluc3BlY3QgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHRoaXMuYmxvY2soKTtcbiAgICAgICAgICAgIGlmIChpbnNlcnRlZCkge1xuICAgICAgICAgICAgICAgIHNldCgnaW5zZXJ0ZWQnKTtcbiAgICAgICAgICAgICAgICB3cml0ZShub2RlLmluc3BlY3QoKSk7XG4gICAgICAgICAgICAgICAgdW5zZXQoJ2luc2VydGVkJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmICghKHByZXZOb2RlICYmIHR5cGVvZiBwcmV2Tm9kZS5pbnNwZWN0ID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAmJiBwcmV2Tm9kZS5pbnNwZWN0KCkgPT09IG5vZGUuaW5zcGVjdCgpKSkge1xuICAgICAgICAgICAgICAgIHNldCgndXBkYXRlZCcpO1xuICAgICAgICAgICAgICAgIHdyaXRlKG5vZGUuaW5zcGVjdCgpKTtcbiAgICAgICAgICAgICAgICB1bnNldCgndXBkYXRlZCcpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB3cml0ZShub2RlLmluc3BlY3QoKSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAodHlwZW9mIG5vZGUgPT0gJ29iamVjdCcgJiYgbm9kZSAhPT0gbnVsbCkge1xuICAgICAgICAgICAgdmFyIGluc2VydGVkS2V5ID0gZmFsc2U7XG4gICAgICAgICAgICB2YXIgZGVsZXRlZCA9IGluc2VydGFibGUgJiYgdHlwZW9mIHByZXZOb2RlID09PSAnb2JqZWN0JyAmJiBwcmV2Tm9kZVxuICAgICAgICAgICAgICAgID8gT2JqZWN0LmtleXMocHJldk5vZGUpLmZpbHRlcihmdW5jdGlvbiAoa2V5KSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAhT2JqZWN0Lmhhc093blByb3BlcnR5LmNhbGwobm9kZSwga2V5KTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIDogW11cbiAgICAgICAgICAgIDtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5iZWZvcmUoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGlmIChpbnNlcnRlZCkgc2V0KCdpbnNlcnRlZCcpO1xuICAgICAgICAgICAgICAgIHdyaXRlKGluZGVudCAmJiBjb21tYUZpcnN0ICYmICF0aGlzLmlzUm9vdFxuICAgICAgICAgICAgICAgICAgICA/ICdcXG4nICsgaW5kZW50eCArICd7ICdcbiAgICAgICAgICAgICAgICAgICAgOiAneydcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMucHJlKGZ1bmN0aW9uICh4LCBrZXkpIHtcbiAgICAgICAgICAgICAgICBpZiAoaW5zZXJ0YWJsZSkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgb2JqID0gdHJhdmVyc2UuZ2V0KHByZXYsIHRoaXMucGF0aC5jb25jYXQoa2V5KSk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChvYmogPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5zZXJ0ZWRLZXkgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgc2V0KCdpbnNlcnRlZCcpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChpbmRlbnQgJiYgIWNvbW1hRmlyc3QpIHdyaXRlKCdcXG4nICsgaW5kZW50eCk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcGxhaW5TdHJpbmdpZnkoa2V5KTtcbiAgICAgICAgICAgICAgICB3cml0ZShpbmRlbnQgPyAnIDogJyA6ICc6Jyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5wb3N0KGZ1bmN0aW9uIChjaGlsZCkge1xuICAgICAgICAgICAgICAgIGlmICghY2hpbGQuaXNMYXN0ICYmICEoaW5kZW50ICYmIGNvbW1hRmlyc3QpKSB7XG4gICAgICAgICAgICAgICAgICAgIHdyaXRlKCcsJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChjaGlsZC5pc0xhc3QgJiYgZGVsZXRlZC5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGluc2VydGVkS2V5KSB1bnNldCgnaW5zZXJ0ZWQnKTtcbiAgICAgICAgICAgICAgICAgICAgaW5zZXJ0ZWRLZXkgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoaW5zZXJ0ZWRLZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgdW5zZXQoJ2luc2VydGVkJyk7XG4gICAgICAgICAgICAgICAgICAgIGluc2VydGVkS2V5ID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIHZhciBwcmV2ID0gcHJldk5vZGUgJiYgcHJldk5vZGVbY2hpbGQua2V5XTtcbiAgICAgICAgICAgICAgICBpZiAoaW5kZW50ICYmIG9wdHMuY29tbWVudCAmJiBjaGlsZC5ub2RlICE9PSBwcmV2XG4gICAgICAgICAgICAgICAgJiYgKHR5cGVvZiBjaGlsZC5ub2RlICE9PSAnb2JqZWN0JyB8fCB0eXBlb2YgcHJldiAhPT0gJ29iamVjdCcpXG4gICAgICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgICAgIHNldCgnY29tbWVudCcpO1xuICAgICAgICAgICAgICAgICAgICB3cml0ZSgnIC8vICE9ICcpO1xuICAgICAgICAgICAgICAgICAgICB0cmF2ZXJzZShwcmV2KS5mb3JFYWNoKGZ1bmN0aW9uICh4KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBwbGFpblN0cmluZ2lmeS5jYWxsKHRoaXMsIHgsIHsgaW5kZW50IDogMCB9KTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHVuc2V0KCdjb21tZW50Jyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChjaGlsZC5pc0xhc3QgJiYgZGVsZXRlZC5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGluc2VydGVkS2V5KSB1bnNldCgnaW5zZXJ0ZWQnKTtcbiAgICAgICAgICAgICAgICAgICAgaW5zZXJ0ZWRLZXkgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGlmIChpbmRlbnQgJiYgY29tbWFGaXJzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgd3JpdGUoJ1xcbicgKyBpbmRlbnR4ICsgJywgJylcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChvcHRzLmNvbW1lbnQgJiYgaW5kZW50KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB3cml0ZSgnXFxuJyArIGluZGVudHgpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKGluZGVudCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgd3JpdGUoJyxcXG4nICsgaW5kZW50eCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgZWxzZSB3cml0ZSgnLCcpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFjaGlsZC5pc0xhc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmRlbnQgJiYgY29tbWFGaXJzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdyaXRlKCdcXG4nICsgaW5kZW50eCArICcsICcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYWZ0ZXIoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGlmIChpbnNlcnRlZCkgdW5zZXQoJ2luc2VydGVkJyk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGRlbGV0ZWQubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChpbmRlbnQgJiYgIWNvbW1hRmlyc3RcbiAgICAgICAgICAgICAgICAgICAgJiYgT2JqZWN0LmtleXMobm9kZSkubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB3cml0ZSgnXFxuJyArIGluZGVudHgpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBzZXQoJ2RlbGV0ZWQnKTtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlZC5mb3JFYWNoKGZ1bmN0aW9uIChrZXksIGl4KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaW5kZW50ICYmIG9wdHMuY29tbWVudCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVuc2V0KCdkZWxldGVkJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0KCdjb21tZW50Jyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgd3JpdGUoJy8vICcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVuc2V0KCdjb21tZW50Jyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0KCdkZWxldGVkJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgIHBsYWluU3RyaW5naWZ5KGtleSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB3cml0ZShpbmRlbnQgPyAnIDogJyA6ICc6Jyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cmF2ZXJzZShwcmV2Tm9kZVtrZXldKS5mb3JFYWNoKGZ1bmN0aW9uICh4KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGxhaW5TdHJpbmdpZnkuY2FsbCh0aGlzLCB4LCB7IGluZGVudCA6IDAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGxhc3QgPSBpeCA9PT0gZGVsZXRlZC5sZW5ndGggLSAxO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluc2VydGFibGUgJiYgIWxhc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaW5kZW50ICYmIGNvbW1hRmlyc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgd3JpdGUoJ1xcbicgKyBpbmRlbnR4ICsgJywgJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKGluZGVudCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB3cml0ZSgnLFxcbicgKyBpbmRlbnR4KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSB3cml0ZSgnLCcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgdW5zZXQoJ2RlbGV0ZWQnKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGNvbW1hRmlyc3QgJiYgaW5kZW50KSB7XG4gICAgICAgICAgICAgICAgICAgIHdyaXRlKGluZGVudHguc2xpY2UoaW5kZW50KSArICcgfScpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIGlmIChpbmRlbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgd3JpdGUoJ1xcbicgKyBpbmRlbnR4LnNsaWNlKGluZGVudCkgKyAnfScpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHdyaXRlKCd9Jyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHZhciBjaGFuZ2VkID0gZmFsc2U7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChpbnNlcnRlZCkgc2V0KCdpbnNlcnRlZCcpO1xuICAgICAgICAgICAgZWxzZSBpZiAoaW5zZXJ0YWJsZSAmJiAhZGVlcEVxdWFsKHByZXZOb2RlLCBub2RlKSkge1xuICAgICAgICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHNldCgndXBkYXRlZCcpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodHlwZW9mIG5vZGUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgd3JpdGUoJ1wiJyArIG5vZGUudG9TdHJpbmcoKS5yZXBsYWNlKC9cIi9nLCAnXFxcXFwiJykgKyAnXCInKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGlzUmVnRXhwKG5vZGUpKSB7XG4gICAgICAgICAgICAgICAgd3JpdGUobm9kZS50b1N0cmluZygpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKHR5cGVvZiBub2RlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAgICAgd3JpdGUobm9kZS5uYW1lXG4gICAgICAgICAgICAgICAgICAgID8gJ1tGdW5jdGlvbjogJyArIG5vZGUubmFtZSArICddJ1xuICAgICAgICAgICAgICAgICAgICA6ICdbRnVuY3Rpb25dJ1xuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChub2RlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICB3cml0ZSgndW5kZWZpbmVkJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChub2RlID09PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgd3JpdGUoJ251bGwnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIHdyaXRlKG5vZGUudG9TdHJpbmcoKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChpbnNlcnRlZCkgdW5zZXQoJ2luc2VydGVkJyk7XG4gICAgICAgICAgICBlbHNlIGlmIChjaGFuZ2VkKSB1bnNldCgndXBkYXRlZCcpO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIGlmIChvcHRzLnN0cmVhbSkge1xuICAgICAgICB0cmF2ZXJzZShuZXh0KS5mb3JFYWNoKHN0cmluZ2lmeSk7XG4gICAgfVxuICAgIGVsc2UgcHJvY2Vzcy5uZXh0VGljayhmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRyYXZlcnNlKG5leHQpLmZvckVhY2goc3RyaW5naWZ5KTtcbiAgICAgICAgc3RyZWFtLmVtaXQoJ2VuZCcpO1xuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBzdHJlYW07XG59XG5cbmZ1bmN0aW9uIGlzUmVnRXhwIChub2RlKSB7XG4gICAgcmV0dXJuIG5vZGUgaW5zdGFuY2VvZiBSZWdFeHAgfHwgKG5vZGVcbiAgICAgICAgJiYgdHlwZW9mIG5vZGUudGVzdCA9PT0gJ2Z1bmN0aW9uJyBcbiAgICAgICAgJiYgdHlwZW9mIG5vZGUuZXhlYyA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAmJiB0eXBlb2Ygbm9kZS5jb21waWxlID09PSAnZnVuY3Rpb24nXG4gICAgICAgICYmIG5vZGUuY29uc3RydWN0b3IgJiYgbm9kZS5jb25zdHJ1Y3Rvci5uYW1lID09PSAnUmVnRXhwJ1xuICAgICk7XG59XG5cbn0pKHJlcXVpcmUoXCJfX2Jyb3dzZXJpZnlfcHJvY2Vzc1wiKSkiLCJ2YXIgdHJhdmVyc2UgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvYmopIHtcbiAgICByZXR1cm4gbmV3IFRyYXZlcnNlKG9iaik7XG59O1xuXG5mdW5jdGlvbiBUcmF2ZXJzZSAob2JqKSB7XG4gICAgdGhpcy52YWx1ZSA9IG9iajtcbn1cblxuVHJhdmVyc2UucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIChwcykge1xuICAgIHZhciBub2RlID0gdGhpcy52YWx1ZTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBzLmxlbmd0aDsgaSArKykge1xuICAgICAgICB2YXIga2V5ID0gcHNbaV07XG4gICAgICAgIGlmICghT2JqZWN0Lmhhc093blByb3BlcnR5LmNhbGwobm9kZSwga2V5KSkge1xuICAgICAgICAgICAgbm9kZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIG5vZGUgPSBub2RlW2tleV07XG4gICAgfVxuICAgIHJldHVybiBub2RlO1xufTtcblxuVHJhdmVyc2UucHJvdG90eXBlLmhhcyA9IGZ1bmN0aW9uIChwcykge1xuICAgIHZhciBub2RlID0gdGhpcy52YWx1ZTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBzLmxlbmd0aDsgaSArKykge1xuICAgICAgICB2YXIga2V5ID0gcHNbaV07XG4gICAgICAgIGlmICghT2JqZWN0Lmhhc093blByb3BlcnR5LmNhbGwobm9kZSwga2V5KSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIG5vZGUgPSBub2RlW2tleV07XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xufTtcblxuVHJhdmVyc2UucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uIChwcywgdmFsdWUpIHtcbiAgICB2YXIgbm9kZSA9IHRoaXMudmFsdWU7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwcy5sZW5ndGggLSAxOyBpICsrKSB7XG4gICAgICAgIHZhciBrZXkgPSBwc1tpXTtcbiAgICAgICAgaWYgKCFPYmplY3QuaGFzT3duUHJvcGVydHkuY2FsbChub2RlLCBrZXkpKSBub2RlW2tleV0gPSB7fTtcbiAgICAgICAgbm9kZSA9IG5vZGVba2V5XTtcbiAgICB9XG4gICAgbm9kZVtwc1tpXV0gPSB2YWx1ZTtcbiAgICByZXR1cm4gdmFsdWU7XG59O1xuXG5UcmF2ZXJzZS5wcm90b3R5cGUubWFwID0gZnVuY3Rpb24gKGNiKSB7XG4gICAgcmV0dXJuIHdhbGsodGhpcy52YWx1ZSwgY2IsIHRydWUpO1xufTtcblxuVHJhdmVyc2UucHJvdG90eXBlLmZvckVhY2ggPSBmdW5jdGlvbiAoY2IpIHtcbiAgICB0aGlzLnZhbHVlID0gd2Fsayh0aGlzLnZhbHVlLCBjYiwgZmFsc2UpO1xuICAgIHJldHVybiB0aGlzLnZhbHVlO1xufTtcblxuVHJhdmVyc2UucHJvdG90eXBlLnJlZHVjZSA9IGZ1bmN0aW9uIChjYiwgaW5pdCkge1xuICAgIHZhciBza2lwID0gYXJndW1lbnRzLmxlbmd0aCA9PT0gMTtcbiAgICB2YXIgYWNjID0gc2tpcCA/IHRoaXMudmFsdWUgOiBpbml0O1xuICAgIHRoaXMuZm9yRWFjaChmdW5jdGlvbiAoeCkge1xuICAgICAgICBpZiAoIXRoaXMuaXNSb290IHx8ICFza2lwKSB7XG4gICAgICAgICAgICBhY2MgPSBjYi5jYWxsKHRoaXMsIGFjYywgeCk7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gYWNjO1xufTtcblxuVHJhdmVyc2UucHJvdG90eXBlLnBhdGhzID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBhY2MgPSBbXTtcbiAgICB0aGlzLmZvckVhY2goZnVuY3Rpb24gKHgpIHtcbiAgICAgICAgYWNjLnB1c2godGhpcy5wYXRoKTsgXG4gICAgfSk7XG4gICAgcmV0dXJuIGFjYztcbn07XG5cblRyYXZlcnNlLnByb3RvdHlwZS5ub2RlcyA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgYWNjID0gW107XG4gICAgdGhpcy5mb3JFYWNoKGZ1bmN0aW9uICh4KSB7XG4gICAgICAgIGFjYy5wdXNoKHRoaXMubm9kZSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIGFjYztcbn07XG5cblRyYXZlcnNlLnByb3RvdHlwZS5jbG9uZSA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgcGFyZW50cyA9IFtdLCBub2RlcyA9IFtdO1xuICAgIFxuICAgIHJldHVybiAoZnVuY3Rpb24gY2xvbmUgKHNyYykge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcmVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChwYXJlbnRzW2ldID09PSBzcmMpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbm9kZXNbaV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGlmICh0eXBlb2Ygc3JjID09PSAnb2JqZWN0JyAmJiBzcmMgIT09IG51bGwpIHtcbiAgICAgICAgICAgIHZhciBkc3QgPSBjb3B5KHNyYyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHBhcmVudHMucHVzaChzcmMpO1xuICAgICAgICAgICAgbm9kZXMucHVzaChkc3QpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBmb3JFYWNoKG9iamVjdEtleXMoc3JjKSwgZnVuY3Rpb24gKGtleSkge1xuICAgICAgICAgICAgICAgIGRzdFtrZXldID0gY2xvbmUoc3JjW2tleV0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHBhcmVudHMucG9wKCk7XG4gICAgICAgICAgICBub2Rlcy5wb3AoKTtcbiAgICAgICAgICAgIHJldHVybiBkc3Q7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gc3JjO1xuICAgICAgICB9XG4gICAgfSkodGhpcy52YWx1ZSk7XG59O1xuXG5mdW5jdGlvbiB3YWxrIChyb290LCBjYiwgaW1tdXRhYmxlKSB7XG4gICAgdmFyIHBhdGggPSBbXTtcbiAgICB2YXIgcGFyZW50cyA9IFtdO1xuICAgIHZhciBhbGl2ZSA9IHRydWU7XG4gICAgXG4gICAgcmV0dXJuIChmdW5jdGlvbiB3YWxrZXIgKG5vZGVfKSB7XG4gICAgICAgIHZhciBub2RlID0gaW1tdXRhYmxlID8gY29weShub2RlXykgOiBub2RlXztcbiAgICAgICAgdmFyIG1vZGlmaWVycyA9IHt9O1xuICAgICAgICBcbiAgICAgICAgdmFyIGtlZXBHb2luZyA9IHRydWU7XG4gICAgICAgIFxuICAgICAgICB2YXIgc3RhdGUgPSB7XG4gICAgICAgICAgICBub2RlIDogbm9kZSxcbiAgICAgICAgICAgIG5vZGVfIDogbm9kZV8sXG4gICAgICAgICAgICBwYXRoIDogW10uY29uY2F0KHBhdGgpLFxuICAgICAgICAgICAgcGFyZW50IDogcGFyZW50c1twYXJlbnRzLmxlbmd0aCAtIDFdLFxuICAgICAgICAgICAgcGFyZW50cyA6IHBhcmVudHMsXG4gICAgICAgICAgICBrZXkgOiBwYXRoLnNsaWNlKC0xKVswXSxcbiAgICAgICAgICAgIGlzUm9vdCA6IHBhdGgubGVuZ3RoID09PSAwLFxuICAgICAgICAgICAgbGV2ZWwgOiBwYXRoLmxlbmd0aCxcbiAgICAgICAgICAgIGNpcmN1bGFyIDogbnVsbCxcbiAgICAgICAgICAgIHVwZGF0ZSA6IGZ1bmN0aW9uICh4LCBzdG9wSGVyZSkge1xuICAgICAgICAgICAgICAgIGlmICghc3RhdGUuaXNSb290KSB7XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLnBhcmVudC5ub2RlW3N0YXRlLmtleV0gPSB4O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzdGF0ZS5ub2RlID0geDtcbiAgICAgICAgICAgICAgICBpZiAoc3RvcEhlcmUpIGtlZXBHb2luZyA9IGZhbHNlO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICdkZWxldGUnIDogZnVuY3Rpb24gKHN0b3BIZXJlKSB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHN0YXRlLnBhcmVudC5ub2RlW3N0YXRlLmtleV07XG4gICAgICAgICAgICAgICAgaWYgKHN0b3BIZXJlKSBrZWVwR29pbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZW1vdmUgOiBmdW5jdGlvbiAoc3RvcEhlcmUpIHtcbiAgICAgICAgICAgICAgICBpZiAoaXNBcnJheShzdGF0ZS5wYXJlbnQubm9kZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUucGFyZW50Lm5vZGUuc3BsaWNlKHN0YXRlLmtleSwgMSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgc3RhdGUucGFyZW50Lm5vZGVbc3RhdGUua2V5XTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHN0b3BIZXJlKSBrZWVwR29pbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBrZXlzIDogbnVsbCxcbiAgICAgICAgICAgIGJlZm9yZSA6IGZ1bmN0aW9uIChmKSB7IG1vZGlmaWVycy5iZWZvcmUgPSBmIH0sXG4gICAgICAgICAgICBhZnRlciA6IGZ1bmN0aW9uIChmKSB7IG1vZGlmaWVycy5hZnRlciA9IGYgfSxcbiAgICAgICAgICAgIHByZSA6IGZ1bmN0aW9uIChmKSB7IG1vZGlmaWVycy5wcmUgPSBmIH0sXG4gICAgICAgICAgICBwb3N0IDogZnVuY3Rpb24gKGYpIHsgbW9kaWZpZXJzLnBvc3QgPSBmIH0sXG4gICAgICAgICAgICBzdG9wIDogZnVuY3Rpb24gKCkgeyBhbGl2ZSA9IGZhbHNlIH0sXG4gICAgICAgICAgICBibG9jayA6IGZ1bmN0aW9uICgpIHsga2VlcEdvaW5nID0gZmFsc2UgfVxuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgaWYgKCFhbGl2ZSkgcmV0dXJuIHN0YXRlO1xuICAgICAgICBcbiAgICAgICAgZnVuY3Rpb24gdXBkYXRlU3RhdGUoKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHN0YXRlLm5vZGUgPT09ICdvYmplY3QnICYmIHN0YXRlLm5vZGUgIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXN0YXRlLmtleXMgfHwgc3RhdGUubm9kZV8gIT09IHN0YXRlLm5vZGUpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUua2V5cyA9IG9iamVjdEtleXMoc3RhdGUubm9kZSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgc3RhdGUuaXNMZWFmID0gc3RhdGUua2V5cy5sZW5ndGggPT0gMDtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcmVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBhcmVudHNbaV0ubm9kZV8gPT09IG5vZGVfKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZS5jaXJjdWxhciA9IHBhcmVudHNbaV07XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIHN0YXRlLmlzTGVhZiA9IHRydWU7XG4gICAgICAgICAgICAgICAgc3RhdGUua2V5cyA9IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHN0YXRlLm5vdExlYWYgPSAhc3RhdGUuaXNMZWFmO1xuICAgICAgICAgICAgc3RhdGUubm90Um9vdCA9ICFzdGF0ZS5pc1Jvb3Q7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHVwZGF0ZVN0YXRlKCk7XG4gICAgICAgIFxuICAgICAgICAvLyB1c2UgcmV0dXJuIHZhbHVlcyB0byB1cGRhdGUgaWYgZGVmaW5lZFxuICAgICAgICB2YXIgcmV0ID0gY2IuY2FsbChzdGF0ZSwgc3RhdGUubm9kZSk7XG4gICAgICAgIGlmIChyZXQgIT09IHVuZGVmaW5lZCAmJiBzdGF0ZS51cGRhdGUpIHN0YXRlLnVwZGF0ZShyZXQpO1xuICAgICAgICBcbiAgICAgICAgaWYgKG1vZGlmaWVycy5iZWZvcmUpIG1vZGlmaWVycy5iZWZvcmUuY2FsbChzdGF0ZSwgc3RhdGUubm9kZSk7XG4gICAgICAgIFxuICAgICAgICBpZiAoIWtlZXBHb2luZykgcmV0dXJuIHN0YXRlO1xuICAgICAgICBcbiAgICAgICAgaWYgKHR5cGVvZiBzdGF0ZS5ub2RlID09ICdvYmplY3QnXG4gICAgICAgICYmIHN0YXRlLm5vZGUgIT09IG51bGwgJiYgIXN0YXRlLmNpcmN1bGFyKSB7XG4gICAgICAgICAgICBwYXJlbnRzLnB1c2goc3RhdGUpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB1cGRhdGVTdGF0ZSgpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBmb3JFYWNoKHN0YXRlLmtleXMsIGZ1bmN0aW9uIChrZXksIGkpIHtcbiAgICAgICAgICAgICAgICBwYXRoLnB1c2goa2V5KTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAobW9kaWZpZXJzLnByZSkgbW9kaWZpZXJzLnByZS5jYWxsKHN0YXRlLCBzdGF0ZS5ub2RlW2tleV0sIGtleSk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdmFyIGNoaWxkID0gd2Fsa2VyKHN0YXRlLm5vZGVba2V5XSk7XG4gICAgICAgICAgICAgICAgaWYgKGltbXV0YWJsZSAmJiBPYmplY3QuaGFzT3duUHJvcGVydHkuY2FsbChzdGF0ZS5ub2RlLCBrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLm5vZGVba2V5XSA9IGNoaWxkLm5vZGU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGNoaWxkLmlzTGFzdCA9IGkgPT0gc3RhdGUua2V5cy5sZW5ndGggLSAxO1xuICAgICAgICAgICAgICAgIGNoaWxkLmlzRmlyc3QgPSBpID09IDA7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKG1vZGlmaWVycy5wb3N0KSBtb2RpZmllcnMucG9zdC5jYWxsKHN0YXRlLCBjaGlsZCk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgcGF0aC5wb3AoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcGFyZW50cy5wb3AoKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKG1vZGlmaWVycy5hZnRlcikgbW9kaWZpZXJzLmFmdGVyLmNhbGwoc3RhdGUsIHN0YXRlLm5vZGUpO1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHN0YXRlO1xuICAgIH0pKHJvb3QpLm5vZGU7XG59XG5cbmZ1bmN0aW9uIGNvcHkgKHNyYykge1xuICAgIGlmICh0eXBlb2Ygc3JjID09PSAnb2JqZWN0JyAmJiBzcmMgIT09IG51bGwpIHtcbiAgICAgICAgdmFyIGRzdDtcbiAgICAgICAgXG4gICAgICAgIGlmIChpc0FycmF5KHNyYykpIHtcbiAgICAgICAgICAgIGRzdCA9IFtdO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGlzRGF0ZShzcmMpKSB7XG4gICAgICAgICAgICBkc3QgPSBuZXcgRGF0ZShzcmMpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGlzUmVnRXhwKHNyYykpIHtcbiAgICAgICAgICAgIGRzdCA9IG5ldyBSZWdFeHAoc3JjKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChpc0Vycm9yKHNyYykpIHtcbiAgICAgICAgICAgIGRzdCA9IHsgbWVzc2FnZTogc3JjLm1lc3NhZ2UgfTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChpc0Jvb2xlYW4oc3JjKSkge1xuICAgICAgICAgICAgZHN0ID0gbmV3IEJvb2xlYW4oc3JjKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChpc051bWJlcihzcmMpKSB7XG4gICAgICAgICAgICBkc3QgPSBuZXcgTnVtYmVyKHNyYyk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoaXNTdHJpbmcoc3JjKSkge1xuICAgICAgICAgICAgZHN0ID0gbmV3IFN0cmluZyhzcmMpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKE9iamVjdC5jcmVhdGUgJiYgT2JqZWN0LmdldFByb3RvdHlwZU9mKSB7XG4gICAgICAgICAgICBkc3QgPSBPYmplY3QuY3JlYXRlKE9iamVjdC5nZXRQcm90b3R5cGVPZihzcmMpKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChzcmMuY29uc3RydWN0b3IgPT09IE9iamVjdCkge1xuICAgICAgICAgICAgZHN0ID0ge307XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB2YXIgcHJvdG8gPVxuICAgICAgICAgICAgICAgIChzcmMuY29uc3RydWN0b3IgJiYgc3JjLmNvbnN0cnVjdG9yLnByb3RvdHlwZSlcbiAgICAgICAgICAgICAgICB8fCBzcmMuX19wcm90b19fXG4gICAgICAgICAgICAgICAgfHwge31cbiAgICAgICAgICAgIDtcbiAgICAgICAgICAgIHZhciBUID0gZnVuY3Rpb24gKCkge307XG4gICAgICAgICAgICBULnByb3RvdHlwZSA9IHByb3RvO1xuICAgICAgICAgICAgZHN0ID0gbmV3IFQ7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGZvckVhY2gob2JqZWN0S2V5cyhzcmMpLCBmdW5jdGlvbiAoa2V5KSB7XG4gICAgICAgICAgICBkc3Rba2V5XSA9IHNyY1trZXldO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIGRzdDtcbiAgICB9XG4gICAgZWxzZSByZXR1cm4gc3JjO1xufVxuXG52YXIgb2JqZWN0S2V5cyA9IE9iamVjdC5rZXlzIHx8IGZ1bmN0aW9uIGtleXMgKG9iaikge1xuICAgIHZhciByZXMgPSBbXTtcbiAgICBmb3IgKHZhciBrZXkgaW4gb2JqKSByZXMucHVzaChrZXkpXG4gICAgcmV0dXJuIHJlcztcbn07XG5cbmZ1bmN0aW9uIHRvUyAob2JqKSB7IHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwob2JqKSB9XG5mdW5jdGlvbiBpc0RhdGUgKG9iaikgeyByZXR1cm4gdG9TKG9iaikgPT09ICdbb2JqZWN0IERhdGVdJyB9XG5mdW5jdGlvbiBpc1JlZ0V4cCAob2JqKSB7IHJldHVybiB0b1Mob2JqKSA9PT0gJ1tvYmplY3QgUmVnRXhwXScgfVxuZnVuY3Rpb24gaXNFcnJvciAob2JqKSB7IHJldHVybiB0b1Mob2JqKSA9PT0gJ1tvYmplY3QgRXJyb3JdJyB9XG5mdW5jdGlvbiBpc0Jvb2xlYW4gKG9iaikgeyByZXR1cm4gdG9TKG9iaikgPT09ICdbb2JqZWN0IEJvb2xlYW5dJyB9XG5mdW5jdGlvbiBpc051bWJlciAob2JqKSB7IHJldHVybiB0b1Mob2JqKSA9PT0gJ1tvYmplY3QgTnVtYmVyXScgfVxuZnVuY3Rpb24gaXNTdHJpbmcgKG9iaikgeyByZXR1cm4gdG9TKG9iaikgPT09ICdbb2JqZWN0IFN0cmluZ10nIH1cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5IHx8IGZ1bmN0aW9uIGlzQXJyYXkgKHhzKSB7XG4gICAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh4cykgPT09ICdbb2JqZWN0IEFycmF5XSc7XG59O1xuXG52YXIgZm9yRWFjaCA9IGZ1bmN0aW9uICh4cywgZm4pIHtcbiAgICBpZiAoeHMuZm9yRWFjaCkgcmV0dXJuIHhzLmZvckVhY2goZm4pXG4gICAgZWxzZSBmb3IgKHZhciBpID0gMDsgaSA8IHhzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGZuKHhzW2ldLCBpLCB4cyk7XG4gICAgfVxufTtcblxuZm9yRWFjaChvYmplY3RLZXlzKFRyYXZlcnNlLnByb3RvdHlwZSksIGZ1bmN0aW9uIChrZXkpIHtcbiAgICB0cmF2ZXJzZVtrZXldID0gZnVuY3Rpb24gKG9iaikge1xuICAgICAgICB2YXIgYXJncyA9IFtdLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICAgICAgdmFyIHQgPSBuZXcgVHJhdmVyc2Uob2JqKTtcbiAgICAgICAgcmV0dXJuIHRba2V5XS5hcHBseSh0LCBhcmdzKTtcbiAgICB9O1xufSk7XG4iLCJ2YXIgcFNsaWNlID0gQXJyYXkucHJvdG90eXBlLnNsaWNlO1xudmFyIE9iamVjdF9rZXlzID0gdHlwZW9mIE9iamVjdC5rZXlzID09PSAnZnVuY3Rpb24nXG4gICAgPyBPYmplY3Qua2V5c1xuICAgIDogZnVuY3Rpb24gKG9iaikge1xuICAgICAgICB2YXIga2V5cyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBrZXkgaW4gb2JqKSBrZXlzLnB1c2goa2V5KTtcbiAgICAgICAgcmV0dXJuIGtleXM7XG4gICAgfVxuO1xuXG52YXIgZGVlcEVxdWFsID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoYWN0dWFsLCBleHBlY3RlZCkge1xuICAvLyA3LjEuIEFsbCBpZGVudGljYWwgdmFsdWVzIGFyZSBlcXVpdmFsZW50LCBhcyBkZXRlcm1pbmVkIGJ5ID09PS5cbiAgaWYgKGFjdHVhbCA9PT0gZXhwZWN0ZWQpIHtcbiAgICByZXR1cm4gdHJ1ZTtcblxuICB9IGVsc2UgaWYgKGFjdHVhbCBpbnN0YW5jZW9mIERhdGUgJiYgZXhwZWN0ZWQgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgcmV0dXJuIGFjdHVhbC5nZXRUaW1lKCkgPT09IGV4cGVjdGVkLmdldFRpbWUoKTtcblxuICAvLyA3LjMuIE90aGVyIHBhaXJzIHRoYXQgZG8gbm90IGJvdGggcGFzcyB0eXBlb2YgdmFsdWUgPT0gJ29iamVjdCcsXG4gIC8vIGVxdWl2YWxlbmNlIGlzIGRldGVybWluZWQgYnkgPT0uXG4gIH0gZWxzZSBpZiAodHlwZW9mIGFjdHVhbCAhPSAnb2JqZWN0JyAmJiB0eXBlb2YgZXhwZWN0ZWQgIT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gYWN0dWFsID09IGV4cGVjdGVkO1xuXG4gIC8vIDcuNC4gRm9yIGFsbCBvdGhlciBPYmplY3QgcGFpcnMsIGluY2x1ZGluZyBBcnJheSBvYmplY3RzLCBlcXVpdmFsZW5jZSBpc1xuICAvLyBkZXRlcm1pbmVkIGJ5IGhhdmluZyB0aGUgc2FtZSBudW1iZXIgb2Ygb3duZWQgcHJvcGVydGllcyAoYXMgdmVyaWZpZWRcbiAgLy8gd2l0aCBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwpLCB0aGUgc2FtZSBzZXQgb2Yga2V5c1xuICAvLyAoYWx0aG91Z2ggbm90IG5lY2Vzc2FyaWx5IHRoZSBzYW1lIG9yZGVyKSwgZXF1aXZhbGVudCB2YWx1ZXMgZm9yIGV2ZXJ5XG4gIC8vIGNvcnJlc3BvbmRpbmcga2V5LCBhbmQgYW4gaWRlbnRpY2FsICdwcm90b3R5cGUnIHByb3BlcnR5LiBOb3RlOiB0aGlzXG4gIC8vIGFjY291bnRzIGZvciBib3RoIG5hbWVkIGFuZCBpbmRleGVkIHByb3BlcnRpZXMgb24gQXJyYXlzLlxuICB9IGVsc2Uge1xuICAgIHJldHVybiBvYmpFcXVpdihhY3R1YWwsIGV4cGVjdGVkKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpc1VuZGVmaW5lZE9yTnVsbCh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gaXNBcmd1bWVudHMob2JqZWN0KSB7XG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwob2JqZWN0KSA9PSAnW29iamVjdCBBcmd1bWVudHNdJztcbn1cblxuZnVuY3Rpb24gb2JqRXF1aXYoYSwgYikge1xuICBpZiAoaXNVbmRlZmluZWRPck51bGwoYSkgfHwgaXNVbmRlZmluZWRPck51bGwoYikpXG4gICAgcmV0dXJuIGZhbHNlO1xuICAvLyBhbiBpZGVudGljYWwgJ3Byb3RvdHlwZScgcHJvcGVydHkuXG4gIGlmIChhLnByb3RvdHlwZSAhPT0gYi5wcm90b3R5cGUpIHJldHVybiBmYWxzZTtcbiAgLy9+fn5JJ3ZlIG1hbmFnZWQgdG8gYnJlYWsgT2JqZWN0LmtleXMgdGhyb3VnaCBzY3Jld3kgYXJndW1lbnRzIHBhc3NpbmcuXG4gIC8vICAgQ29udmVydGluZyB0byBhcnJheSBzb2x2ZXMgdGhlIHByb2JsZW0uXG4gIGlmIChpc0FyZ3VtZW50cyhhKSkge1xuICAgIGlmICghaXNBcmd1bWVudHMoYikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgYSA9IHBTbGljZS5jYWxsKGEpO1xuICAgIGIgPSBwU2xpY2UuY2FsbChiKTtcbiAgICByZXR1cm4gZGVlcEVxdWFsKGEsIGIpO1xuICB9XG4gIHRyeSB7XG4gICAgdmFyIGthID0gT2JqZWN0X2tleXMoYSksXG4gICAgICAgIGtiID0gT2JqZWN0X2tleXMoYiksXG4gICAgICAgIGtleSwgaTtcbiAgfSBjYXRjaCAoZSkgey8vaGFwcGVucyB3aGVuIG9uZSBpcyBhIHN0cmluZyBsaXRlcmFsIGFuZCB0aGUgb3RoZXIgaXNuJ3RcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgLy8gaGF2aW5nIHRoZSBzYW1lIG51bWJlciBvZiBvd25lZCBwcm9wZXJ0aWVzIChrZXlzIGluY29ycG9yYXRlc1xuICAvLyBoYXNPd25Qcm9wZXJ0eSlcbiAgaWYgKGthLmxlbmd0aCAhPSBrYi5sZW5ndGgpXG4gICAgcmV0dXJuIGZhbHNlO1xuICAvL3RoZSBzYW1lIHNldCBvZiBrZXlzIChhbHRob3VnaCBub3QgbmVjZXNzYXJpbHkgdGhlIHNhbWUgb3JkZXIpLFxuICBrYS5zb3J0KCk7XG4gIGtiLnNvcnQoKTtcbiAgLy9+fn5jaGVhcCBrZXkgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGlmIChrYVtpXSAhPSBrYltpXSlcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICAvL2VxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeSBjb3JyZXNwb25kaW5nIGtleSwgYW5kXG4gIC8vfn5+cG9zc2libHkgZXhwZW5zaXZlIGRlZXAgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGtleSA9IGthW2ldO1xuICAgIGlmICghZGVlcEVxdWFsKGFba2V5XSwgYltrZXldKSkgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuIiwiZXhwb3J0cy5pc2F0dHkgPSBmdW5jdGlvbiAoKSB7fTtcbmV4cG9ydHMuc2V0UmF3TW9kZSA9IGZ1bmN0aW9uICgpIHt9O1xuIiwiKGZ1bmN0aW9uKHByb2Nlc3Mpe3ZhciB0dHkgPSByZXF1aXJlKCd0dHknKTtcbnZhciBlbmNvZGUgPSByZXF1aXJlKCcuL2xpYi9lbmNvZGUnKTtcbnZhciBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXI7XG5cbnZhciBleHBvcnRzID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGlucHV0ID0gbnVsbDtcbiAgICBmdW5jdGlvbiBzZXRJbnB1dCAocykge1xuICAgICAgICBpZiAoaW5wdXQpIHRocm93IG5ldyBFcnJvcignbXVsdGlwbGUgaW5wdXRzIHNwZWNpZmllZCcpXG4gICAgICAgIGVsc2UgaW5wdXQgPSBzXG4gICAgfVxuICAgIFxuICAgIHZhciBvdXRwdXQgPSBudWxsO1xuICAgIGZ1bmN0aW9uIHNldE91dHB1dCAocykge1xuICAgICAgICBpZiAob3V0cHV0KSB0aHJvdyBuZXcgRXJyb3IoJ211bHRpcGxlIG91dHB1dHMgc3BlY2lmaWVkJylcbiAgICAgICAgZWxzZSBvdXRwdXQgPSBzXG4gICAgfVxuICAgIFxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciBhcmcgPSBhcmd1bWVudHNbaV07XG4gICAgICAgIGlmICghYXJnKSBjb250aW51ZTtcbiAgICAgICAgaWYgKGFyZy5yZWFkYWJsZSkgc2V0SW5wdXQoYXJnKVxuICAgICAgICBlbHNlIGlmIChhcmcuc3RkaW4gfHwgYXJnLmlucHV0KSBzZXRJbnB1dChhcmcuc3RkaW4gfHwgYXJnLmlucHV0KVxuICAgICAgICBcbiAgICAgICAgaWYgKGFyZy53cml0YWJsZSkgc2V0T3V0cHV0KGFyZylcbiAgICAgICAgZWxzZSBpZiAoYXJnLnN0ZG91dCB8fCBhcmcub3V0cHV0KSBzZXRPdXRwdXQoYXJnLnN0ZG91dCB8fCBhcmcub3V0cHV0KVxuICAgICAgICBcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIG5ldyBDaGFybShpbnB1dCwgb3V0cHV0KTtcbn07XG5cbnZhciBDaGFybSA9IGV4cG9ydHMuQ2hhcm0gPSBmdW5jdGlvbiAoaW5wdXQsIG91dHB1dCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLmlucHV0ID0gaW5wdXQ7XG4gICAgc2VsZi5vdXRwdXQgPSBvdXRwdXQ7XG4gICAgc2VsZi5wZW5kaW5nID0gW107XG4gICAgXG4gICAgaWYgKCFvdXRwdXQpIHtcbiAgICAgICAgc2VsZi5lbWl0KCdlcnJvcicsIG5ldyBFcnJvcignb3V0cHV0IHN0cmVhbSByZXF1aXJlZCcpKTtcbiAgICB9XG4gICAgXG4gICAgaWYgKGlucHV0ICYmIHR5cGVvZiBpbnB1dC5mZCA9PT0gJ251bWJlcicgJiYgdHR5LmlzYXR0eShpbnB1dC5mZCkpIHtcbiAgICAgICAgaWYgKHByb2Nlc3Muc3RkaW4uc2V0UmF3TW9kZSkge1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRpbi5zZXRSYXdNb2RlKHRydWUpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgdHR5LnNldFJhd01vZGUodHJ1ZSk7XG4gICAgICAgIGlucHV0LnJlc3VtZSgpO1xuICAgIH1cbiAgICBcbiAgICBpZiAoaW5wdXQpIHtcbiAgICAgICAgaW5wdXQub24oJ2RhdGEnLCBmdW5jdGlvbiAoYnVmKSB7XG4gICAgICAgICAgICBpZiAoc2VsZi5wZW5kaW5nLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIHZhciBjb2RlcyA9IGV4dHJhY3RDb2RlcyhidWYpO1xuICAgICAgICAgICAgICAgIHZhciBtYXRjaGVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjb2Rlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IHNlbGYucGVuZGluZy5sZW5ndGg7IGorKykge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGNiID0gc2VsZi5wZW5kaW5nW2pdO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNiKGNvZGVzW2ldKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hdGNoZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlbGYucGVuZGluZy5zcGxpY2UoaiwgMSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKG1hdGNoZWQpIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgc2VsZi5lbWl0KCdkYXRhJywgYnVmKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoYnVmLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgICAgICAgIGlmIChidWZbMF0gPT09IDMpIHNlbGYuZW1pdCgnXkMnKTtcbiAgICAgICAgICAgICAgICBpZiAoYnVmWzBdID09PSA0KSBzZWxmLmVtaXQoJ15EJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cbn1cblxuQ2hhcm0ucHJvdG90eXBlID0gbmV3IEV2ZW50RW1pdHRlcjtcblxuQ2hhcm0ucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbiAoKSB7XG4gICAgaWYgKHRoaXMuaW5wdXQpIHRoaXMuaW5wdXQuZGVzdHJveSgpXG59O1xuXG5DaGFybS5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiAobXNnKSB7XG4gICAgdGhpcy5vdXRwdXQud3JpdGUobXNnKTtcbiAgICByZXR1cm4gdGhpcztcbn07XG5cbkNoYXJtLnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uIChjYikge1xuICAgIHRoaXMud3JpdGUoZW5jb2RlKCdjJykpO1xuICAgIHJldHVybiB0aGlzO1xufTtcblxuQ2hhcm0ucHJvdG90eXBlLnBvc2l0aW9uID0gZnVuY3Rpb24gKHgsIHkpIHtcbiAgICAvLyBnZXQvc2V0IGFic29sdXRlIGNvb3JkaW5hdGVzXG4gICAgaWYgKHR5cGVvZiB4ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHZhciBjYiA9IHg7XG4gICAgICAgIHRoaXMucGVuZGluZy5wdXNoKGZ1bmN0aW9uIChidWYpIHtcbiAgICAgICAgICAgIGlmIChidWZbMF0gPT09IDI3ICYmIGJ1ZlsxXSA9PT0gZW5jb2RlLm9yZCgnWycpXG4gICAgICAgICAgICAmJiBidWZbYnVmLmxlbmd0aC0xXSA9PT0gZW5jb2RlLm9yZCgnUicpKSB7XG4gICAgICAgICAgICAgICAgdmFyIHBvcyA9IGJ1Zi50b1N0cmluZygpXG4gICAgICAgICAgICAgICAgICAgIC5zbGljZSgyLC0xKVxuICAgICAgICAgICAgICAgICAgICAuc3BsaXQoJzsnKVxuICAgICAgICAgICAgICAgICAgICAubWFwKE51bWJlcilcbiAgICAgICAgICAgICAgICA7XG4gICAgICAgICAgICAgICAgY2IocG9zWzFdLCBwb3NbMF0pO1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy53cml0ZShlbmNvZGUoJ1s2bicpKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHRoaXMud3JpdGUoZW5jb2RlKFxuICAgICAgICAgICAgJ1snICsgTWF0aC5mbG9vcih5KSArICc7JyArIE1hdGguZmxvb3IoeCkgKyAnZidcbiAgICAgICAgKSk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xufTtcblxuQ2hhcm0ucHJvdG90eXBlLm1vdmUgPSBmdW5jdGlvbiAoeCwgeSkge1xuICAgIC8vIHNldCByZWxhdGl2ZSBjb29yZGluYXRlc1xuICAgIHZhciBidWZzID0gW107XG4gICAgXG4gICAgaWYgKHkgPCAwKSB0aGlzLnVwKC15KVxuICAgIGVsc2UgaWYgKHkgPiAwKSB0aGlzLmRvd24oeSlcbiAgICBcbiAgICBpZiAoeCA+IDApIHRoaXMucmlnaHQoeClcbiAgICBlbHNlIGlmICh4IDwgMCkgdGhpcy5sZWZ0KC14KVxuICAgIFxuICAgIHJldHVybiB0aGlzO1xufTtcblxuQ2hhcm0ucHJvdG90eXBlLnVwID0gZnVuY3Rpb24gKHkpIHtcbiAgICBpZiAoeSA9PT0gdW5kZWZpbmVkKSB5ID0gMTtcbiAgICB0aGlzLndyaXRlKGVuY29kZSgnWycgKyBNYXRoLmZsb29yKHkpICsgJ0EnKSk7XG4gICAgcmV0dXJuIHRoaXM7XG59O1xuXG5DaGFybS5wcm90b3R5cGUuZG93biA9IGZ1bmN0aW9uICh5KSB7XG4gICAgaWYgKHkgPT09IHVuZGVmaW5lZCkgeSA9IDE7XG4gICAgdGhpcy53cml0ZShlbmNvZGUoJ1snICsgTWF0aC5mbG9vcih5KSArICdCJykpO1xuICAgIHJldHVybiB0aGlzO1xufTtcblxuQ2hhcm0ucHJvdG90eXBlLnJpZ2h0ID0gZnVuY3Rpb24gKHgpIHtcbiAgICBpZiAoeCA9PT0gdW5kZWZpbmVkKSB4ID0gMTtcbiAgICB0aGlzLndyaXRlKGVuY29kZSgnWycgKyBNYXRoLmZsb29yKHgpICsgJ0MnKSk7XG4gICAgcmV0dXJuIHRoaXM7XG59O1xuXG5DaGFybS5wcm90b3R5cGUubGVmdCA9IGZ1bmN0aW9uICh4KSB7XG4gICAgaWYgKHggPT09IHVuZGVmaW5lZCkgeCA9IDE7XG4gICAgdGhpcy53cml0ZShlbmNvZGUoJ1snICsgTWF0aC5mbG9vcih4KSArICdEJykpO1xuICAgIHJldHVybiB0aGlzO1xufTtcblxuQ2hhcm0ucHJvdG90eXBlLmNvbHVtbiA9IGZ1bmN0aW9uICh4KSB7XG4gICAgdGhpcy53cml0ZShlbmNvZGUoJ1snICsgTWF0aC5mbG9vcih4KSArICdHJykpO1xuICAgIHJldHVybiB0aGlzO1xufTtcblxuQ2hhcm0ucHJvdG90eXBlLnB1c2ggPSBmdW5jdGlvbiAod2l0aEF0dHJpYnV0ZXMpIHtcbiAgICB0aGlzLndyaXRlKGVuY29kZSh3aXRoQXR0cmlidXRlcyA/ICc3JyA6ICdbcycpKTtcbiAgICByZXR1cm4gdGhpcztcbn07XG5cbkNoYXJtLnByb3RvdHlwZS5wb3AgPSBmdW5jdGlvbiAod2l0aEF0dHJpYnV0ZXMpIHtcbiAgICB0aGlzLndyaXRlKGVuY29kZSh3aXRoQXR0cmlidXRlcyA/ICc4JyA6ICdbdScpKTtcbiAgICByZXR1cm4gdGhpcztcbn07XG5cbkNoYXJtLnByb3RvdHlwZS5lcmFzZSA9IGZ1bmN0aW9uIChzKSB7XG4gICAgaWYgKHMgPT09ICdlbmQnIHx8IHMgPT09ICckJykge1xuICAgICAgICB0aGlzLndyaXRlKGVuY29kZSgnW0snKSk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHMgPT09ICdzdGFydCcgfHwgcyA9PT0gJ14nKSB7XG4gICAgICAgIHRoaXMud3JpdGUoZW5jb2RlKCdbMUsnKSk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHMgPT09ICdsaW5lJykge1xuICAgICAgICB0aGlzLndyaXRlKGVuY29kZSgnWzJLJykpO1xuICAgIH1cbiAgICBlbHNlIGlmIChzID09PSAnZG93bicpIHtcbiAgICAgICAgdGhpcy53cml0ZShlbmNvZGUoJ1tKJykpO1xuICAgIH1cbiAgICBlbHNlIGlmIChzID09PSAndXAnKSB7XG4gICAgICAgIHRoaXMud3JpdGUoZW5jb2RlKCdbMUonKSk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHMgPT09ICdzY3JlZW4nKSB7XG4gICAgICAgIHRoaXMud3JpdGUoZW5jb2RlKCdbMUonKSk7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICB0aGlzLmVtaXQoJ2Vycm9yJywgbmV3IEVycm9yKCdVbmtub3duIGVyYXNlIHR5cGU6ICcgKyBzKSk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xufTtcblxuQ2hhcm0ucHJvdG90eXBlLmRpc3BsYXkgPSBmdW5jdGlvbiAoYXR0cikge1xuICAgIHZhciBjID0ge1xuICAgICAgICByZXNldCA6IDAsXG4gICAgICAgIGJyaWdodCA6IDEsXG4gICAgICAgIGRpbSA6IDIsXG4gICAgICAgIHVuZGVyc2NvcmUgOiA0LFxuICAgICAgICBibGluayA6IDUsXG4gICAgICAgIHJldmVyc2UgOiA3LFxuICAgICAgICBoaWRkZW4gOiA4XG4gICAgfVthdHRyXTtcbiAgICBpZiAoYyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMuZW1pdCgnZXJyb3InLCBuZXcgRXJyb3IoJ1Vua25vd24gYXR0cmlidXRlOiAnICsgYXR0cikpO1xuICAgIH1cbiAgICB0aGlzLndyaXRlKGVuY29kZSgnWycgKyBjICsgJ20nKSk7XG4gICAgcmV0dXJuIHRoaXM7XG59O1xuXG5DaGFybS5wcm90b3R5cGUuZm9yZWdyb3VuZCA9IGZ1bmN0aW9uIChjb2xvcikge1xuICAgIGlmICh0eXBlb2YgY29sb3IgPT09ICdudW1iZXInKSB7XG4gICAgICAgIGlmIChjb2xvciA8IDAgfHwgY29sb3IgPj0gMjU2KSB7XG4gICAgICAgICAgICB0aGlzLmVtaXQoJ2Vycm9yJywgbmV3IEVycm9yKCdDb2xvciBvdXQgb2YgcmFuZ2U6ICcgKyBjb2xvcikpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMud3JpdGUoZW5jb2RlKCdbMzg7NTsnICsgY29sb3IgKyAnbScpKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHZhciBjID0ge1xuICAgICAgICAgICAgYmxhY2sgOiAzMCxcbiAgICAgICAgICAgIHJlZCA6IDMxLFxuICAgICAgICAgICAgZ3JlZW4gOiAzMixcbiAgICAgICAgICAgIHllbGxvdyA6IDMzLFxuICAgICAgICAgICAgYmx1ZSA6IDM0LFxuICAgICAgICAgICAgbWFnZW50YSA6IDM1LFxuICAgICAgICAgICAgY3lhbiA6IDM2LFxuICAgICAgICAgICAgd2hpdGUgOiAzN1xuICAgICAgICB9W2NvbG9yLnRvTG93ZXJDYXNlKCldO1xuICAgICAgICBcbiAgICAgICAgaWYgKCFjKSB0aGlzLmVtaXQoJ2Vycm9yJywgbmV3IEVycm9yKCdVbmtub3duIGNvbG9yOiAnICsgY29sb3IpKTtcbiAgICAgICAgdGhpcy53cml0ZShlbmNvZGUoJ1snICsgYyArICdtJykpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbn07XG5cbkNoYXJtLnByb3RvdHlwZS5iYWNrZ3JvdW5kID0gZnVuY3Rpb24gKGNvbG9yKSB7XG4gICAgaWYgKHR5cGVvZiBjb2xvciA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgaWYgKGNvbG9yIDwgMCB8fCBjb2xvciA+PSAyNTYpIHtcbiAgICAgICAgICAgIHRoaXMuZW1pdCgnZXJyb3InLCBuZXcgRXJyb3IoJ0NvbG9yIG91dCBvZiByYW5nZTogJyArIGNvbG9yKSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy53cml0ZShlbmNvZGUoJ1s0ODs1OycgKyBjb2xvciArICdtJykpO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgdmFyIGMgPSB7XG4gICAgICAgICAgYmxhY2sgOiA0MCxcbiAgICAgICAgICByZWQgOiA0MSxcbiAgICAgICAgICBncmVlbiA6IDQyLFxuICAgICAgICAgIHllbGxvdyA6IDQzLFxuICAgICAgICAgIGJsdWUgOiA0NCxcbiAgICAgICAgICBtYWdlbnRhIDogNDUsXG4gICAgICAgICAgY3lhbiA6IDQ2LFxuICAgICAgICAgIHdoaXRlIDogNDdcbiAgICAgICAgfVtjb2xvci50b0xvd2VyQ2FzZSgpXTtcbiAgICAgICAgXG4gICAgICAgIGlmICghYykgdGhpcy5lbWl0KCdlcnJvcicsIG5ldyBFcnJvcignVW5rbm93biBjb2xvcjogJyArIGNvbG9yKSk7XG4gICAgICAgIHRoaXMud3JpdGUoZW5jb2RlKCdbJyArIGMgKyAnbScpKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXM7XG59O1xuXG5DaGFybS5wcm90b3R5cGUuY3Vyc29yID0gZnVuY3Rpb24gKHZpc2libGUpIHtcbiAgICB0aGlzLndyaXRlKGVuY29kZSh2aXNpYmxlID8gJ1s/MjVoJyA6ICdbPzI1bCcpKTtcbiAgICByZXR1cm4gdGhpcztcbn07XG5cbnZhciBleHRyYWN0Q29kZXMgPSBleHBvcnRzLmV4dHJhY3RDb2RlcyA9IGZ1bmN0aW9uIChidWYpIHtcbiAgICB2YXIgY29kZXMgPSBbXTtcbiAgICB2YXIgc3RhcnQgPSAtMTtcbiAgICBcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGJ1Zi5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAoYnVmW2ldID09PSAyNykge1xuICAgICAgICAgICAgaWYgKHN0YXJ0ID49IDApIGNvZGVzLnB1c2goYnVmLnNsaWNlKHN0YXJ0LCBpKSk7XG4gICAgICAgICAgICBzdGFydCA9IGk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoc3RhcnQgPj0gMCAmJiBpID09PSBidWYubGVuZ3RoIC0gMSkge1xuICAgICAgICAgICAgY29kZXMucHVzaChidWYuc2xpY2Uoc3RhcnQpKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gY29kZXM7XG59XG5cbn0pKHJlcXVpcmUoXCJfX2Jyb3dzZXJpZnlfcHJvY2Vzc1wiKSkiLCJyZXF1aXJlPShmdW5jdGlvbihlLHQsbixyKXtmdW5jdGlvbiBpKHIpe2lmKCFuW3JdKXtpZighdFtyXSl7aWYoZSlyZXR1cm4gZShyKTt0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK3IrXCInXCIpfXZhciBzPW5bcl09e2V4cG9ydHM6e319O3Rbcl1bMF0oZnVuY3Rpb24oZSl7dmFyIG49dFtyXVsxXVtlXTtyZXR1cm4gaShuP246ZSl9LHMscy5leHBvcnRzKX1yZXR1cm4gbltyXS5leHBvcnRzfWZvcih2YXIgcz0wO3M8ci5sZW5ndGg7cysrKWkocltzXSk7cmV0dXJuIGl9KSh0eXBlb2YgcmVxdWlyZSE9PVwidW5kZWZpbmVkXCImJnJlcXVpcmUsezE6W2Z1bmN0aW9uKHJlcXVpcmUsbW9kdWxlLGV4cG9ydHMpe1xuZXhwb3J0cy5yZWFkSUVFRTc1NCA9IGZ1bmN0aW9uKGJ1ZmZlciwgb2Zmc2V0LCBpc0JFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sXG4gICAgICBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxLFxuICAgICAgZU1heCA9ICgxIDw8IGVMZW4pIC0gMSxcbiAgICAgIGVCaWFzID0gZU1heCA+PiAxLFxuICAgICAgbkJpdHMgPSAtNyxcbiAgICAgIGkgPSBpc0JFID8gMCA6IChuQnl0ZXMgLSAxKSxcbiAgICAgIGQgPSBpc0JFID8gMSA6IC0xLFxuICAgICAgcyA9IGJ1ZmZlcltvZmZzZXQgKyBpXTtcblxuICBpICs9IGQ7XG5cbiAgZSA9IHMgJiAoKDEgPDwgKC1uQml0cykpIC0gMSk7XG4gIHMgPj49ICgtbkJpdHMpO1xuICBuQml0cyArPSBlTGVuO1xuICBmb3IgKDsgbkJpdHMgPiAwOyBlID0gZSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KTtcblxuICBtID0gZSAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKTtcbiAgZSA+Pj0gKC1uQml0cyk7XG4gIG5CaXRzICs9IG1MZW47XG4gIGZvciAoOyBuQml0cyA+IDA7IG0gPSBtICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpO1xuXG4gIGlmIChlID09PSAwKSB7XG4gICAgZSA9IDEgLSBlQmlhcztcbiAgfSBlbHNlIGlmIChlID09PSBlTWF4KSB7XG4gICAgcmV0dXJuIG0gPyBOYU4gOiAoKHMgPyAtMSA6IDEpICogSW5maW5pdHkpO1xuICB9IGVsc2Uge1xuICAgIG0gPSBtICsgTWF0aC5wb3coMiwgbUxlbik7XG4gICAgZSA9IGUgLSBlQmlhcztcbiAgfVxuICByZXR1cm4gKHMgPyAtMSA6IDEpICogbSAqIE1hdGgucG93KDIsIGUgLSBtTGVuKTtcbn07XG5cbmV4cG9ydHMud3JpdGVJRUVFNzU0ID0gZnVuY3Rpb24oYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0JFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sIGMsXG4gICAgICBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxLFxuICAgICAgZU1heCA9ICgxIDw8IGVMZW4pIC0gMSxcbiAgICAgIGVCaWFzID0gZU1heCA+PiAxLFxuICAgICAgcnQgPSAobUxlbiA9PT0gMjMgPyBNYXRoLnBvdygyLCAtMjQpIC0gTWF0aC5wb3coMiwgLTc3KSA6IDApLFxuICAgICAgaSA9IGlzQkUgPyAobkJ5dGVzIC0gMSkgOiAwLFxuICAgICAgZCA9IGlzQkUgPyAtMSA6IDEsXG4gICAgICBzID0gdmFsdWUgPCAwIHx8ICh2YWx1ZSA9PT0gMCAmJiAxIC8gdmFsdWUgPCAwKSA/IDEgOiAwO1xuXG4gIHZhbHVlID0gTWF0aC5hYnModmFsdWUpO1xuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwO1xuICAgIGUgPSBlTWF4O1xuICB9IGVsc2Uge1xuICAgIGUgPSBNYXRoLmZsb29yKE1hdGgubG9nKHZhbHVlKSAvIE1hdGguTE4yKTtcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS07XG4gICAgICBjICo9IDI7XG4gICAgfVxuICAgIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgdmFsdWUgKz0gcnQgLyBjO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcyk7XG4gICAgfVxuICAgIGlmICh2YWx1ZSAqIGMgPj0gMikge1xuICAgICAgZSsrO1xuICAgICAgYyAvPSAyO1xuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDA7XG4gICAgICBlID0gZU1heDtcbiAgICB9IGVsc2UgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICBtID0gKHZhbHVlICogYyAtIDEpICogTWF0aC5wb3coMiwgbUxlbik7XG4gICAgICBlID0gZSArIGVCaWFzO1xuICAgIH0gZWxzZSB7XG4gICAgICBtID0gdmFsdWUgKiBNYXRoLnBvdygyLCBlQmlhcyAtIDEpICogTWF0aC5wb3coMiwgbUxlbik7XG4gICAgICBlID0gMDtcbiAgICB9XG4gIH1cblxuICBmb3IgKDsgbUxlbiA+PSA4OyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBtICYgMHhmZiwgaSArPSBkLCBtIC89IDI1NiwgbUxlbiAtPSA4KTtcblxuICBlID0gKGUgPDwgbUxlbikgfCBtO1xuICBlTGVuICs9IG1MZW47XG4gIGZvciAoOyBlTGVuID4gMDsgYnVmZmVyW29mZnNldCArIGldID0gZSAmIDB4ZmYsIGkgKz0gZCwgZSAvPSAyNTYsIGVMZW4gLT0gOCk7XG5cbiAgYnVmZmVyW29mZnNldCArIGkgLSBkXSB8PSBzICogMTI4O1xufTtcblxufSx7fV0sMjpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG4oZnVuY3Rpb24oKXsvLyBVVElMSVRZXG52YXIgdXRpbCA9IHJlcXVpcmUoJ3V0aWwnKTtcbnZhciBCdWZmZXIgPSByZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcjtcbnZhciBwU2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG5cbmZ1bmN0aW9uIG9iamVjdEtleXMob2JqZWN0KSB7XG4gIGlmIChPYmplY3Qua2V5cykgcmV0dXJuIE9iamVjdC5rZXlzKG9iamVjdCk7XG4gIHZhciByZXN1bHQgPSBbXTtcbiAgZm9yICh2YXIgbmFtZSBpbiBvYmplY3QpIHtcbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9iamVjdCwgbmFtZSkpIHtcbiAgICAgIHJlc3VsdC5wdXNoKG5hbWUpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vLyAxLiBUaGUgYXNzZXJ0IG1vZHVsZSBwcm92aWRlcyBmdW5jdGlvbnMgdGhhdCB0aHJvd1xuLy8gQXNzZXJ0aW9uRXJyb3IncyB3aGVuIHBhcnRpY3VsYXIgY29uZGl0aW9ucyBhcmUgbm90IG1ldC4gVGhlXG4vLyBhc3NlcnQgbW9kdWxlIG11c3QgY29uZm9ybSB0byB0aGUgZm9sbG93aW5nIGludGVyZmFjZS5cblxudmFyIGFzc2VydCA9IG1vZHVsZS5leHBvcnRzID0gb2s7XG5cbi8vIDIuIFRoZSBBc3NlcnRpb25FcnJvciBpcyBkZWZpbmVkIGluIGFzc2VydC5cbi8vIG5ldyBhc3NlcnQuQXNzZXJ0aW9uRXJyb3IoeyBtZXNzYWdlOiBtZXNzYWdlLFxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdHVhbDogYWN0dWFsLFxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4cGVjdGVkOiBleHBlY3RlZCB9KVxuXG5hc3NlcnQuQXNzZXJ0aW9uRXJyb3IgPSBmdW5jdGlvbiBBc3NlcnRpb25FcnJvcihvcHRpb25zKSB7XG4gIHRoaXMubmFtZSA9ICdBc3NlcnRpb25FcnJvcic7XG4gIHRoaXMubWVzc2FnZSA9IG9wdGlvbnMubWVzc2FnZTtcbiAgdGhpcy5hY3R1YWwgPSBvcHRpb25zLmFjdHVhbDtcbiAgdGhpcy5leHBlY3RlZCA9IG9wdGlvbnMuZXhwZWN0ZWQ7XG4gIHRoaXMub3BlcmF0b3IgPSBvcHRpb25zLm9wZXJhdG9yO1xuICB2YXIgc3RhY2tTdGFydEZ1bmN0aW9uID0gb3B0aW9ucy5zdGFja1N0YXJ0RnVuY3Rpb24gfHwgZmFpbDtcblxuICBpZiAoRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UpIHtcbiAgICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSh0aGlzLCBzdGFja1N0YXJ0RnVuY3Rpb24pO1xuICB9XG59O1xudXRpbC5pbmhlcml0cyhhc3NlcnQuQXNzZXJ0aW9uRXJyb3IsIEVycm9yKTtcblxuZnVuY3Rpb24gcmVwbGFjZXIoa2V5LCB2YWx1ZSkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiAnJyArIHZhbHVlO1xuICB9XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInICYmIChpc05hTih2YWx1ZSkgfHwgIWlzRmluaXRlKHZhbHVlKSkpIHtcbiAgICByZXR1cm4gdmFsdWUudG9TdHJpbmcoKTtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nIHx8IHZhbHVlIGluc3RhbmNlb2YgUmVnRXhwKSB7XG4gICAgcmV0dXJuIHZhbHVlLnRvU3RyaW5nKCk7XG4gIH1cbiAgcmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiB0cnVuY2F0ZShzLCBuKSB7XG4gIGlmICh0eXBlb2YgcyA9PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBzLmxlbmd0aCA8IG4gPyBzIDogcy5zbGljZSgwLCBuKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gcztcbiAgfVxufVxuXG5hc3NlcnQuQXNzZXJ0aW9uRXJyb3IucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1lc3NhZ2UpIHtcbiAgICByZXR1cm4gW3RoaXMubmFtZSArICc6JywgdGhpcy5tZXNzYWdlXS5qb2luKCcgJyk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIHRoaXMubmFtZSArICc6JyxcbiAgICAgIHRydW5jYXRlKEpTT04uc3RyaW5naWZ5KHRoaXMuYWN0dWFsLCByZXBsYWNlciksIDEyOCksXG4gICAgICB0aGlzLm9wZXJhdG9yLFxuICAgICAgdHJ1bmNhdGUoSlNPTi5zdHJpbmdpZnkodGhpcy5leHBlY3RlZCwgcmVwbGFjZXIpLCAxMjgpXG4gICAgXS5qb2luKCcgJyk7XG4gIH1cbn07XG5cbi8vIGFzc2VydC5Bc3NlcnRpb25FcnJvciBpbnN0YW5jZW9mIEVycm9yXG5cbmFzc2VydC5Bc3NlcnRpb25FcnJvci5fX3Byb3RvX18gPSBFcnJvci5wcm90b3R5cGU7XG5cbi8vIEF0IHByZXNlbnQgb25seSB0aGUgdGhyZWUga2V5cyBtZW50aW9uZWQgYWJvdmUgYXJlIHVzZWQgYW5kXG4vLyB1bmRlcnN0b29kIGJ5IHRoZSBzcGVjLiBJbXBsZW1lbnRhdGlvbnMgb3Igc3ViIG1vZHVsZXMgY2FuIHBhc3Ncbi8vIG90aGVyIGtleXMgdG8gdGhlIEFzc2VydGlvbkVycm9yJ3MgY29uc3RydWN0b3IgLSB0aGV5IHdpbGwgYmVcbi8vIGlnbm9yZWQuXG5cbi8vIDMuIEFsbCBvZiB0aGUgZm9sbG93aW5nIGZ1bmN0aW9ucyBtdXN0IHRocm93IGFuIEFzc2VydGlvbkVycm9yXG4vLyB3aGVuIGEgY29ycmVzcG9uZGluZyBjb25kaXRpb24gaXMgbm90IG1ldCwgd2l0aCBhIG1lc3NhZ2UgdGhhdFxuLy8gbWF5IGJlIHVuZGVmaW5lZCBpZiBub3QgcHJvdmlkZWQuICBBbGwgYXNzZXJ0aW9uIG1ldGhvZHMgcHJvdmlkZVxuLy8gYm90aCB0aGUgYWN0dWFsIGFuZCBleHBlY3RlZCB2YWx1ZXMgdG8gdGhlIGFzc2VydGlvbiBlcnJvciBmb3Jcbi8vIGRpc3BsYXkgcHVycG9zZXMuXG5cbmZ1bmN0aW9uIGZhaWwoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZSwgb3BlcmF0b3IsIHN0YWNrU3RhcnRGdW5jdGlvbikge1xuICB0aHJvdyBuZXcgYXNzZXJ0LkFzc2VydGlvbkVycm9yKHtcbiAgICBtZXNzYWdlOiBtZXNzYWdlLFxuICAgIGFjdHVhbDogYWN0dWFsLFxuICAgIGV4cGVjdGVkOiBleHBlY3RlZCxcbiAgICBvcGVyYXRvcjogb3BlcmF0b3IsXG4gICAgc3RhY2tTdGFydEZ1bmN0aW9uOiBzdGFja1N0YXJ0RnVuY3Rpb25cbiAgfSk7XG59XG5cbi8vIEVYVEVOU0lPTiEgYWxsb3dzIGZvciB3ZWxsIGJlaGF2ZWQgZXJyb3JzIGRlZmluZWQgZWxzZXdoZXJlLlxuYXNzZXJ0LmZhaWwgPSBmYWlsO1xuXG4vLyA0LiBQdXJlIGFzc2VydGlvbiB0ZXN0cyB3aGV0aGVyIGEgdmFsdWUgaXMgdHJ1dGh5LCBhcyBkZXRlcm1pbmVkXG4vLyBieSAhIWd1YXJkLlxuLy8gYXNzZXJ0Lm9rKGd1YXJkLCBtZXNzYWdlX29wdCk7XG4vLyBUaGlzIHN0YXRlbWVudCBpcyBlcXVpdmFsZW50IHRvIGFzc2VydC5lcXVhbCh0cnVlLCBndWFyZCxcbi8vIG1lc3NhZ2Vfb3B0KTsuIFRvIHRlc3Qgc3RyaWN0bHkgZm9yIHRoZSB2YWx1ZSB0cnVlLCB1c2Vcbi8vIGFzc2VydC5zdHJpY3RFcXVhbCh0cnVlLCBndWFyZCwgbWVzc2FnZV9vcHQpOy5cblxuZnVuY3Rpb24gb2sodmFsdWUsIG1lc3NhZ2UpIHtcbiAgaWYgKCEhIXZhbHVlKSBmYWlsKHZhbHVlLCB0cnVlLCBtZXNzYWdlLCAnPT0nLCBhc3NlcnQub2spO1xufVxuYXNzZXJ0Lm9rID0gb2s7XG5cbi8vIDUuIFRoZSBlcXVhbGl0eSBhc3NlcnRpb24gdGVzdHMgc2hhbGxvdywgY29lcmNpdmUgZXF1YWxpdHkgd2l0aFxuLy8gPT0uXG4vLyBhc3NlcnQuZXF1YWwoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZV9vcHQpO1xuXG5hc3NlcnQuZXF1YWwgPSBmdW5jdGlvbiBlcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlKSB7XG4gIGlmIChhY3R1YWwgIT0gZXhwZWN0ZWQpIGZhaWwoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZSwgJz09JywgYXNzZXJ0LmVxdWFsKTtcbn07XG5cbi8vIDYuIFRoZSBub24tZXF1YWxpdHkgYXNzZXJ0aW9uIHRlc3RzIGZvciB3aGV0aGVyIHR3byBvYmplY3RzIGFyZSBub3QgZXF1YWxcbi8vIHdpdGggIT0gYXNzZXJ0Lm5vdEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2Vfb3B0KTtcblxuYXNzZXJ0Lm5vdEVxdWFsID0gZnVuY3Rpb24gbm90RXF1YWwoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZSkge1xuICBpZiAoYWN0dWFsID09IGV4cGVjdGVkKSB7XG4gICAgZmFpbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlLCAnIT0nLCBhc3NlcnQubm90RXF1YWwpO1xuICB9XG59O1xuXG4vLyA3LiBUaGUgZXF1aXZhbGVuY2UgYXNzZXJ0aW9uIHRlc3RzIGEgZGVlcCBlcXVhbGl0eSByZWxhdGlvbi5cbi8vIGFzc2VydC5kZWVwRXF1YWwoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZV9vcHQpO1xuXG5hc3NlcnQuZGVlcEVxdWFsID0gZnVuY3Rpb24gZGVlcEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2UpIHtcbiAgaWYgKCFfZGVlcEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQpKSB7XG4gICAgZmFpbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlLCAnZGVlcEVxdWFsJywgYXNzZXJ0LmRlZXBFcXVhbCk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIF9kZWVwRXF1YWwoYWN0dWFsLCBleHBlY3RlZCkge1xuICAvLyA3LjEuIEFsbCBpZGVudGljYWwgdmFsdWVzIGFyZSBlcXVpdmFsZW50LCBhcyBkZXRlcm1pbmVkIGJ5ID09PS5cbiAgaWYgKGFjdHVhbCA9PT0gZXhwZWN0ZWQpIHtcbiAgICByZXR1cm4gdHJ1ZTtcblxuICB9IGVsc2UgaWYgKEJ1ZmZlci5pc0J1ZmZlcihhY3R1YWwpICYmIEJ1ZmZlci5pc0J1ZmZlcihleHBlY3RlZCkpIHtcbiAgICBpZiAoYWN0dWFsLmxlbmd0aCAhPSBleHBlY3RlZC5sZW5ndGgpIHJldHVybiBmYWxzZTtcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYWN0dWFsLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYWN0dWFsW2ldICE9PSBleHBlY3RlZFtpXSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xuXG4gIC8vIDcuMi4gSWYgdGhlIGV4cGVjdGVkIHZhbHVlIGlzIGEgRGF0ZSBvYmplY3QsIHRoZSBhY3R1YWwgdmFsdWUgaXNcbiAgLy8gZXF1aXZhbGVudCBpZiBpdCBpcyBhbHNvIGEgRGF0ZSBvYmplY3QgdGhhdCByZWZlcnMgdG8gdGhlIHNhbWUgdGltZS5cbiAgfSBlbHNlIGlmIChhY3R1YWwgaW5zdGFuY2VvZiBEYXRlICYmIGV4cGVjdGVkIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgIHJldHVybiBhY3R1YWwuZ2V0VGltZSgpID09PSBleHBlY3RlZC5nZXRUaW1lKCk7XG5cbiAgLy8gNy4zLiBPdGhlciBwYWlycyB0aGF0IGRvIG5vdCBib3RoIHBhc3MgdHlwZW9mIHZhbHVlID09ICdvYmplY3QnLFxuICAvLyBlcXVpdmFsZW5jZSBpcyBkZXRlcm1pbmVkIGJ5ID09LlxuICB9IGVsc2UgaWYgKHR5cGVvZiBhY3R1YWwgIT0gJ29iamVjdCcgJiYgdHlwZW9mIGV4cGVjdGVkICE9ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIGFjdHVhbCA9PSBleHBlY3RlZDtcblxuICAvLyA3LjQuIEZvciBhbGwgb3RoZXIgT2JqZWN0IHBhaXJzLCBpbmNsdWRpbmcgQXJyYXkgb2JqZWN0cywgZXF1aXZhbGVuY2UgaXNcbiAgLy8gZGV0ZXJtaW5lZCBieSBoYXZpbmcgdGhlIHNhbWUgbnVtYmVyIG9mIG93bmVkIHByb3BlcnRpZXMgKGFzIHZlcmlmaWVkXG4gIC8vIHdpdGggT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKSwgdGhlIHNhbWUgc2V0IG9mIGtleXNcbiAgLy8gKGFsdGhvdWdoIG5vdCBuZWNlc3NhcmlseSB0aGUgc2FtZSBvcmRlciksIGVxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeVxuICAvLyBjb3JyZXNwb25kaW5nIGtleSwgYW5kIGFuIGlkZW50aWNhbCAncHJvdG90eXBlJyBwcm9wZXJ0eS4gTm90ZTogdGhpc1xuICAvLyBhY2NvdW50cyBmb3IgYm90aCBuYW1lZCBhbmQgaW5kZXhlZCBwcm9wZXJ0aWVzIG9uIEFycmF5cy5cbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gb2JqRXF1aXYoYWN0dWFsLCBleHBlY3RlZCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gaXNVbmRlZmluZWRPck51bGwodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGlzQXJndW1lbnRzKG9iamVjdCkge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iamVjdCkgPT0gJ1tvYmplY3QgQXJndW1lbnRzXSc7XG59XG5cbmZ1bmN0aW9uIG9iakVxdWl2KGEsIGIpIHtcbiAgaWYgKGlzVW5kZWZpbmVkT3JOdWxsKGEpIHx8IGlzVW5kZWZpbmVkT3JOdWxsKGIpKVxuICAgIHJldHVybiBmYWxzZTtcbiAgLy8gYW4gaWRlbnRpY2FsICdwcm90b3R5cGUnIHByb3BlcnR5LlxuICBpZiAoYS5wcm90b3R5cGUgIT09IGIucHJvdG90eXBlKSByZXR1cm4gZmFsc2U7XG4gIC8vfn5+SSd2ZSBtYW5hZ2VkIHRvIGJyZWFrIE9iamVjdC5rZXlzIHRocm91Z2ggc2NyZXd5IGFyZ3VtZW50cyBwYXNzaW5nLlxuICAvLyAgIENvbnZlcnRpbmcgdG8gYXJyYXkgc29sdmVzIHRoZSBwcm9ibGVtLlxuICBpZiAoaXNBcmd1bWVudHMoYSkpIHtcbiAgICBpZiAoIWlzQXJndW1lbnRzKGIpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGEgPSBwU2xpY2UuY2FsbChhKTtcbiAgICBiID0gcFNsaWNlLmNhbGwoYik7XG4gICAgcmV0dXJuIF9kZWVwRXF1YWwoYSwgYik7XG4gIH1cbiAgdHJ5IHtcbiAgICB2YXIga2EgPSBvYmplY3RLZXlzKGEpLFxuICAgICAgICBrYiA9IG9iamVjdEtleXMoYiksXG4gICAgICAgIGtleSwgaTtcbiAgfSBjYXRjaCAoZSkgey8vaGFwcGVucyB3aGVuIG9uZSBpcyBhIHN0cmluZyBsaXRlcmFsIGFuZCB0aGUgb3RoZXIgaXNuJ3RcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgLy8gaGF2aW5nIHRoZSBzYW1lIG51bWJlciBvZiBvd25lZCBwcm9wZXJ0aWVzIChrZXlzIGluY29ycG9yYXRlc1xuICAvLyBoYXNPd25Qcm9wZXJ0eSlcbiAgaWYgKGthLmxlbmd0aCAhPSBrYi5sZW5ndGgpXG4gICAgcmV0dXJuIGZhbHNlO1xuICAvL3RoZSBzYW1lIHNldCBvZiBrZXlzIChhbHRob3VnaCBub3QgbmVjZXNzYXJpbHkgdGhlIHNhbWUgb3JkZXIpLFxuICBrYS5zb3J0KCk7XG4gIGtiLnNvcnQoKTtcbiAgLy9+fn5jaGVhcCBrZXkgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGlmIChrYVtpXSAhPSBrYltpXSlcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICAvL2VxdWl2YWxlbnQgdmFsdWVzIGZvciBldmVyeSBjb3JyZXNwb25kaW5nIGtleSwgYW5kXG4gIC8vfn5+cG9zc2libHkgZXhwZW5zaXZlIGRlZXAgdGVzdFxuICBmb3IgKGkgPSBrYS5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGtleSA9IGthW2ldO1xuICAgIGlmICghX2RlZXBFcXVhbChhW2tleV0sIGJba2V5XSkpIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gOC4gVGhlIG5vbi1lcXVpdmFsZW5jZSBhc3NlcnRpb24gdGVzdHMgZm9yIGFueSBkZWVwIGluZXF1YWxpdHkuXG4vLyBhc3NlcnQubm90RGVlcEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2Vfb3B0KTtcblxuYXNzZXJ0Lm5vdERlZXBFcXVhbCA9IGZ1bmN0aW9uIG5vdERlZXBFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlKSB7XG4gIGlmIChfZGVlcEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQpKSB7XG4gICAgZmFpbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlLCAnbm90RGVlcEVxdWFsJywgYXNzZXJ0Lm5vdERlZXBFcXVhbCk7XG4gIH1cbn07XG5cbi8vIDkuIFRoZSBzdHJpY3QgZXF1YWxpdHkgYXNzZXJ0aW9uIHRlc3RzIHN0cmljdCBlcXVhbGl0eSwgYXMgZGV0ZXJtaW5lZCBieSA9PT0uXG4vLyBhc3NlcnQuc3RyaWN0RXF1YWwoYWN0dWFsLCBleHBlY3RlZCwgbWVzc2FnZV9vcHQpO1xuXG5hc3NlcnQuc3RyaWN0RXF1YWwgPSBmdW5jdGlvbiBzdHJpY3RFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlKSB7XG4gIGlmIChhY3R1YWwgIT09IGV4cGVjdGVkKSB7XG4gICAgZmFpbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlLCAnPT09JywgYXNzZXJ0LnN0cmljdEVxdWFsKTtcbiAgfVxufTtcblxuLy8gMTAuIFRoZSBzdHJpY3Qgbm9uLWVxdWFsaXR5IGFzc2VydGlvbiB0ZXN0cyBmb3Igc3RyaWN0IGluZXF1YWxpdHksIGFzXG4vLyBkZXRlcm1pbmVkIGJ5ICE9PS4gIGFzc2VydC5ub3RTdHJpY3RFcXVhbChhY3R1YWwsIGV4cGVjdGVkLCBtZXNzYWdlX29wdCk7XG5cbmFzc2VydC5ub3RTdHJpY3RFcXVhbCA9IGZ1bmN0aW9uIG5vdFN0cmljdEVxdWFsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2UpIHtcbiAgaWYgKGFjdHVhbCA9PT0gZXhwZWN0ZWQpIHtcbiAgICBmYWlsKGFjdHVhbCwgZXhwZWN0ZWQsIG1lc3NhZ2UsICchPT0nLCBhc3NlcnQubm90U3RyaWN0RXF1YWwpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBleHBlY3RlZEV4Y2VwdGlvbihhY3R1YWwsIGV4cGVjdGVkKSB7XG4gIGlmICghYWN0dWFsIHx8ICFleHBlY3RlZCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGlmIChleHBlY3RlZCBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgIHJldHVybiBleHBlY3RlZC50ZXN0KGFjdHVhbCk7XG4gIH0gZWxzZSBpZiAoYWN0dWFsIGluc3RhbmNlb2YgZXhwZWN0ZWQpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBlbHNlIGlmIChleHBlY3RlZC5jYWxsKHt9LCBhY3R1YWwpID09PSB0cnVlKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICByZXR1cm4gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIF90aHJvd3Moc2hvdWxkVGhyb3csIGJsb2NrLCBleHBlY3RlZCwgbWVzc2FnZSkge1xuICB2YXIgYWN0dWFsO1xuXG4gIGlmICh0eXBlb2YgZXhwZWN0ZWQgPT09ICdzdHJpbmcnKSB7XG4gICAgbWVzc2FnZSA9IGV4cGVjdGVkO1xuICAgIGV4cGVjdGVkID0gbnVsbDtcbiAgfVxuXG4gIHRyeSB7XG4gICAgYmxvY2soKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFjdHVhbCA9IGU7XG4gIH1cblxuICBtZXNzYWdlID0gKGV4cGVjdGVkICYmIGV4cGVjdGVkLm5hbWUgPyAnICgnICsgZXhwZWN0ZWQubmFtZSArICcpLicgOiAnLicpICtcbiAgICAgICAgICAgIChtZXNzYWdlID8gJyAnICsgbWVzc2FnZSA6ICcuJyk7XG5cbiAgaWYgKHNob3VsZFRocm93ICYmICFhY3R1YWwpIHtcbiAgICBmYWlsKCdNaXNzaW5nIGV4cGVjdGVkIGV4Y2VwdGlvbicgKyBtZXNzYWdlKTtcbiAgfVxuXG4gIGlmICghc2hvdWxkVGhyb3cgJiYgZXhwZWN0ZWRFeGNlcHRpb24oYWN0dWFsLCBleHBlY3RlZCkpIHtcbiAgICBmYWlsKCdHb3QgdW53YW50ZWQgZXhjZXB0aW9uJyArIG1lc3NhZ2UpO1xuICB9XG5cbiAgaWYgKChzaG91bGRUaHJvdyAmJiBhY3R1YWwgJiYgZXhwZWN0ZWQgJiZcbiAgICAgICFleHBlY3RlZEV4Y2VwdGlvbihhY3R1YWwsIGV4cGVjdGVkKSkgfHwgKCFzaG91bGRUaHJvdyAmJiBhY3R1YWwpKSB7XG4gICAgdGhyb3cgYWN0dWFsO1xuICB9XG59XG5cbi8vIDExLiBFeHBlY3RlZCB0byB0aHJvdyBhbiBlcnJvcjpcbi8vIGFzc2VydC50aHJvd3MoYmxvY2ssIEVycm9yX29wdCwgbWVzc2FnZV9vcHQpO1xuXG5hc3NlcnQudGhyb3dzID0gZnVuY3Rpb24oYmxvY2ssIC8qb3B0aW9uYWwqL2Vycm9yLCAvKm9wdGlvbmFsKi9tZXNzYWdlKSB7XG4gIF90aHJvd3MuYXBwbHkodGhpcywgW3RydWVdLmNvbmNhdChwU2xpY2UuY2FsbChhcmd1bWVudHMpKSk7XG59O1xuXG4vLyBFWFRFTlNJT04hIFRoaXMgaXMgYW5ub3lpbmcgdG8gd3JpdGUgb3V0c2lkZSB0aGlzIG1vZHVsZS5cbmFzc2VydC5kb2VzTm90VGhyb3cgPSBmdW5jdGlvbihibG9jaywgLypvcHRpb25hbCovZXJyb3IsIC8qb3B0aW9uYWwqL21lc3NhZ2UpIHtcbiAgX3Rocm93cy5hcHBseSh0aGlzLCBbZmFsc2VdLmNvbmNhdChwU2xpY2UuY2FsbChhcmd1bWVudHMpKSk7XG59O1xuXG5hc3NlcnQuaWZFcnJvciA9IGZ1bmN0aW9uKGVycikgeyBpZiAoZXJyKSB7dGhyb3cgZXJyO319O1xuXG59KSgpXG59LHtcInV0aWxcIjozLFwiYnVmZmVyXCI6NH1dLFwiYnVmZmVyLWJyb3dzZXJpZnlcIjpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG5tb2R1bGUuZXhwb3J0cz1yZXF1aXJlKCdxOVR4Q0MnKTtcbn0se31dLFwicTlUeENDXCI6W2Z1bmN0aW9uKHJlcXVpcmUsbW9kdWxlLGV4cG9ydHMpe1xuKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gU2xvd0J1ZmZlciAoc2l6ZSkge1xuICAgIHRoaXMubGVuZ3RoID0gc2l6ZTtcbn07XG5cbnZhciBhc3NlcnQgPSByZXF1aXJlKCdhc3NlcnQnKTtcblxuZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFUyA9IDUwO1xuXG5cbmZ1bmN0aW9uIHRvSGV4KG4pIHtcbiAgaWYgKG4gPCAxNikgcmV0dXJuICcwJyArIG4udG9TdHJpbmcoMTYpO1xuICByZXR1cm4gbi50b1N0cmluZygxNik7XG59XG5cbmZ1bmN0aW9uIHV0ZjhUb0J5dGVzKHN0cikge1xuICB2YXIgYnl0ZUFycmF5ID0gW107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKVxuICAgIGlmIChzdHIuY2hhckNvZGVBdChpKSA8PSAweDdGKVxuICAgICAgYnl0ZUFycmF5LnB1c2goc3RyLmNoYXJDb2RlQXQoaSkpO1xuICAgIGVsc2Uge1xuICAgICAgdmFyIGggPSBlbmNvZGVVUklDb21wb25lbnQoc3RyLmNoYXJBdChpKSkuc3Vic3RyKDEpLnNwbGl0KCclJyk7XG4gICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGgubGVuZ3RoOyBqKyspXG4gICAgICAgIGJ5dGVBcnJheS5wdXNoKHBhcnNlSW50KGhbal0sIDE2KSk7XG4gICAgfVxuXG4gIHJldHVybiBieXRlQXJyYXk7XG59XG5cbmZ1bmN0aW9uIGFzY2lpVG9CeXRlcyhzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrIClcbiAgICAvLyBOb2RlJ3MgY29kZSBzZWVtcyB0byBiZSBkb2luZyB0aGlzIGFuZCBub3QgJiAweDdGLi5cbiAgICBieXRlQXJyYXkucHVzaCggc3RyLmNoYXJDb2RlQXQoaSkgJiAweEZGICk7XG5cbiAgcmV0dXJuIGJ5dGVBcnJheTtcbn1cblxuZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyhzdHIpIHtcbiAgcmV0dXJuIHJlcXVpcmUoXCJiYXNlNjQtanNcIikudG9CeXRlQXJyYXkoc3RyKTtcbn1cblxuU2xvd0J1ZmZlci5ieXRlTGVuZ3RoID0gZnVuY3Rpb24gKHN0ciwgZW5jb2RpbmcpIHtcbiAgc3dpdGNoIChlbmNvZGluZyB8fCBcInV0ZjhcIikge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgICByZXR1cm4gc3RyLmxlbmd0aCAvIDI7XG5cbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgICByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyKS5sZW5ndGg7XG5cbiAgICBjYXNlICdhc2NpaSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgIHJldHVybiBzdHIubGVuZ3RoO1xuXG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgIHJldHVybiBiYXNlNjRUb0J5dGVzKHN0cikubGVuZ3RoO1xuXG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biBlbmNvZGluZycpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBibGl0QnVmZmVyKHNyYywgZHN0LCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgcG9zLCBpID0gMDtcbiAgd2hpbGUgKGkgPCBsZW5ndGgpIHtcbiAgICBpZiAoKGkrb2Zmc2V0ID49IGRzdC5sZW5ndGgpIHx8IChpID49IHNyYy5sZW5ndGgpKVxuICAgICAgYnJlYWs7XG5cbiAgICBkc3RbaSArIG9mZnNldF0gPSBzcmNbaV07XG4gICAgaSsrO1xuICB9XG4gIHJldHVybiBpO1xufVxuXG5TbG93QnVmZmVyLnByb3RvdHlwZS51dGY4V3JpdGUgPSBmdW5jdGlvbiAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgYnl0ZXMsIHBvcztcbiAgcmV0dXJuIFNsb3dCdWZmZXIuX2NoYXJzV3JpdHRlbiA9ICBibGl0QnVmZmVyKHV0ZjhUb0J5dGVzKHN0cmluZyksIHRoaXMsIG9mZnNldCwgbGVuZ3RoKTtcbn07XG5cblNsb3dCdWZmZXIucHJvdG90eXBlLmFzY2lpV3JpdGUgPSBmdW5jdGlvbiAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgYnl0ZXMsIHBvcztcbiAgcmV0dXJuIFNsb3dCdWZmZXIuX2NoYXJzV3JpdHRlbiA9ICBibGl0QnVmZmVyKGFzY2lpVG9CeXRlcyhzdHJpbmcpLCB0aGlzLCBvZmZzZXQsIGxlbmd0aCk7XG59O1xuXG5TbG93QnVmZmVyLnByb3RvdHlwZS5iaW5hcnlXcml0ZSA9IFNsb3dCdWZmZXIucHJvdG90eXBlLmFzY2lpV3JpdGU7XG5cblNsb3dCdWZmZXIucHJvdG90eXBlLmJhc2U2NFdyaXRlID0gZnVuY3Rpb24gKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGJ5dGVzLCBwb3M7XG4gIHJldHVybiBTbG93QnVmZmVyLl9jaGFyc1dyaXR0ZW4gPSBibGl0QnVmZmVyKGJhc2U2NFRvQnl0ZXMoc3RyaW5nKSwgdGhpcywgb2Zmc2V0LCBsZW5ndGgpO1xufTtcblxuU2xvd0J1ZmZlci5wcm90b3R5cGUuYmFzZTY0U2xpY2UgPSBmdW5jdGlvbiAoc3RhcnQsIGVuZCkge1xuICB2YXIgYnl0ZXMgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICByZXR1cm4gcmVxdWlyZShcImJhc2U2NC1qc1wiKS5mcm9tQnl0ZUFycmF5KGJ5dGVzKTtcbn1cblxuZnVuY3Rpb24gZGVjb2RlVXRmOENoYXIoc3RyKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChzdHIpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZSgweEZGRkQpOyAvLyBVVEYgOCBpbnZhbGlkIGNoYXJcbiAgfVxufVxuXG5TbG93QnVmZmVyLnByb3RvdHlwZS51dGY4U2xpY2UgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBieXRlcyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICB2YXIgcmVzID0gXCJcIjtcbiAgdmFyIHRtcCA9IFwiXCI7XG4gIHZhciBpID0gMDtcbiAgd2hpbGUgKGkgPCBieXRlcy5sZW5ndGgpIHtcbiAgICBpZiAoYnl0ZXNbaV0gPD0gMHg3Rikge1xuICAgICAgcmVzICs9IGRlY29kZVV0ZjhDaGFyKHRtcCkgKyBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW2ldKTtcbiAgICAgIHRtcCA9IFwiXCI7XG4gICAgfSBlbHNlXG4gICAgICB0bXAgKz0gXCIlXCIgKyBieXRlc1tpXS50b1N0cmluZygxNik7XG5cbiAgICBpKys7XG4gIH1cblxuICByZXR1cm4gcmVzICsgZGVjb2RlVXRmOENoYXIodG1wKTtcbn1cblxuU2xvd0J1ZmZlci5wcm90b3R5cGUuYXNjaWlTbGljZSA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIGJ5dGVzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gIHZhciByZXQgPSBcIlwiO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSsrKVxuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW2ldKTtcbiAgcmV0dXJuIHJldDtcbn1cblxuU2xvd0J1ZmZlci5wcm90b3R5cGUuYmluYXJ5U2xpY2UgPSBTbG93QnVmZmVyLnByb3RvdHlwZS5hc2NpaVNsaWNlO1xuXG5TbG93QnVmZmVyLnByb3RvdHlwZS5pbnNwZWN0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBvdXQgPSBbXSxcbiAgICAgIGxlbiA9IHRoaXMubGVuZ3RoO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgb3V0W2ldID0gdG9IZXgodGhpc1tpXSk7XG4gICAgaWYgKGkgPT0gZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFUykge1xuICAgICAgb3V0W2kgKyAxXSA9ICcuLi4nO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIHJldHVybiAnPFNsb3dCdWZmZXIgJyArIG91dC5qb2luKCcgJykgKyAnPic7XG59O1xuXG5cblNsb3dCdWZmZXIucHJvdG90eXBlLmhleFNsaWNlID0gZnVuY3Rpb24oc3RhcnQsIGVuZCkge1xuICB2YXIgbGVuID0gdGhpcy5sZW5ndGg7XG5cbiAgaWYgKCFzdGFydCB8fCBzdGFydCA8IDApIHN0YXJ0ID0gMDtcbiAgaWYgKCFlbmQgfHwgZW5kIDwgMCB8fCBlbmQgPiBsZW4pIGVuZCA9IGxlbjtcblxuICB2YXIgb3V0ID0gJyc7XG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgb3V0ICs9IHRvSGV4KHRoaXNbaV0pO1xuICB9XG4gIHJldHVybiBvdXQ7XG59O1xuXG5cblNsb3dCdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oZW5jb2RpbmcsIHN0YXJ0LCBlbmQpIHtcbiAgZW5jb2RpbmcgPSBTdHJpbmcoZW5jb2RpbmcgfHwgJ3V0ZjgnKS50b0xvd2VyQ2FzZSgpO1xuICBzdGFydCA9ICtzdGFydCB8fCAwO1xuICBpZiAodHlwZW9mIGVuZCA9PSAndW5kZWZpbmVkJykgZW5kID0gdGhpcy5sZW5ndGg7XG5cbiAgLy8gRmFzdHBhdGggZW1wdHkgc3RyaW5nc1xuICBpZiAoK2VuZCA9PSBzdGFydCkge1xuICAgIHJldHVybiAnJztcbiAgfVxuXG4gIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgICAgcmV0dXJuIHRoaXMuaGV4U2xpY2Uoc3RhcnQsIGVuZCk7XG5cbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgICByZXR1cm4gdGhpcy51dGY4U2xpY2Uoc3RhcnQsIGVuZCk7XG5cbiAgICBjYXNlICdhc2NpaSc6XG4gICAgICByZXR1cm4gdGhpcy5hc2NpaVNsaWNlKHN0YXJ0LCBlbmQpO1xuXG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgIHJldHVybiB0aGlzLmJpbmFyeVNsaWNlKHN0YXJ0LCBlbmQpO1xuXG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgIHJldHVybiB0aGlzLmJhc2U2NFNsaWNlKHN0YXJ0LCBlbmQpO1xuXG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgICAgcmV0dXJuIHRoaXMudWNzMlNsaWNlKHN0YXJ0LCBlbmQpO1xuXG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biBlbmNvZGluZycpO1xuICB9XG59O1xuXG5cblNsb3dCdWZmZXIucHJvdG90eXBlLmhleFdyaXRlID0gZnVuY3Rpb24oc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSArb2Zmc2V0IHx8IDA7XG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldDtcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmc7XG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gK2xlbmd0aDtcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmc7XG4gICAgfVxuICB9XG5cbiAgLy8gbXVzdCBiZSBhbiBldmVuIG51bWJlciBvZiBkaWdpdHNcbiAgdmFyIHN0ckxlbiA9IHN0cmluZy5sZW5ndGg7XG4gIGlmIChzdHJMZW4gJSAyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKTtcbiAgfVxuICBpZiAobGVuZ3RoID4gc3RyTGVuIC8gMikge1xuICAgIGxlbmd0aCA9IHN0ckxlbiAvIDI7XG4gIH1cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIHZhciBieXRlID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KTtcbiAgICBpZiAoaXNOYU4oYnl0ZSkpIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJyk7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9IGJ5dGU7XG4gIH1cbiAgU2xvd0J1ZmZlci5fY2hhcnNXcml0dGVuID0gaSAqIDI7XG4gIHJldHVybiBpO1xufTtcblxuXG5TbG93QnVmZmVyLnByb3RvdHlwZS53cml0ZSA9IGZ1bmN0aW9uKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKSB7XG4gIC8vIFN1cHBvcnQgYm90aCAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpXG4gIC8vIGFuZCB0aGUgbGVnYWN5IChzdHJpbmcsIGVuY29kaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBpZiAoIWlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGVuY29kaW5nID0gbGVuZ3RoO1xuICAgICAgbGVuZ3RoID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgfSBlbHNlIHsgIC8vIGxlZ2FjeVxuICAgIHZhciBzd2FwID0gZW5jb2Rpbmc7XG4gICAgZW5jb2RpbmcgPSBvZmZzZXQ7XG4gICAgb2Zmc2V0ID0gbGVuZ3RoO1xuICAgIGxlbmd0aCA9IHN3YXA7XG4gIH1cblxuICBvZmZzZXQgPSArb2Zmc2V0IHx8IDA7XG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldDtcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmc7XG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gK2xlbmd0aDtcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmc7XG4gICAgfVxuICB9XG4gIGVuY29kaW5nID0gU3RyaW5nKGVuY29kaW5nIHx8ICd1dGY4JykudG9Mb3dlckNhc2UoKTtcblxuICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldHVybiB0aGlzLmhleFdyaXRlKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpO1xuXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0dXJuIHRoaXMudXRmOFdyaXRlKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpO1xuXG4gICAgY2FzZSAnYXNjaWknOlxuICAgICAgcmV0dXJuIHRoaXMuYXNjaWlXcml0ZShzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKTtcblxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICByZXR1cm4gdGhpcy5iaW5hcnlXcml0ZShzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKTtcblxuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXR1cm4gdGhpcy5iYXNlNjRXcml0ZShzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKTtcblxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIHJldHVybiB0aGlzLnVjczJXcml0ZShzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKTtcblxuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Vua25vd24gZW5jb2RpbmcnKTtcbiAgfVxufTtcblxuXG4vLyBzbGljZShzdGFydCwgZW5kKVxuU2xvd0J1ZmZlci5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbihzdGFydCwgZW5kKSB7XG4gIGlmIChlbmQgPT09IHVuZGVmaW5lZCkgZW5kID0gdGhpcy5sZW5ndGg7XG5cbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdvb2InKTtcbiAgfVxuICBpZiAoc3RhcnQgPiBlbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ29vYicpO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBCdWZmZXIodGhpcywgZW5kIC0gc3RhcnQsICtzdGFydCk7XG59O1xuXG5TbG93QnVmZmVyLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24odGFyZ2V0LCB0YXJnZXRzdGFydCwgc291cmNlc3RhcnQsIHNvdXJjZWVuZCkge1xuICB2YXIgdGVtcCA9IFtdO1xuICBmb3IgKHZhciBpPXNvdXJjZXN0YXJ0OyBpPHNvdXJjZWVuZDsgaSsrKSB7XG4gICAgYXNzZXJ0Lm9rKHR5cGVvZiB0aGlzW2ldICE9PSAndW5kZWZpbmVkJywgXCJjb3B5aW5nIHVuZGVmaW5lZCBidWZmZXIgYnl0ZXMhXCIpO1xuICAgIHRlbXAucHVzaCh0aGlzW2ldKTtcbiAgfVxuXG4gIGZvciAodmFyIGk9dGFyZ2V0c3RhcnQ7IGk8dGFyZ2V0c3RhcnQrdGVtcC5sZW5ndGg7IGkrKykge1xuICAgIHRhcmdldFtpXSA9IHRlbXBbaS10YXJnZXRzdGFydF07XG4gIH1cbn07XG5cblNsb3dCdWZmZXIucHJvdG90eXBlLmZpbGwgPSBmdW5jdGlvbih2YWx1ZSwgc3RhcnQsIGVuZCkge1xuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ29vYicpO1xuICB9XG4gIGlmIChzdGFydCA+IGVuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcignb29iJyk7XG4gIH1cblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHRoaXNbaV0gPSB2YWx1ZTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjb2VyY2UobGVuZ3RoKSB7XG4gIC8vIENvZXJjZSBsZW5ndGggdG8gYSBudW1iZXIgKHBvc3NpYmx5IE5hTiksIHJvdW5kIHVwXG4gIC8vIGluIGNhc2UgaXQncyBmcmFjdGlvbmFsIChlLmcuIDEyMy40NTYpIHRoZW4gZG8gYVxuICAvLyBkb3VibGUgbmVnYXRlIHRvIGNvZXJjZSBhIE5hTiB0byAwLiBFYXN5LCByaWdodD9cbiAgbGVuZ3RoID0gfn5NYXRoLmNlaWwoK2xlbmd0aCk7XG4gIHJldHVybiBsZW5ndGggPCAwID8gMCA6IGxlbmd0aDtcbn1cblxuXG4vLyBCdWZmZXJcblxuZnVuY3Rpb24gQnVmZmVyKHN1YmplY3QsIGVuY29kaW5nLCBvZmZzZXQpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEJ1ZmZlcikpIHtcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZywgb2Zmc2V0KTtcbiAgfVxuXG4gIHZhciB0eXBlO1xuXG4gIC8vIEFyZSB3ZSBzbGljaW5nP1xuICBpZiAodHlwZW9mIG9mZnNldCA9PT0gJ251bWJlcicpIHtcbiAgICB0aGlzLmxlbmd0aCA9IGNvZXJjZShlbmNvZGluZyk7XG4gICAgdGhpcy5wYXJlbnQgPSBzdWJqZWN0O1xuICAgIHRoaXMub2Zmc2V0ID0gb2Zmc2V0O1xuICB9IGVsc2Uge1xuICAgIC8vIEZpbmQgdGhlIGxlbmd0aFxuICAgIHN3aXRjaCAodHlwZSA9IHR5cGVvZiBzdWJqZWN0KSB7XG4gICAgICBjYXNlICdudW1iZXInOlxuICAgICAgICB0aGlzLmxlbmd0aCA9IGNvZXJjZShzdWJqZWN0KTtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICAgIHRoaXMubGVuZ3RoID0gQnVmZmVyLmJ5dGVMZW5ndGgoc3ViamVjdCwgZW5jb2RpbmcpO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAnb2JqZWN0JzogLy8gQXNzdW1lIG9iamVjdCBpcyBhbiBhcnJheVxuICAgICAgICB0aGlzLmxlbmd0aCA9IGNvZXJjZShzdWJqZWN0Lmxlbmd0aCk7XG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpcnN0IGFyZ3VtZW50IG5lZWRzIHRvIGJlIGEgbnVtYmVyLCAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICdhcnJheSBvciBzdHJpbmcuJyk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMubGVuZ3RoID4gQnVmZmVyLnBvb2xTaXplKSB7XG4gICAgICAvLyBCaWcgYnVmZmVyLCBqdXN0IGFsbG9jIG9uZS5cbiAgICAgIHRoaXMucGFyZW50ID0gbmV3IFNsb3dCdWZmZXIodGhpcy5sZW5ndGgpO1xuICAgICAgdGhpcy5vZmZzZXQgPSAwO1xuXG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFNtYWxsIGJ1ZmZlci5cbiAgICAgIGlmICghcG9vbCB8fCBwb29sLmxlbmd0aCAtIHBvb2wudXNlZCA8IHRoaXMubGVuZ3RoKSBhbGxvY1Bvb2woKTtcbiAgICAgIHRoaXMucGFyZW50ID0gcG9vbDtcbiAgICAgIHRoaXMub2Zmc2V0ID0gcG9vbC51c2VkO1xuICAgICAgcG9vbC51c2VkICs9IHRoaXMubGVuZ3RoO1xuICAgIH1cblxuICAgIC8vIFRyZWF0IGFycmF5LWlzaCBvYmplY3RzIGFzIGEgYnl0ZSBhcnJheS5cbiAgICBpZiAoaXNBcnJheUlzaChzdWJqZWN0KSkge1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGlmIChzdWJqZWN0IGluc3RhbmNlb2YgQnVmZmVyKSB7XG4gICAgICAgICAgdGhpcy5wYXJlbnRbaSArIHRoaXMub2Zmc2V0XSA9IHN1YmplY3QucmVhZFVJbnQ4KGkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgIHRoaXMucGFyZW50W2kgKyB0aGlzLm9mZnNldF0gPSBzdWJqZWN0W2ldO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0eXBlID09ICdzdHJpbmcnKSB7XG4gICAgICAvLyBXZSBhcmUgYSBzdHJpbmdcbiAgICAgIHRoaXMubGVuZ3RoID0gdGhpcy53cml0ZShzdWJqZWN0LCAwLCBlbmNvZGluZyk7XG4gICAgfVxuICB9XG5cbn1cblxuZnVuY3Rpb24gaXNBcnJheUlzaChzdWJqZWN0KSB7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KHN1YmplY3QpIHx8IEJ1ZmZlci5pc0J1ZmZlcihzdWJqZWN0KSB8fFxuICAgICAgICAgc3ViamVjdCAmJiB0eXBlb2Ygc3ViamVjdCA9PT0gJ29iamVjdCcgJiZcbiAgICAgICAgIHR5cGVvZiBzdWJqZWN0Lmxlbmd0aCA9PT0gJ251bWJlcic7XG59XG5cbmV4cG9ydHMuU2xvd0J1ZmZlciA9IFNsb3dCdWZmZXI7XG5leHBvcnRzLkJ1ZmZlciA9IEJ1ZmZlcjtcblxuQnVmZmVyLnBvb2xTaXplID0gOCAqIDEwMjQ7XG52YXIgcG9vbDtcblxuZnVuY3Rpb24gYWxsb2NQb29sKCkge1xuICBwb29sID0gbmV3IFNsb3dCdWZmZXIoQnVmZmVyLnBvb2xTaXplKTtcbiAgcG9vbC51c2VkID0gMDtcbn1cblxuXG4vLyBTdGF0aWMgbWV0aG9kc1xuQnVmZmVyLmlzQnVmZmVyID0gZnVuY3Rpb24gaXNCdWZmZXIoYikge1xuICByZXR1cm4gYiBpbnN0YW5jZW9mIEJ1ZmZlciB8fCBiIGluc3RhbmNlb2YgU2xvd0J1ZmZlcjtcbn07XG5cbkJ1ZmZlci5jb25jYXQgPSBmdW5jdGlvbiAobGlzdCwgdG90YWxMZW5ndGgpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KGxpc3QpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiVXNhZ2U6IEJ1ZmZlci5jb25jYXQobGlzdCwgW3RvdGFsTGVuZ3RoXSlcXG4gXFxcbiAgICAgIGxpc3Qgc2hvdWxkIGJlIGFuIEFycmF5LlwiKTtcbiAgfVxuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBuZXcgQnVmZmVyKDApO1xuICB9IGVsc2UgaWYgKGxpc3QubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIGxpc3RbMF07XG4gIH1cblxuICBpZiAodHlwZW9mIHRvdGFsTGVuZ3RoICE9PSAnbnVtYmVyJykge1xuICAgIHRvdGFsTGVuZ3RoID0gMDtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBidWYgPSBsaXN0W2ldO1xuICAgICAgdG90YWxMZW5ndGggKz0gYnVmLmxlbmd0aDtcbiAgICB9XG4gIH1cblxuICB2YXIgYnVmZmVyID0gbmV3IEJ1ZmZlcih0b3RhbExlbmd0aCk7XG4gIHZhciBwb3MgPSAwO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgYnVmID0gbGlzdFtpXTtcbiAgICBidWYuY29weShidWZmZXIsIHBvcyk7XG4gICAgcG9zICs9IGJ1Zi5sZW5ndGg7XG4gIH1cbiAgcmV0dXJuIGJ1ZmZlcjtcbn07XG5cbi8vIEluc3BlY3RcbkJ1ZmZlci5wcm90b3R5cGUuaW5zcGVjdCA9IGZ1bmN0aW9uIGluc3BlY3QoKSB7XG4gIHZhciBvdXQgPSBbXSxcbiAgICAgIGxlbiA9IHRoaXMubGVuZ3RoO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICBvdXRbaV0gPSB0b0hleCh0aGlzLnBhcmVudFtpICsgdGhpcy5vZmZzZXRdKTtcbiAgICBpZiAoaSA9PSBleHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTKSB7XG4gICAgICBvdXRbaSArIDFdID0gJy4uLic7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICByZXR1cm4gJzxCdWZmZXIgJyArIG91dC5qb2luKCcgJykgKyAnPic7XG59O1xuXG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gZ2V0KGkpIHtcbiAgaWYgKGkgPCAwIHx8IGkgPj0gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBFcnJvcignb29iJyk7XG4gIHJldHVybiB0aGlzLnBhcmVudFt0aGlzLm9mZnNldCArIGldO1xufTtcblxuXG5CdWZmZXIucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uIHNldChpLCB2KSB7XG4gIGlmIChpIDwgMCB8fCBpID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgRXJyb3IoJ29vYicpO1xuICByZXR1cm4gdGhpcy5wYXJlbnRbdGhpcy5vZmZzZXQgKyBpXSA9IHY7XG59O1xuXG5cbi8vIHdyaXRlKHN0cmluZywgb2Zmc2V0ID0gMCwgbGVuZ3RoID0gYnVmZmVyLmxlbmd0aC1vZmZzZXQsIGVuY29kaW5nID0gJ3V0ZjgnKVxuQnVmZmVyLnByb3RvdHlwZS53cml0ZSA9IGZ1bmN0aW9uKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKSB7XG4gIC8vIFN1cHBvcnQgYm90aCAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpXG4gIC8vIGFuZCB0aGUgbGVnYWN5IChzdHJpbmcsIGVuY29kaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBpZiAoIWlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGVuY29kaW5nID0gbGVuZ3RoO1xuICAgICAgbGVuZ3RoID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgfSBlbHNlIHsgIC8vIGxlZ2FjeVxuICAgIHZhciBzd2FwID0gZW5jb2Rpbmc7XG4gICAgZW5jb2RpbmcgPSBvZmZzZXQ7XG4gICAgb2Zmc2V0ID0gbGVuZ3RoO1xuICAgIGxlbmd0aCA9IHN3YXA7XG4gIH1cblxuICBvZmZzZXQgPSArb2Zmc2V0IHx8IDA7XG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldDtcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmc7XG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gK2xlbmd0aDtcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmc7XG4gICAgfVxuICB9XG4gIGVuY29kaW5nID0gU3RyaW5nKGVuY29kaW5nIHx8ICd1dGY4JykudG9Mb3dlckNhc2UoKTtcblxuICB2YXIgcmV0O1xuICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldCA9IHRoaXMucGFyZW50LmhleFdyaXRlKHN0cmluZywgdGhpcy5vZmZzZXQgKyBvZmZzZXQsIGxlbmd0aCk7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgIHJldCA9IHRoaXMucGFyZW50LnV0ZjhXcml0ZShzdHJpbmcsIHRoaXMub2Zmc2V0ICsgb2Zmc2V0LCBsZW5ndGgpO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICdhc2NpaSc6XG4gICAgICByZXQgPSB0aGlzLnBhcmVudC5hc2NpaVdyaXRlKHN0cmluZywgdGhpcy5vZmZzZXQgKyBvZmZzZXQsIGxlbmd0aCk7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICByZXQgPSB0aGlzLnBhcmVudC5iaW5hcnlXcml0ZShzdHJpbmcsIHRoaXMub2Zmc2V0ICsgb2Zmc2V0LCBsZW5ndGgpO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgLy8gV2FybmluZzogbWF4TGVuZ3RoIG5vdCB0YWtlbiBpbnRvIGFjY291bnQgaW4gYmFzZTY0V3JpdGVcbiAgICAgIHJldCA9IHRoaXMucGFyZW50LmJhc2U2NFdyaXRlKHN0cmluZywgdGhpcy5vZmZzZXQgKyBvZmZzZXQsIGxlbmd0aCk7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIHJldCA9IHRoaXMucGFyZW50LnVjczJXcml0ZShzdHJpbmcsIHRoaXMub2Zmc2V0ICsgb2Zmc2V0LCBsZW5ndGgpO1xuICAgICAgYnJlYWs7XG5cbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIGVuY29kaW5nJyk7XG4gIH1cblxuICBCdWZmZXIuX2NoYXJzV3JpdHRlbiA9IFNsb3dCdWZmZXIuX2NoYXJzV3JpdHRlbjtcblxuICByZXR1cm4gcmV0O1xufTtcblxuXG4vLyB0b1N0cmluZyhlbmNvZGluZywgc3RhcnQ9MCwgZW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oZW5jb2RpbmcsIHN0YXJ0LCBlbmQpIHtcbiAgZW5jb2RpbmcgPSBTdHJpbmcoZW5jb2RpbmcgfHwgJ3V0ZjgnKS50b0xvd2VyQ2FzZSgpO1xuXG4gIGlmICh0eXBlb2Ygc3RhcnQgPT0gJ3VuZGVmaW5lZCcgfHwgc3RhcnQgPCAwKSB7XG4gICAgc3RhcnQgPSAwO1xuICB9IGVsc2UgaWYgKHN0YXJ0ID4gdGhpcy5sZW5ndGgpIHtcbiAgICBzdGFydCA9IHRoaXMubGVuZ3RoO1xuICB9XG5cbiAgaWYgKHR5cGVvZiBlbmQgPT0gJ3VuZGVmaW5lZCcgfHwgZW5kID4gdGhpcy5sZW5ndGgpIHtcbiAgICBlbmQgPSB0aGlzLmxlbmd0aDtcbiAgfSBlbHNlIGlmIChlbmQgPCAwKSB7XG4gICAgZW5kID0gMDtcbiAgfVxuXG4gIHN0YXJ0ID0gc3RhcnQgKyB0aGlzLm9mZnNldDtcbiAgZW5kID0gZW5kICsgdGhpcy5vZmZzZXQ7XG5cbiAgc3dpdGNoIChlbmNvZGluZykge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgICByZXR1cm4gdGhpcy5wYXJlbnQuaGV4U2xpY2Uoc3RhcnQsIGVuZCk7XG5cbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgICByZXR1cm4gdGhpcy5wYXJlbnQudXRmOFNsaWNlKHN0YXJ0LCBlbmQpO1xuXG4gICAgY2FzZSAnYXNjaWknOlxuICAgICAgcmV0dXJuIHRoaXMucGFyZW50LmFzY2lpU2xpY2Uoc3RhcnQsIGVuZCk7XG5cbiAgICBjYXNlICdiaW5hcnknOlxuICAgICAgcmV0dXJuIHRoaXMucGFyZW50LmJpbmFyeVNsaWNlKHN0YXJ0LCBlbmQpO1xuXG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgIHJldHVybiB0aGlzLnBhcmVudC5iYXNlNjRTbGljZShzdGFydCwgZW5kKTtcblxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIHJldHVybiB0aGlzLnBhcmVudC51Y3MyU2xpY2Uoc3RhcnQsIGVuZCk7XG5cbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIGVuY29kaW5nJyk7XG4gIH1cbn07XG5cblxuLy8gYnl0ZUxlbmd0aFxuQnVmZmVyLmJ5dGVMZW5ndGggPSBTbG93QnVmZmVyLmJ5dGVMZW5ndGg7XG5cblxuLy8gZmlsbCh2YWx1ZSwgc3RhcnQ9MCwgZW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmZpbGwgPSBmdW5jdGlvbiBmaWxsKHZhbHVlLCBzdGFydCwgZW5kKSB7XG4gIHZhbHVlIHx8ICh2YWx1ZSA9IDApO1xuICBzdGFydCB8fCAoc3RhcnQgPSAwKTtcbiAgZW5kIHx8IChlbmQgPSB0aGlzLmxlbmd0aCk7XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB2YWx1ZSA9IHZhbHVlLmNoYXJDb2RlQXQoMCk7XG4gIH1cbiAgaWYgKCEodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykgfHwgaXNOYU4odmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCd2YWx1ZSBpcyBub3QgYSBudW1iZXInKTtcbiAgfVxuXG4gIGlmIChlbmQgPCBzdGFydCkgdGhyb3cgbmV3IEVycm9yKCdlbmQgPCBzdGFydCcpO1xuXG4gIC8vIEZpbGwgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuIDA7XG4gIGlmICh0aGlzLmxlbmd0aCA9PSAwKSByZXR1cm4gMDtcblxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzdGFydCBvdXQgb2YgYm91bmRzJyk7XG4gIH1cblxuICBpZiAoZW5kIDwgMCB8fCBlbmQgPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBFcnJvcignZW5kIG91dCBvZiBib3VuZHMnKTtcbiAgfVxuXG4gIHJldHVybiB0aGlzLnBhcmVudC5maWxsKHZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBzdGFydCArIHRoaXMub2Zmc2V0LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBlbmQgKyB0aGlzLm9mZnNldCk7XG59O1xuXG5cbi8vIGNvcHkodGFyZ2V0QnVmZmVyLCB0YXJnZXRTdGFydD0wLCBzb3VyY2VTdGFydD0wLCBzb3VyY2VFbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKHRhcmdldCwgdGFyZ2V0X3N0YXJ0LCBzdGFydCwgZW5kKSB7XG4gIHZhciBzb3VyY2UgPSB0aGlzO1xuICBzdGFydCB8fCAoc3RhcnQgPSAwKTtcbiAgZW5kIHx8IChlbmQgPSB0aGlzLmxlbmd0aCk7XG4gIHRhcmdldF9zdGFydCB8fCAodGFyZ2V0X3N0YXJ0ID0gMCk7XG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSB0aHJvdyBuZXcgRXJyb3IoJ3NvdXJjZUVuZCA8IHNvdXJjZVN0YXJ0Jyk7XG5cbiAgLy8gQ29weSAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm4gMDtcbiAgaWYgKHRhcmdldC5sZW5ndGggPT0gMCB8fCBzb3VyY2UubGVuZ3RoID09IDApIHJldHVybiAwO1xuXG4gIGlmICh0YXJnZXRfc3RhcnQgPCAwIHx8IHRhcmdldF9zdGFydCA+PSB0YXJnZXQubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCd0YXJnZXRTdGFydCBvdXQgb2YgYm91bmRzJyk7XG4gIH1cblxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHNvdXJjZS5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3NvdXJjZVN0YXJ0IG91dCBvZiBib3VuZHMnKTtcbiAgfVxuXG4gIGlmIChlbmQgPCAwIHx8IGVuZCA+IHNvdXJjZS5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3NvdXJjZUVuZCBvdXQgb2YgYm91bmRzJyk7XG4gIH1cblxuICAvLyBBcmUgd2Ugb29iP1xuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpIHtcbiAgICBlbmQgPSB0aGlzLmxlbmd0aDtcbiAgfVxuXG4gIGlmICh0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0X3N0YXJ0IDwgZW5kIC0gc3RhcnQpIHtcbiAgICBlbmQgPSB0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0X3N0YXJ0ICsgc3RhcnQ7XG4gIH1cblxuICByZXR1cm4gdGhpcy5wYXJlbnQuY29weSh0YXJnZXQucGFyZW50LFxuICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRfc3RhcnQgKyB0YXJnZXQub2Zmc2V0LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBzdGFydCArIHRoaXMub2Zmc2V0LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBlbmQgKyB0aGlzLm9mZnNldCk7XG59O1xuXG5cbi8vIHNsaWNlKHN0YXJ0LCBlbmQpXG5CdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24oc3RhcnQsIGVuZCkge1xuICBpZiAoZW5kID09PSB1bmRlZmluZWQpIGVuZCA9IHRoaXMubGVuZ3RoO1xuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBFcnJvcignb29iJyk7XG4gIGlmIChzdGFydCA+IGVuZCkgdGhyb3cgbmV3IEVycm9yKCdvb2InKTtcblxuICByZXR1cm4gbmV3IEJ1ZmZlcih0aGlzLnBhcmVudCwgZW5kIC0gc3RhcnQsICtzdGFydCArIHRoaXMub2Zmc2V0KTtcbn07XG5cblxuLy8gTGVnYWN5IG1ldGhvZHMgZm9yIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5LlxuXG5CdWZmZXIucHJvdG90eXBlLnV0ZjhTbGljZSA9IGZ1bmN0aW9uKHN0YXJ0LCBlbmQpIHtcbiAgcmV0dXJuIHRoaXMudG9TdHJpbmcoJ3V0ZjgnLCBzdGFydCwgZW5kKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuYmluYXJ5U2xpY2UgPSBmdW5jdGlvbihzdGFydCwgZW5kKSB7XG4gIHJldHVybiB0aGlzLnRvU3RyaW5nKCdiaW5hcnknLCBzdGFydCwgZW5kKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuYXNjaWlTbGljZSA9IGZ1bmN0aW9uKHN0YXJ0LCBlbmQpIHtcbiAgcmV0dXJuIHRoaXMudG9TdHJpbmcoJ2FzY2lpJywgc3RhcnQsIGVuZCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnV0ZjhXcml0ZSA9IGZ1bmN0aW9uKHN0cmluZywgb2Zmc2V0KSB7XG4gIHJldHVybiB0aGlzLndyaXRlKHN0cmluZywgb2Zmc2V0LCAndXRmOCcpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5iaW5hcnlXcml0ZSA9IGZ1bmN0aW9uKHN0cmluZywgb2Zmc2V0KSB7XG4gIHJldHVybiB0aGlzLndyaXRlKHN0cmluZywgb2Zmc2V0LCAnYmluYXJ5Jyk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmFzY2lpV3JpdGUgPSBmdW5jdGlvbihzdHJpbmcsIG9mZnNldCkge1xuICByZXR1cm4gdGhpcy53cml0ZShzdHJpbmcsIG9mZnNldCwgJ2FzY2lpJyk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50OCA9IGZ1bmN0aW9uKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFyIGJ1ZmZlciA9IHRoaXM7XG5cbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydC5vayhvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsXG4gICAgICAgICdtaXNzaW5nIG9mZnNldCcpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCA8IGJ1ZmZlci5sZW5ndGgsXG4gICAgICAgICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpO1xuICB9XG5cbiAgaWYgKG9mZnNldCA+PSBidWZmZXIubGVuZ3RoKSByZXR1cm47XG5cbiAgcmV0dXJuIGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldF07XG59O1xuXG5mdW5jdGlvbiByZWFkVUludDE2KGJ1ZmZlciwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgdmFyIHZhbCA9IDA7XG5cblxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0Lm9rKHR5cGVvZiAoaXNCaWdFbmRpYW4pID09PSAnYm9vbGVhbicsXG4gICAgICAgICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyBvZmZzZXQnKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgKyAxIDwgYnVmZmVyLmxlbmd0aCxcbiAgICAgICAgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJyk7XG4gIH1cblxuICBpZiAob2Zmc2V0ID49IGJ1ZmZlci5sZW5ndGgpIHJldHVybiAwO1xuXG4gIGlmIChpc0JpZ0VuZGlhbikge1xuICAgIHZhbCA9IGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldF0gPDwgODtcbiAgICBpZiAob2Zmc2V0ICsgMSA8IGJ1ZmZlci5sZW5ndGgpIHtcbiAgICAgIHZhbCB8PSBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXQgKyAxXTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdmFsID0gYnVmZmVyLnBhcmVudFtidWZmZXIub2Zmc2V0ICsgb2Zmc2V0XTtcbiAgICBpZiAob2Zmc2V0ICsgMSA8IGJ1ZmZlci5sZW5ndGgpIHtcbiAgICAgIHZhbCB8PSBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXQgKyAxXSA8PCA4O1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB2YWw7XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkxFID0gZnVuY3Rpb24ob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gcmVhZFVJbnQxNih0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZCRSA9IGZ1bmN0aW9uKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHJlYWRVSW50MTYodGhpcywgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydCk7XG59O1xuXG5mdW5jdGlvbiByZWFkVUludDMyKGJ1ZmZlciwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgdmFyIHZhbCA9IDA7XG5cbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydC5vayh0eXBlb2YgKGlzQmlnRW5kaWFuKSA9PT0gJ2Jvb2xlYW4nLFxuICAgICAgICAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCxcbiAgICAgICAgJ21pc3Npbmcgb2Zmc2V0Jyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICsgMyA8IGJ1ZmZlci5sZW5ndGgsXG4gICAgICAgICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpO1xuICB9XG5cbiAgaWYgKG9mZnNldCA+PSBidWZmZXIubGVuZ3RoKSByZXR1cm4gMDtcblxuICBpZiAoaXNCaWdFbmRpYW4pIHtcbiAgICBpZiAob2Zmc2V0ICsgMSA8IGJ1ZmZlci5sZW5ndGgpXG4gICAgICB2YWwgPSBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXQgKyAxXSA8PCAxNjtcbiAgICBpZiAob2Zmc2V0ICsgMiA8IGJ1ZmZlci5sZW5ndGgpXG4gICAgICB2YWwgfD0gYnVmZmVyLnBhcmVudFtidWZmZXIub2Zmc2V0ICsgb2Zmc2V0ICsgMl0gPDwgODtcbiAgICBpZiAob2Zmc2V0ICsgMyA8IGJ1ZmZlci5sZW5ndGgpXG4gICAgICB2YWwgfD0gYnVmZmVyLnBhcmVudFtidWZmZXIub2Zmc2V0ICsgb2Zmc2V0ICsgM107XG4gICAgdmFsID0gdmFsICsgKGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldF0gPDwgMjQgPj4+IDApO1xuICB9IGVsc2Uge1xuICAgIGlmIChvZmZzZXQgKyAyIDwgYnVmZmVyLmxlbmd0aClcbiAgICAgIHZhbCA9IGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldCArIDJdIDw8IDE2O1xuICAgIGlmIChvZmZzZXQgKyAxIDwgYnVmZmVyLmxlbmd0aClcbiAgICAgIHZhbCB8PSBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXQgKyAxXSA8PCA4O1xuICAgIHZhbCB8PSBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXRdO1xuICAgIGlmIChvZmZzZXQgKyAzIDwgYnVmZmVyLmxlbmd0aClcbiAgICAgIHZhbCA9IHZhbCArIChidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXQgKyAzXSA8PCAyNCA+Pj4gMCk7XG4gIH1cblxuICByZXR1cm4gdmFsO1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJMRSA9IGZ1bmN0aW9uKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHJlYWRVSW50MzIodGhpcywgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyQkUgPSBmdW5jdGlvbihvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiByZWFkVUludDMyKHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpO1xufTtcblxuXG4vKlxuICogU2lnbmVkIGludGVnZXIgdHlwZXMsIHlheSB0ZWFtISBBIHJlbWluZGVyIG9uIGhvdyB0d28ncyBjb21wbGVtZW50IGFjdHVhbGx5XG4gKiB3b3Jrcy4gVGhlIGZpcnN0IGJpdCBpcyB0aGUgc2lnbmVkIGJpdCwgaS5lLiB0ZWxscyB1cyB3aGV0aGVyIG9yIG5vdCB0aGVcbiAqIG51bWJlciBzaG91bGQgYmUgcG9zaXRpdmUgb3IgbmVnYXRpdmUuIElmIHRoZSB0d28ncyBjb21wbGVtZW50IHZhbHVlIGlzXG4gKiBwb3NpdGl2ZSwgdGhlbiB3ZSdyZSBkb25lLCBhcyBpdCdzIGVxdWl2YWxlbnQgdG8gdGhlIHVuc2lnbmVkIHJlcHJlc2VudGF0aW9uLlxuICpcbiAqIE5vdyBpZiB0aGUgbnVtYmVyIGlzIHBvc2l0aXZlLCB5b3UncmUgcHJldHR5IG11Y2ggZG9uZSwgeW91IGNhbiBqdXN0IGxldmVyYWdlXG4gKiB0aGUgdW5zaWduZWQgdHJhbnNsYXRpb25zIGFuZCByZXR1cm4gdGhvc2UuIFVuZm9ydHVuYXRlbHksIG5lZ2F0aXZlIG51bWJlcnNcbiAqIGFyZW4ndCBxdWl0ZSB0aGF0IHN0cmFpZ2h0Zm9yd2FyZC5cbiAqXG4gKiBBdCBmaXJzdCBnbGFuY2UsIG9uZSBtaWdodCBiZSBpbmNsaW5lZCB0byB1c2UgdGhlIHRyYWRpdGlvbmFsIGZvcm11bGEgdG9cbiAqIHRyYW5zbGF0ZSBiaW5hcnkgbnVtYmVycyBiZXR3ZWVuIHRoZSBwb3NpdGl2ZSBhbmQgbmVnYXRpdmUgdmFsdWVzIGluIHR3bydzXG4gKiBjb21wbGVtZW50LiAoVGhvdWdoIGl0IGRvZXNuJ3QgcXVpdGUgd29yayBmb3IgdGhlIG1vc3QgbmVnYXRpdmUgdmFsdWUpXG4gKiBNYWlubHk6XG4gKiAgLSBpbnZlcnQgYWxsIHRoZSBiaXRzXG4gKiAgLSBhZGQgb25lIHRvIHRoZSByZXN1bHRcbiAqXG4gKiBPZiBjb3Vyc2UsIHRoaXMgZG9lc24ndCBxdWl0ZSB3b3JrIGluIEphdmFzY3JpcHQuIFRha2UgZm9yIGV4YW1wbGUgdGhlIHZhbHVlXG4gKiBvZiAtMTI4LiBUaGlzIGNvdWxkIGJlIHJlcHJlc2VudGVkIGluIDE2IGJpdHMgKGJpZy1lbmRpYW4pIGFzIDB4ZmY4MC4gQnV0IG9mXG4gKiBjb3Vyc2UsIEphdmFzY3JpcHQgd2lsbCBkbyB0aGUgZm9sbG93aW5nOlxuICpcbiAqID4gfjB4ZmY4MFxuICogLTY1NDA5XG4gKlxuICogV2hvaCB0aGVyZSwgSmF2YXNjcmlwdCwgdGhhdCdzIG5vdCBxdWl0ZSByaWdodC4gQnV0IHdhaXQsIGFjY29yZGluZyB0b1xuICogSmF2YXNjcmlwdCB0aGF0J3MgcGVyZmVjdGx5IGNvcnJlY3QuIFdoZW4gSmF2YXNjcmlwdCBlbmRzIHVwIHNlZWluZyB0aGVcbiAqIGNvbnN0YW50IDB4ZmY4MCwgaXQgaGFzIG5vIG5vdGlvbiB0aGF0IGl0IGlzIGFjdHVhbGx5IGEgc2lnbmVkIG51bWJlci4gSXRcbiAqIGFzc3VtZXMgdGhhdCB3ZSd2ZSBpbnB1dCB0aGUgdW5zaWduZWQgdmFsdWUgMHhmZjgwLiBUaHVzLCB3aGVuIGl0IGRvZXMgdGhlXG4gKiBiaW5hcnkgbmVnYXRpb24sIGl0IGNhc3RzIGl0IGludG8gYSBzaWduZWQgdmFsdWUsIChwb3NpdGl2ZSAweGZmODApLiBUaGVuXG4gKiB3aGVuIHlvdSBwZXJmb3JtIGJpbmFyeSBuZWdhdGlvbiBvbiB0aGF0LCBpdCB0dXJucyBpdCBpbnRvIGEgbmVnYXRpdmUgbnVtYmVyLlxuICpcbiAqIEluc3RlYWQsIHdlJ3JlIGdvaW5nIHRvIGhhdmUgdG8gdXNlIHRoZSBmb2xsb3dpbmcgZ2VuZXJhbCBmb3JtdWxhLCB0aGF0IHdvcmtzXG4gKiBpbiBhIHJhdGhlciBKYXZhc2NyaXB0IGZyaWVuZGx5IHdheS4gSSdtIGdsYWQgd2UgZG9uJ3Qgc3VwcG9ydCB0aGlzIGtpbmQgb2ZcbiAqIHdlaXJkIG51bWJlcmluZyBzY2hlbWUgaW4gdGhlIGtlcm5lbC5cbiAqXG4gKiAoQklULU1BWCAtICh1bnNpZ25lZCl2YWwgKyAxKSAqIC0xXG4gKlxuICogVGhlIGFzdHV0ZSBvYnNlcnZlciwgbWF5IHRoaW5rIHRoYXQgdGhpcyBkb2Vzbid0IG1ha2Ugc2Vuc2UgZm9yIDgtYml0IG51bWJlcnNcbiAqIChyZWFsbHkgaXQgaXNuJ3QgbmVjZXNzYXJ5IGZvciB0aGVtKS4gSG93ZXZlciwgd2hlbiB5b3UgZ2V0IDE2LWJpdCBudW1iZXJzLFxuICogeW91IGRvLiBMZXQncyBnbyBiYWNrIHRvIG91ciBwcmlvciBleGFtcGxlIGFuZCBzZWUgaG93IHRoaXMgd2lsbCBsb29rOlxuICpcbiAqICgweGZmZmYgLSAweGZmODAgKyAxKSAqIC0xXG4gKiAoMHgwMDdmICsgMSkgKiAtMVxuICogKDB4MDA4MCkgKiAtMVxuICovXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQ4ID0gZnVuY3Rpb24ob2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YXIgYnVmZmVyID0gdGhpcztcbiAgdmFyIG5lZztcblxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0Lm9rKG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCxcbiAgICAgICAgJ21pc3Npbmcgb2Zmc2V0Jyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0IDwgYnVmZmVyLmxlbmd0aCxcbiAgICAgICAgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJyk7XG4gIH1cblxuICBpZiAob2Zmc2V0ID49IGJ1ZmZlci5sZW5ndGgpIHJldHVybjtcblxuICBuZWcgPSBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXRdICYgMHg4MDtcbiAgaWYgKCFuZWcpIHtcbiAgICByZXR1cm4gKGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldF0pO1xuICB9XG5cbiAgcmV0dXJuICgoMHhmZiAtIGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldF0gKyAxKSAqIC0xKTtcbn07XG5cbmZ1bmN0aW9uIHJlYWRJbnQxNihidWZmZXIsIG9mZnNldCwgaXNCaWdFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIHZhciBuZWcsIHZhbDtcblxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0Lm9rKHR5cGVvZiAoaXNCaWdFbmRpYW4pID09PSAnYm9vbGVhbicsXG4gICAgICAgICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyBvZmZzZXQnKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgKyAxIDwgYnVmZmVyLmxlbmd0aCxcbiAgICAgICAgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJyk7XG4gIH1cblxuICB2YWwgPSByZWFkVUludDE2KGJ1ZmZlciwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpO1xuICBuZWcgPSB2YWwgJiAweDgwMDA7XG4gIGlmICghbmVnKSB7XG4gICAgcmV0dXJuIHZhbDtcbiAgfVxuXG4gIHJldHVybiAoMHhmZmZmIC0gdmFsICsgMSkgKiAtMTtcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZMRSA9IGZ1bmN0aW9uKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHJlYWRJbnQxNih0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkJFID0gZnVuY3Rpb24ob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gcmVhZEludDE2KHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpO1xufTtcblxuZnVuY3Rpb24gcmVhZEludDMyKGJ1ZmZlciwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgdmFyIG5lZywgdmFsO1xuXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQub2sodHlwZW9mIChpc0JpZ0VuZGlhbikgPT09ICdib29sZWFuJyxcbiAgICAgICAgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsXG4gICAgICAgICdtaXNzaW5nIG9mZnNldCcpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCArIDMgPCBidWZmZXIubGVuZ3RoLFxuICAgICAgICAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKTtcbiAgfVxuXG4gIHZhbCA9IHJlYWRVSW50MzIoYnVmZmVyLCBvZmZzZXQsIGlzQmlnRW5kaWFuLCBub0Fzc2VydCk7XG4gIG5lZyA9IHZhbCAmIDB4ODAwMDAwMDA7XG4gIGlmICghbmVnKSB7XG4gICAgcmV0dXJuICh2YWwpO1xuICB9XG5cbiAgcmV0dXJuICgweGZmZmZmZmZmIC0gdmFsICsgMSkgKiAtMTtcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJMRSA9IGZ1bmN0aW9uKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHJlYWRJbnQzMih0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkJFID0gZnVuY3Rpb24ob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gcmVhZEludDMyKHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpO1xufTtcblxuZnVuY3Rpb24gcmVhZEZsb2F0KGJ1ZmZlciwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydC5vayh0eXBlb2YgKGlzQmlnRW5kaWFuKSA9PT0gJ2Jvb2xlYW4nLFxuICAgICAgICAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCArIDMgPCBidWZmZXIubGVuZ3RoLFxuICAgICAgICAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKTtcbiAgfVxuXG4gIHJldHVybiByZXF1aXJlKCcuL2J1ZmZlcl9pZWVlNzU0JykucmVhZElFRUU3NTQoYnVmZmVyLCBvZmZzZXQsIGlzQmlnRW5kaWFuLFxuICAgICAgMjMsIDQpO1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdExFID0gZnVuY3Rpb24ob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gcmVhZEZsb2F0KHRoaXMsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBmdW5jdGlvbihvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiByZWFkRmxvYXQodGhpcywgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydCk7XG59O1xuXG5mdW5jdGlvbiByZWFkRG91YmxlKGJ1ZmZlciwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydC5vayh0eXBlb2YgKGlzQmlnRW5kaWFuKSA9PT0gJ2Jvb2xlYW4nLFxuICAgICAgICAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCArIDcgPCBidWZmZXIubGVuZ3RoLFxuICAgICAgICAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKTtcbiAgfVxuXG4gIHJldHVybiByZXF1aXJlKCcuL2J1ZmZlcl9pZWVlNzU0JykucmVhZElFRUU3NTQoYnVmZmVyLCBvZmZzZXQsIGlzQmlnRW5kaWFuLFxuICAgICAgNTIsIDgpO1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRSA9IGZ1bmN0aW9uKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHJlYWREb3VibGUodGhpcywgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlQkUgPSBmdW5jdGlvbihvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiByZWFkRG91YmxlKHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpO1xufTtcblxuXG4vKlxuICogV2UgaGF2ZSB0byBtYWtlIHN1cmUgdGhhdCB0aGUgdmFsdWUgaXMgYSB2YWxpZCBpbnRlZ2VyLiBUaGlzIG1lYW5zIHRoYXQgaXQgaXNcbiAqIG5vbi1uZWdhdGl2ZS4gSXQgaGFzIG5vIGZyYWN0aW9uYWwgY29tcG9uZW50IGFuZCB0aGF0IGl0IGRvZXMgbm90IGV4Y2VlZCB0aGVcbiAqIG1heGltdW0gYWxsb3dlZCB2YWx1ZS5cbiAqXG4gKiAgICAgIHZhbHVlICAgICAgICAgICBUaGUgbnVtYmVyIHRvIGNoZWNrIGZvciB2YWxpZGl0eVxuICpcbiAqICAgICAgbWF4ICAgICAgICAgICAgIFRoZSBtYXhpbXVtIHZhbHVlXG4gKi9cbmZ1bmN0aW9uIHZlcmlmdWludCh2YWx1ZSwgbWF4KSB7XG4gIGFzc2VydC5vayh0eXBlb2YgKHZhbHVlKSA9PSAnbnVtYmVyJyxcbiAgICAgICdjYW5ub3Qgd3JpdGUgYSBub24tbnVtYmVyIGFzIGEgbnVtYmVyJyk7XG5cbiAgYXNzZXJ0Lm9rKHZhbHVlID49IDAsXG4gICAgICAnc3BlY2lmaWVkIGEgbmVnYXRpdmUgdmFsdWUgZm9yIHdyaXRpbmcgYW4gdW5zaWduZWQgdmFsdWUnKTtcblxuICBhc3NlcnQub2sodmFsdWUgPD0gbWF4LCAndmFsdWUgaXMgbGFyZ2VyIHRoYW4gbWF4aW11bSB2YWx1ZSBmb3IgdHlwZScpO1xuXG4gIGFzc2VydC5vayhNYXRoLmZsb29yKHZhbHVlKSA9PT0gdmFsdWUsICd2YWx1ZSBoYXMgYSBmcmFjdGlvbmFsIGNvbXBvbmVudCcpO1xufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDggPSBmdW5jdGlvbih2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YXIgYnVmZmVyID0gdGhpcztcblxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0Lm9rKHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsXG4gICAgICAgICdtaXNzaW5nIHZhbHVlJyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyBvZmZzZXQnKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgPCBidWZmZXIubGVuZ3RoLFxuICAgICAgICAndHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJyk7XG5cbiAgICB2ZXJpZnVpbnQodmFsdWUsIDB4ZmYpO1xuICB9XG5cbiAgaWYgKG9mZnNldCA8IGJ1ZmZlci5sZW5ndGgpIHtcbiAgICBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXRdID0gdmFsdWU7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIHdyaXRlVUludDE2KGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNCaWdFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQub2sodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCxcbiAgICAgICAgJ21pc3NpbmcgdmFsdWUnKTtcblxuICAgIGFzc2VydC5vayh0eXBlb2YgKGlzQmlnRW5kaWFuKSA9PT0gJ2Jvb2xlYW4nLFxuICAgICAgICAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCxcbiAgICAgICAgJ21pc3Npbmcgb2Zmc2V0Jyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICsgMSA8IGJ1ZmZlci5sZW5ndGgsXG4gICAgICAgICd0cnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKTtcblxuICAgIHZlcmlmdWludCh2YWx1ZSwgMHhmZmZmKTtcbiAgfVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgTWF0aC5taW4oYnVmZmVyLmxlbmd0aCAtIG9mZnNldCwgMik7IGkrKykge1xuICAgIGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldCArIGldID1cbiAgICAgICAgKHZhbHVlICYgKDB4ZmYgPDwgKDggKiAoaXNCaWdFbmRpYW4gPyAxIC0gaSA6IGkpKSkpID4+PlxuICAgICAgICAgICAgKGlzQmlnRW5kaWFuID8gMSAtIGkgOiBpKSAqIDg7XG4gIH1cblxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2TEUgPSBmdW5jdGlvbih2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB3cml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkJFID0gZnVuY3Rpb24odmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgd3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpO1xufTtcblxuZnVuY3Rpb24gd3JpdGVVSW50MzIoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydC5vayh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyB2YWx1ZScpO1xuXG4gICAgYXNzZXJ0Lm9rKHR5cGVvZiAoaXNCaWdFbmRpYW4pID09PSAnYm9vbGVhbicsXG4gICAgICAgICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyBvZmZzZXQnKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgKyAzIDwgYnVmZmVyLmxlbmd0aCxcbiAgICAgICAgJ3RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpO1xuXG4gICAgdmVyaWZ1aW50KHZhbHVlLCAweGZmZmZmZmZmKTtcbiAgfVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgTWF0aC5taW4oYnVmZmVyLmxlbmd0aCAtIG9mZnNldCwgNCk7IGkrKykge1xuICAgIGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldCArIGldID1cbiAgICAgICAgKHZhbHVlID4+PiAoaXNCaWdFbmRpYW4gPyAzIC0gaSA6IGkpICogOCkgJiAweGZmO1xuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRSA9IGZ1bmN0aW9uKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyQkUgPSBmdW5jdGlvbih2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB3cml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydCk7XG59O1xuXG5cbi8qXG4gKiBXZSBub3cgbW92ZSBvbnRvIG91ciBmcmllbmRzIGluIHRoZSBzaWduZWQgbnVtYmVyIGNhdGVnb3J5LiBVbmxpa2UgdW5zaWduZWRcbiAqIG51bWJlcnMsIHdlJ3JlIGdvaW5nIHRvIGhhdmUgdG8gd29ycnkgYSBiaXQgbW9yZSBhYm91dCBob3cgd2UgcHV0IHZhbHVlcyBpbnRvXG4gKiBhcnJheXMuIFNpbmNlIHdlIGFyZSBvbmx5IHdvcnJ5aW5nIGFib3V0IHNpZ25lZCAzMi1iaXQgdmFsdWVzLCB3ZSdyZSBpblxuICogc2xpZ2h0bHkgYmV0dGVyIHNoYXBlLiBVbmZvcnR1bmF0ZWx5LCB3ZSByZWFsbHkgY2FuJ3QgZG8gb3VyIGZhdm9yaXRlIGJpbmFyeVxuICogJiBpbiB0aGlzIHN5c3RlbS4gSXQgcmVhbGx5IHNlZW1zIHRvIGRvIHRoZSB3cm9uZyB0aGluZy4gRm9yIGV4YW1wbGU6XG4gKlxuICogPiAtMzIgJiAweGZmXG4gKiAyMjRcbiAqXG4gKiBXaGF0J3MgaGFwcGVuaW5nIGFib3ZlIGlzIHJlYWxseTogMHhlMCAmIDB4ZmYgPSAweGUwLiBIb3dldmVyLCB0aGUgcmVzdWx0cyBvZlxuICogdGhpcyBhcmVuJ3QgdHJlYXRlZCBhcyBhIHNpZ25lZCBudW1iZXIuIFVsdGltYXRlbHkgYSBiYWQgdGhpbmcuXG4gKlxuICogV2hhdCB3ZSdyZSBnb2luZyB0byB3YW50IHRvIGRvIGlzIGJhc2ljYWxseSBjcmVhdGUgdGhlIHVuc2lnbmVkIGVxdWl2YWxlbnQgb2ZcbiAqIG91ciByZXByZXNlbnRhdGlvbiBhbmQgcGFzcyB0aGF0IG9mZiB0byB0aGUgd3VpbnQqIGZ1bmN0aW9ucy4gVG8gZG8gdGhhdFxuICogd2UncmUgZ29pbmcgdG8gZG8gdGhlIGZvbGxvd2luZzpcbiAqXG4gKiAgLSBpZiB0aGUgdmFsdWUgaXMgcG9zaXRpdmVcbiAqICAgICAgd2UgY2FuIHBhc3MgaXQgZGlyZWN0bHkgb2ZmIHRvIHRoZSBlcXVpdmFsZW50IHd1aW50XG4gKiAgLSBpZiB0aGUgdmFsdWUgaXMgbmVnYXRpdmVcbiAqICAgICAgd2UgZG8gdGhlIGZvbGxvd2luZyBjb21wdXRhdGlvbjpcbiAqICAgICAgICAgbWIgKyB2YWwgKyAxLCB3aGVyZVxuICogICAgICAgICBtYiAgIGlzIHRoZSBtYXhpbXVtIHVuc2lnbmVkIHZhbHVlIGluIHRoYXQgYnl0ZSBzaXplXG4gKiAgICAgICAgIHZhbCAgaXMgdGhlIEphdmFzY3JpcHQgbmVnYXRpdmUgaW50ZWdlclxuICpcbiAqXG4gKiBBcyBhIGNvbmNyZXRlIHZhbHVlLCB0YWtlIC0xMjguIEluIHNpZ25lZCAxNiBiaXRzIHRoaXMgd291bGQgYmUgMHhmZjgwLiBJZlxuICogeW91IGRvIG91dCB0aGUgY29tcHV0YXRpb25zOlxuICpcbiAqIDB4ZmZmZiAtIDEyOCArIDFcbiAqIDB4ZmZmZiAtIDEyN1xuICogMHhmZjgwXG4gKlxuICogWW91IGNhbiB0aGVuIGVuY29kZSB0aGlzIHZhbHVlIGFzIHRoZSBzaWduZWQgdmVyc2lvbi4gVGhpcyBpcyByZWFsbHkgcmF0aGVyXG4gKiBoYWNreSwgYnV0IGl0IHNob3VsZCB3b3JrIGFuZCBnZXQgdGhlIGpvYiBkb25lIHdoaWNoIGlzIG91ciBnb2FsIGhlcmUuXG4gKi9cblxuLypcbiAqIEEgc2VyaWVzIG9mIGNoZWNrcyB0byBtYWtlIHN1cmUgd2UgYWN0dWFsbHkgaGF2ZSBhIHNpZ25lZCAzMi1iaXQgbnVtYmVyXG4gKi9cbmZ1bmN0aW9uIHZlcmlmc2ludCh2YWx1ZSwgbWF4LCBtaW4pIHtcbiAgYXNzZXJ0Lm9rKHR5cGVvZiAodmFsdWUpID09ICdudW1iZXInLFxuICAgICAgJ2Nhbm5vdCB3cml0ZSBhIG5vbi1udW1iZXIgYXMgYSBudW1iZXInKTtcblxuICBhc3NlcnQub2sodmFsdWUgPD0gbWF4LCAndmFsdWUgbGFyZ2VyIHRoYW4gbWF4aW11bSBhbGxvd2VkIHZhbHVlJyk7XG5cbiAgYXNzZXJ0Lm9rKHZhbHVlID49IG1pbiwgJ3ZhbHVlIHNtYWxsZXIgdGhhbiBtaW5pbXVtIGFsbG93ZWQgdmFsdWUnKTtcblxuICBhc3NlcnQub2soTWF0aC5mbG9vcih2YWx1ZSkgPT09IHZhbHVlLCAndmFsdWUgaGFzIGEgZnJhY3Rpb25hbCBjb21wb25lbnQnKTtcbn1cblxuZnVuY3Rpb24gdmVyaWZJRUVFNzU0KHZhbHVlLCBtYXgsIG1pbikge1xuICBhc3NlcnQub2sodHlwZW9mICh2YWx1ZSkgPT0gJ251bWJlcicsXG4gICAgICAnY2Fubm90IHdyaXRlIGEgbm9uLW51bWJlciBhcyBhIG51bWJlcicpO1xuXG4gIGFzc2VydC5vayh2YWx1ZSA8PSBtYXgsICd2YWx1ZSBsYXJnZXIgdGhhbiBtYXhpbXVtIGFsbG93ZWQgdmFsdWUnKTtcblxuICBhc3NlcnQub2sodmFsdWUgPj0gbWluLCAndmFsdWUgc21hbGxlciB0aGFuIG1pbmltdW0gYWxsb3dlZCB2YWx1ZScpO1xufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhciBidWZmZXIgPSB0aGlzO1xuXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQub2sodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCxcbiAgICAgICAgJ21pc3NpbmcgdmFsdWUnKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsXG4gICAgICAgICdtaXNzaW5nIG9mZnNldCcpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCA8IGJ1ZmZlci5sZW5ndGgsXG4gICAgICAgICdUcnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKTtcblxuICAgIHZlcmlmc2ludCh2YWx1ZSwgMHg3ZiwgLTB4ODApO1xuICB9XG5cbiAgaWYgKHZhbHVlID49IDApIHtcbiAgICBidWZmZXIud3JpdGVVSW50OCh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCk7XG4gIH0gZWxzZSB7XG4gICAgYnVmZmVyLndyaXRlVUludDgoMHhmZiArIHZhbHVlICsgMSwgb2Zmc2V0LCBub0Fzc2VydCk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIHdyaXRlSW50MTYoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydC5vayh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyB2YWx1ZScpO1xuXG4gICAgYXNzZXJ0Lm9rKHR5cGVvZiAoaXNCaWdFbmRpYW4pID09PSAnYm9vbGVhbicsXG4gICAgICAgICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyBvZmZzZXQnKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgKyAxIDwgYnVmZmVyLmxlbmd0aCxcbiAgICAgICAgJ1RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpO1xuXG4gICAgdmVyaWZzaW50KHZhbHVlLCAweDdmZmYsIC0weDgwMDApO1xuICB9XG5cbiAgaWYgKHZhbHVlID49IDApIHtcbiAgICB3cml0ZVVJbnQxNihidWZmZXIsIHZhbHVlLCBvZmZzZXQsIGlzQmlnRW5kaWFuLCBub0Fzc2VydCk7XG4gIH0gZWxzZSB7XG4gICAgd3JpdGVVSW50MTYoYnVmZmVyLCAweGZmZmYgKyB2YWx1ZSArIDEsIG9mZnNldCwgaXNCaWdFbmRpYW4sIG5vQXNzZXJ0KTtcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZMRSA9IGZ1bmN0aW9uKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHdyaXRlSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkJFID0gZnVuY3Rpb24odmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgd3JpdGVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydCk7XG59O1xuXG5mdW5jdGlvbiB3cml0ZUludDMyKGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNCaWdFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQub2sodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCxcbiAgICAgICAgJ21pc3NpbmcgdmFsdWUnKTtcblxuICAgIGFzc2VydC5vayh0eXBlb2YgKGlzQmlnRW5kaWFuKSA9PT0gJ2Jvb2xlYW4nLFxuICAgICAgICAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCxcbiAgICAgICAgJ21pc3Npbmcgb2Zmc2V0Jyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICsgMyA8IGJ1ZmZlci5sZW5ndGgsXG4gICAgICAgICdUcnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKTtcblxuICAgIHZlcmlmc2ludCh2YWx1ZSwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApO1xuICB9XG5cbiAgaWYgKHZhbHVlID49IDApIHtcbiAgICB3cml0ZVVJbnQzMihidWZmZXIsIHZhbHVlLCBvZmZzZXQsIGlzQmlnRW5kaWFuLCBub0Fzc2VydCk7XG4gIH0gZWxzZSB7XG4gICAgd3JpdGVVSW50MzIoYnVmZmVyLCAweGZmZmZmZmZmICsgdmFsdWUgKyAxLCBvZmZzZXQsIGlzQmlnRW5kaWFuLCBub0Fzc2VydCk7XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyTEUgPSBmdW5jdGlvbih2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB3cml0ZUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJCRSA9IGZ1bmN0aW9uKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHdyaXRlSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpO1xufTtcblxuZnVuY3Rpb24gd3JpdGVGbG9hdChidWZmZXIsIHZhbHVlLCBvZmZzZXQsIGlzQmlnRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0Lm9rKHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsXG4gICAgICAgICdtaXNzaW5nIHZhbHVlJyk7XG5cbiAgICBhc3NlcnQub2sodHlwZW9mIChpc0JpZ0VuZGlhbikgPT09ICdib29sZWFuJyxcbiAgICAgICAgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsXG4gICAgICAgICdtaXNzaW5nIG9mZnNldCcpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCArIDMgPCBidWZmZXIubGVuZ3RoLFxuICAgICAgICAnVHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJyk7XG5cbiAgICB2ZXJpZklFRUU3NTQodmFsdWUsIDMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgsIC0zLjQwMjgyMzQ2NjM4NTI4ODZlKzM4KTtcbiAgfVxuXG4gIHJlcXVpcmUoJy4vYnVmZmVyX2llZWU3NTQnKS53cml0ZUlFRUU3NTQoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0JpZ0VuZGlhbixcbiAgICAgIDIzLCA0KTtcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0TEUgPSBmdW5jdGlvbih2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRCRSA9IGZ1bmN0aW9uKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpO1xufTtcblxuZnVuY3Rpb24gd3JpdGVEb3VibGUoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydC5vayh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyB2YWx1ZScpO1xuXG4gICAgYXNzZXJ0Lm9rKHR5cGVvZiAoaXNCaWdFbmRpYW4pID09PSAnYm9vbGVhbicsXG4gICAgICAgICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyBvZmZzZXQnKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgKyA3IDwgYnVmZmVyLmxlbmd0aCxcbiAgICAgICAgJ1RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpO1xuXG4gICAgdmVyaWZJRUVFNzU0KHZhbHVlLCAxLjc5NzY5MzEzNDg2MjMxNTdFKzMwOCwgLTEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4KTtcbiAgfVxuXG4gIHJlcXVpcmUoJy4vYnVmZmVyX2llZWU3NTQnKS53cml0ZUlFRUU3NTQoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0JpZ0VuZGlhbixcbiAgICAgIDUyLCA4KTtcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUxFID0gZnVuY3Rpb24odmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVCRSA9IGZ1bmN0aW9uKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KTtcbn07XG5cblNsb3dCdWZmZXIucHJvdG90eXBlLnJlYWRVSW50OCA9IEJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQ4O1xuU2xvd0J1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkxFID0gQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2TEU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBCdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZCRTtcblNsb3dCdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJMRSA9IEJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkxFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkJFID0gQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyQkU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS5yZWFkSW50OCA9IEJ1ZmZlci5wcm90b3R5cGUucmVhZEludDg7XG5TbG93QnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZMRSA9IEJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2TEU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZCRSA9IEJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2QkU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJMRSA9IEJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyTEU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJCRSA9IEJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyQkU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRMRSA9IEJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRCRSA9IEJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlTEUgPSBCdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRTtcblNsb3dCdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVCRSA9IEJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUJFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50OCA9IEJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50ODtcblNsb3dCdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2TEUgPSBCdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2TEU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkJFID0gQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkJFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRSA9IEJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRTtcblNsb3dCdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyQkUgPSBCdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyQkU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS53cml0ZUludDggPSBCdWZmZXIucHJvdG90eXBlLndyaXRlSW50ODtcblNsb3dCdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZMRSA9IEJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkxFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkJFID0gQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2QkU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyTEUgPSBCdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRTtcblNsb3dCdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJCRSA9IEJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkJFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdExFID0gQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0TEU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0QkUgPSBCdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRCRTtcblNsb3dCdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlTEUgPSBCdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlTEU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFID0gQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFO1xuXG59KSgpXG59LHtcImFzc2VydFwiOjIsXCIuL2J1ZmZlcl9pZWVlNzU0XCI6MSxcImJhc2U2NC1qc1wiOjV9XSwzOltmdW5jdGlvbihyZXF1aXJlLG1vZHVsZSxleHBvcnRzKXtcbnZhciBldmVudHMgPSByZXF1aXJlKCdldmVudHMnKTtcblxuZXhwb3J0cy5pc0FycmF5ID0gaXNBcnJheTtcbmV4cG9ydHMuaXNEYXRlID0gZnVuY3Rpb24ob2JqKXtyZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iaikgPT09ICdbb2JqZWN0IERhdGVdJ307XG5leHBvcnRzLmlzUmVnRXhwID0gZnVuY3Rpb24ob2JqKXtyZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iaikgPT09ICdbb2JqZWN0IFJlZ0V4cF0nfTtcblxuXG5leHBvcnRzLnByaW50ID0gZnVuY3Rpb24gKCkge307XG5leHBvcnRzLnB1dHMgPSBmdW5jdGlvbiAoKSB7fTtcbmV4cG9ydHMuZGVidWcgPSBmdW5jdGlvbigpIHt9O1xuXG5leHBvcnRzLmluc3BlY3QgPSBmdW5jdGlvbihvYmosIHNob3dIaWRkZW4sIGRlcHRoLCBjb2xvcnMpIHtcbiAgdmFyIHNlZW4gPSBbXTtcblxuICB2YXIgc3R5bGl6ZSA9IGZ1bmN0aW9uKHN0ciwgc3R5bGVUeXBlKSB7XG4gICAgLy8gaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9BTlNJX2VzY2FwZV9jb2RlI2dyYXBoaWNzXG4gICAgdmFyIHN0eWxlcyA9XG4gICAgICAgIHsgJ2JvbGQnIDogWzEsIDIyXSxcbiAgICAgICAgICAnaXRhbGljJyA6IFszLCAyM10sXG4gICAgICAgICAgJ3VuZGVybGluZScgOiBbNCwgMjRdLFxuICAgICAgICAgICdpbnZlcnNlJyA6IFs3LCAyN10sXG4gICAgICAgICAgJ3doaXRlJyA6IFszNywgMzldLFxuICAgICAgICAgICdncmV5JyA6IFs5MCwgMzldLFxuICAgICAgICAgICdibGFjaycgOiBbMzAsIDM5XSxcbiAgICAgICAgICAnYmx1ZScgOiBbMzQsIDM5XSxcbiAgICAgICAgICAnY3lhbicgOiBbMzYsIDM5XSxcbiAgICAgICAgICAnZ3JlZW4nIDogWzMyLCAzOV0sXG4gICAgICAgICAgJ21hZ2VudGEnIDogWzM1LCAzOV0sXG4gICAgICAgICAgJ3JlZCcgOiBbMzEsIDM5XSxcbiAgICAgICAgICAneWVsbG93JyA6IFszMywgMzldIH07XG5cbiAgICB2YXIgc3R5bGUgPVxuICAgICAgICB7ICdzcGVjaWFsJzogJ2N5YW4nLFxuICAgICAgICAgICdudW1iZXInOiAnYmx1ZScsXG4gICAgICAgICAgJ2Jvb2xlYW4nOiAneWVsbG93JyxcbiAgICAgICAgICAndW5kZWZpbmVkJzogJ2dyZXknLFxuICAgICAgICAgICdudWxsJzogJ2JvbGQnLFxuICAgICAgICAgICdzdHJpbmcnOiAnZ3JlZW4nLFxuICAgICAgICAgICdkYXRlJzogJ21hZ2VudGEnLFxuICAgICAgICAgIC8vIFwibmFtZVwiOiBpbnRlbnRpb25hbGx5IG5vdCBzdHlsaW5nXG4gICAgICAgICAgJ3JlZ2V4cCc6ICdyZWQnIH1bc3R5bGVUeXBlXTtcblxuICAgIGlmIChzdHlsZSkge1xuICAgICAgcmV0dXJuICdcXDAzM1snICsgc3R5bGVzW3N0eWxlXVswXSArICdtJyArIHN0ciArXG4gICAgICAgICAgICAgJ1xcMDMzWycgKyBzdHlsZXNbc3R5bGVdWzFdICsgJ20nO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gc3RyO1xuICAgIH1cbiAgfTtcbiAgaWYgKCEgY29sb3JzKSB7XG4gICAgc3R5bGl6ZSA9IGZ1bmN0aW9uKHN0ciwgc3R5bGVUeXBlKSB7IHJldHVybiBzdHI7IH07XG4gIH1cblxuICBmdW5jdGlvbiBmb3JtYXQodmFsdWUsIHJlY3Vyc2VUaW1lcykge1xuICAgIC8vIFByb3ZpZGUgYSBob29rIGZvciB1c2VyLXNwZWNpZmllZCBpbnNwZWN0IGZ1bmN0aW9ucy5cbiAgICAvLyBDaGVjayB0aGF0IHZhbHVlIGlzIGFuIG9iamVjdCB3aXRoIGFuIGluc3BlY3QgZnVuY3Rpb24gb24gaXRcbiAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlLmluc3BlY3QgPT09ICdmdW5jdGlvbicgJiZcbiAgICAgICAgLy8gRmlsdGVyIG91dCB0aGUgdXRpbCBtb2R1bGUsIGl0J3MgaW5zcGVjdCBmdW5jdGlvbiBpcyBzcGVjaWFsXG4gICAgICAgIHZhbHVlICE9PSBleHBvcnRzICYmXG4gICAgICAgIC8vIEFsc28gZmlsdGVyIG91dCBhbnkgcHJvdG90eXBlIG9iamVjdHMgdXNpbmcgdGhlIGNpcmN1bGFyIGNoZWNrLlxuICAgICAgICAhKHZhbHVlLmNvbnN0cnVjdG9yICYmIHZhbHVlLmNvbnN0cnVjdG9yLnByb3RvdHlwZSA9PT0gdmFsdWUpKSB7XG4gICAgICByZXR1cm4gdmFsdWUuaW5zcGVjdChyZWN1cnNlVGltZXMpO1xuICAgIH1cblxuICAgIC8vIFByaW1pdGl2ZSB0eXBlcyBjYW5ub3QgaGF2ZSBwcm9wZXJ0aWVzXG4gICAgc3dpdGNoICh0eXBlb2YgdmFsdWUpIHtcbiAgICAgIGNhc2UgJ3VuZGVmaW5lZCc6XG4gICAgICAgIHJldHVybiBzdHlsaXplKCd1bmRlZmluZWQnLCAndW5kZWZpbmVkJyk7XG5cbiAgICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICAgIHZhciBzaW1wbGUgPSAnXFwnJyArIEpTT04uc3RyaW5naWZ5KHZhbHVlKS5yZXBsYWNlKC9eXCJ8XCIkL2csICcnKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC8nL2csIFwiXFxcXCdcIilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgvXFxcXFwiL2csICdcIicpICsgJ1xcJyc7XG4gICAgICAgIHJldHVybiBzdHlsaXplKHNpbXBsZSwgJ3N0cmluZycpO1xuXG4gICAgICBjYXNlICdudW1iZXInOlxuICAgICAgICByZXR1cm4gc3R5bGl6ZSgnJyArIHZhbHVlLCAnbnVtYmVyJyk7XG5cbiAgICAgIGNhc2UgJ2Jvb2xlYW4nOlxuICAgICAgICByZXR1cm4gc3R5bGl6ZSgnJyArIHZhbHVlLCAnYm9vbGVhbicpO1xuICAgIH1cbiAgICAvLyBGb3Igc29tZSByZWFzb24gdHlwZW9mIG51bGwgaXMgXCJvYmplY3RcIiwgc28gc3BlY2lhbCBjYXNlIGhlcmUuXG4gICAgaWYgKHZhbHVlID09PSBudWxsKSB7XG4gICAgICByZXR1cm4gc3R5bGl6ZSgnbnVsbCcsICdudWxsJyk7XG4gICAgfVxuXG4gICAgLy8gTG9vayB1cCB0aGUga2V5cyBvZiB0aGUgb2JqZWN0LlxuICAgIHZhciB2aXNpYmxlX2tleXMgPSBPYmplY3Rfa2V5cyh2YWx1ZSk7XG4gICAgdmFyIGtleXMgPSBzaG93SGlkZGVuID8gT2JqZWN0X2dldE93blByb3BlcnR5TmFtZXModmFsdWUpIDogdmlzaWJsZV9rZXlzO1xuXG4gICAgLy8gRnVuY3Rpb25zIHdpdGhvdXQgcHJvcGVydGllcyBjYW4gYmUgc2hvcnRjdXR0ZWQuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJyAmJiBrZXlzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgaWYgKGlzUmVnRXhwKHZhbHVlKSkge1xuICAgICAgICByZXR1cm4gc3R5bGl6ZSgnJyArIHZhbHVlLCAncmVnZXhwJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgbmFtZSA9IHZhbHVlLm5hbWUgPyAnOiAnICsgdmFsdWUubmFtZSA6ICcnO1xuICAgICAgICByZXR1cm4gc3R5bGl6ZSgnW0Z1bmN0aW9uJyArIG5hbWUgKyAnXScsICdzcGVjaWFsJyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRGF0ZXMgd2l0aG91dCBwcm9wZXJ0aWVzIGNhbiBiZSBzaG9ydGN1dHRlZFxuICAgIGlmIChpc0RhdGUodmFsdWUpICYmIGtleXMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gc3R5bGl6ZSh2YWx1ZS50b1VUQ1N0cmluZygpLCAnZGF0ZScpO1xuICAgIH1cblxuICAgIHZhciBiYXNlLCB0eXBlLCBicmFjZXM7XG4gICAgLy8gRGV0ZXJtaW5lIHRoZSBvYmplY3QgdHlwZVxuICAgIGlmIChpc0FycmF5KHZhbHVlKSkge1xuICAgICAgdHlwZSA9ICdBcnJheSc7XG4gICAgICBicmFjZXMgPSBbJ1snLCAnXSddO1xuICAgIH0gZWxzZSB7XG4gICAgICB0eXBlID0gJ09iamVjdCc7XG4gICAgICBicmFjZXMgPSBbJ3snLCAnfSddO1xuICAgIH1cblxuICAgIC8vIE1ha2UgZnVuY3Rpb25zIHNheSB0aGF0IHRoZXkgYXJlIGZ1bmN0aW9uc1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHZhciBuID0gdmFsdWUubmFtZSA/ICc6ICcgKyB2YWx1ZS5uYW1lIDogJyc7XG4gICAgICBiYXNlID0gKGlzUmVnRXhwKHZhbHVlKSkgPyAnICcgKyB2YWx1ZSA6ICcgW0Z1bmN0aW9uJyArIG4gKyAnXSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIGJhc2UgPSAnJztcbiAgICB9XG5cbiAgICAvLyBNYWtlIGRhdGVzIHdpdGggcHJvcGVydGllcyBmaXJzdCBzYXkgdGhlIGRhdGVcbiAgICBpZiAoaXNEYXRlKHZhbHVlKSkge1xuICAgICAgYmFzZSA9ICcgJyArIHZhbHVlLnRvVVRDU3RyaW5nKCk7XG4gICAgfVxuXG4gICAgaWYgKGtleXMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gYnJhY2VzWzBdICsgYmFzZSArIGJyYWNlc1sxXTtcbiAgICB9XG5cbiAgICBpZiAocmVjdXJzZVRpbWVzIDwgMCkge1xuICAgICAgaWYgKGlzUmVnRXhwKHZhbHVlKSkge1xuICAgICAgICByZXR1cm4gc3R5bGl6ZSgnJyArIHZhbHVlLCAncmVnZXhwJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gc3R5bGl6ZSgnW09iamVjdF0nLCAnc3BlY2lhbCcpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHNlZW4ucHVzaCh2YWx1ZSk7XG5cbiAgICB2YXIgb3V0cHV0ID0ga2V5cy5tYXAoZnVuY3Rpb24oa2V5KSB7XG4gICAgICB2YXIgbmFtZSwgc3RyO1xuICAgICAgaWYgKHZhbHVlLl9fbG9va3VwR2V0dGVyX18pIHtcbiAgICAgICAgaWYgKHZhbHVlLl9fbG9va3VwR2V0dGVyX18oa2V5KSkge1xuICAgICAgICAgIGlmICh2YWx1ZS5fX2xvb2t1cFNldHRlcl9fKGtleSkpIHtcbiAgICAgICAgICAgIHN0ciA9IHN0eWxpemUoJ1tHZXR0ZXIvU2V0dGVyXScsICdzcGVjaWFsJyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHN0ciA9IHN0eWxpemUoJ1tHZXR0ZXJdJywgJ3NwZWNpYWwnKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKHZhbHVlLl9fbG9va3VwU2V0dGVyX18oa2V5KSkge1xuICAgICAgICAgICAgc3RyID0gc3R5bGl6ZSgnW1NldHRlcl0nLCAnc3BlY2lhbCcpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHZpc2libGVfa2V5cy5pbmRleE9mKGtleSkgPCAwKSB7XG4gICAgICAgIG5hbWUgPSAnWycgKyBrZXkgKyAnXSc7XG4gICAgICB9XG4gICAgICBpZiAoIXN0cikge1xuICAgICAgICBpZiAoc2Vlbi5pbmRleE9mKHZhbHVlW2tleV0pIDwgMCkge1xuICAgICAgICAgIGlmIChyZWN1cnNlVGltZXMgPT09IG51bGwpIHtcbiAgICAgICAgICAgIHN0ciA9IGZvcm1hdCh2YWx1ZVtrZXldKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc3RyID0gZm9ybWF0KHZhbHVlW2tleV0sIHJlY3Vyc2VUaW1lcyAtIDEpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoc3RyLmluZGV4T2YoJ1xcbicpID4gLTEpIHtcbiAgICAgICAgICAgIGlmIChpc0FycmF5KHZhbHVlKSkge1xuICAgICAgICAgICAgICBzdHIgPSBzdHIuc3BsaXQoJ1xcbicpLm1hcChmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICcgICcgKyBsaW5lO1xuICAgICAgICAgICAgICB9KS5qb2luKCdcXG4nKS5zdWJzdHIoMik7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBzdHIgPSAnXFxuJyArIHN0ci5zcGxpdCgnXFxuJykubWFwKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJyAgICcgKyBsaW5lO1xuICAgICAgICAgICAgICB9KS5qb2luKCdcXG4nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc3RyID0gc3R5bGl6ZSgnW0NpcmN1bGFyXScsICdzcGVjaWFsJyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgbmFtZSA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgaWYgKHR5cGUgPT09ICdBcnJheScgJiYga2V5Lm1hdGNoKC9eXFxkKyQvKSkge1xuICAgICAgICAgIHJldHVybiBzdHI7XG4gICAgICAgIH1cbiAgICAgICAgbmFtZSA9IEpTT04uc3RyaW5naWZ5KCcnICsga2V5KTtcbiAgICAgICAgaWYgKG5hbWUubWF0Y2goL15cIihbYS16QS1aX11bYS16QS1aXzAtOV0qKVwiJC8pKSB7XG4gICAgICAgICAgbmFtZSA9IG5hbWUuc3Vic3RyKDEsIG5hbWUubGVuZ3RoIC0gMik7XG4gICAgICAgICAgbmFtZSA9IHN0eWxpemUobmFtZSwgJ25hbWUnKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBuYW1lID0gbmFtZS5yZXBsYWNlKC8nL2csIFwiXFxcXCdcIilcbiAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC9cXFxcXCIvZywgJ1wiJylcbiAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC8oXlwifFwiJCkvZywgXCInXCIpO1xuICAgICAgICAgIG5hbWUgPSBzdHlsaXplKG5hbWUsICdzdHJpbmcnKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gbmFtZSArICc6ICcgKyBzdHI7XG4gICAgfSk7XG5cbiAgICBzZWVuLnBvcCgpO1xuXG4gICAgdmFyIG51bUxpbmVzRXN0ID0gMDtcbiAgICB2YXIgbGVuZ3RoID0gb3V0cHV0LnJlZHVjZShmdW5jdGlvbihwcmV2LCBjdXIpIHtcbiAgICAgIG51bUxpbmVzRXN0Kys7XG4gICAgICBpZiAoY3VyLmluZGV4T2YoJ1xcbicpID49IDApIG51bUxpbmVzRXN0Kys7XG4gICAgICByZXR1cm4gcHJldiArIGN1ci5sZW5ndGggKyAxO1xuICAgIH0sIDApO1xuXG4gICAgaWYgKGxlbmd0aCA+IDUwKSB7XG4gICAgICBvdXRwdXQgPSBicmFjZXNbMF0gK1xuICAgICAgICAgICAgICAgKGJhc2UgPT09ICcnID8gJycgOiBiYXNlICsgJ1xcbiAnKSArXG4gICAgICAgICAgICAgICAnICcgK1xuICAgICAgICAgICAgICAgb3V0cHV0LmpvaW4oJyxcXG4gICcpICtcbiAgICAgICAgICAgICAgICcgJyArXG4gICAgICAgICAgICAgICBicmFjZXNbMV07XG5cbiAgICB9IGVsc2Uge1xuICAgICAgb3V0cHV0ID0gYnJhY2VzWzBdICsgYmFzZSArICcgJyArIG91dHB1dC5qb2luKCcsICcpICsgJyAnICsgYnJhY2VzWzFdO1xuICAgIH1cblxuICAgIHJldHVybiBvdXRwdXQ7XG4gIH1cbiAgcmV0dXJuIGZvcm1hdChvYmosICh0eXBlb2YgZGVwdGggPT09ICd1bmRlZmluZWQnID8gMiA6IGRlcHRoKSk7XG59O1xuXG5cbmZ1bmN0aW9uIGlzQXJyYXkoYXIpIHtcbiAgcmV0dXJuIGFyIGluc3RhbmNlb2YgQXJyYXkgfHxcbiAgICAgICAgIEFycmF5LmlzQXJyYXkoYXIpIHx8XG4gICAgICAgICAoYXIgJiYgYXIgIT09IE9iamVjdC5wcm90b3R5cGUgJiYgaXNBcnJheShhci5fX3Byb3RvX18pKTtcbn1cblxuXG5mdW5jdGlvbiBpc1JlZ0V4cChyZSkge1xuICByZXR1cm4gcmUgaW5zdGFuY2VvZiBSZWdFeHAgfHxcbiAgICAodHlwZW9mIHJlID09PSAnb2JqZWN0JyAmJiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwocmUpID09PSAnW29iamVjdCBSZWdFeHBdJyk7XG59XG5cblxuZnVuY3Rpb24gaXNEYXRlKGQpIHtcbiAgaWYgKGQgaW5zdGFuY2VvZiBEYXRlKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHR5cGVvZiBkICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuICB2YXIgcHJvcGVydGllcyA9IERhdGUucHJvdG90eXBlICYmIE9iamVjdF9nZXRPd25Qcm9wZXJ0eU5hbWVzKERhdGUucHJvdG90eXBlKTtcbiAgdmFyIHByb3RvID0gZC5fX3Byb3RvX18gJiYgT2JqZWN0X2dldE93blByb3BlcnR5TmFtZXMoZC5fX3Byb3RvX18pO1xuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkocHJvdG8pID09PSBKU09OLnN0cmluZ2lmeShwcm9wZXJ0aWVzKTtcbn1cblxuZnVuY3Rpb24gcGFkKG4pIHtcbiAgcmV0dXJuIG4gPCAxMCA/ICcwJyArIG4udG9TdHJpbmcoMTApIDogbi50b1N0cmluZygxMCk7XG59XG5cbnZhciBtb250aHMgPSBbJ0phbicsICdGZWInLCAnTWFyJywgJ0FwcicsICdNYXknLCAnSnVuJywgJ0p1bCcsICdBdWcnLCAnU2VwJyxcbiAgICAgICAgICAgICAgJ09jdCcsICdOb3YnLCAnRGVjJ107XG5cbi8vIDI2IEZlYiAxNjoxOTozNFxuZnVuY3Rpb24gdGltZXN0YW1wKCkge1xuICB2YXIgZCA9IG5ldyBEYXRlKCk7XG4gIHZhciB0aW1lID0gW3BhZChkLmdldEhvdXJzKCkpLFxuICAgICAgICAgICAgICBwYWQoZC5nZXRNaW51dGVzKCkpLFxuICAgICAgICAgICAgICBwYWQoZC5nZXRTZWNvbmRzKCkpXS5qb2luKCc6Jyk7XG4gIHJldHVybiBbZC5nZXREYXRlKCksIG1vbnRoc1tkLmdldE1vbnRoKCldLCB0aW1lXS5qb2luKCcgJyk7XG59XG5cbmV4cG9ydHMubG9nID0gZnVuY3Rpb24gKG1zZykge307XG5cbmV4cG9ydHMucHVtcCA9IG51bGw7XG5cbnZhciBPYmplY3Rfa2V5cyA9IE9iamVjdC5rZXlzIHx8IGZ1bmN0aW9uIChvYmopIHtcbiAgICB2YXIgcmVzID0gW107XG4gICAgZm9yICh2YXIga2V5IGluIG9iaikgcmVzLnB1c2goa2V5KTtcbiAgICByZXR1cm4gcmVzO1xufTtcblxudmFyIE9iamVjdF9nZXRPd25Qcm9wZXJ0eU5hbWVzID0gT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMgfHwgZnVuY3Rpb24gKG9iaikge1xuICAgIHZhciByZXMgPSBbXTtcbiAgICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgICAgIGlmIChPYmplY3QuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIGtleSkpIHJlcy5wdXNoKGtleSk7XG4gICAgfVxuICAgIHJldHVybiByZXM7XG59O1xuXG52YXIgT2JqZWN0X2NyZWF0ZSA9IE9iamVjdC5jcmVhdGUgfHwgZnVuY3Rpb24gKHByb3RvdHlwZSwgcHJvcGVydGllcykge1xuICAgIC8vIGZyb20gZXM1LXNoaW1cbiAgICB2YXIgb2JqZWN0O1xuICAgIGlmIChwcm90b3R5cGUgPT09IG51bGwpIHtcbiAgICAgICAgb2JqZWN0ID0geyAnX19wcm90b19fJyA6IG51bGwgfTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGlmICh0eXBlb2YgcHJvdG90eXBlICE9PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgICAgICAgICAndHlwZW9mIHByb3RvdHlwZVsnICsgKHR5cGVvZiBwcm90b3R5cGUpICsgJ10gIT0gXFwnb2JqZWN0XFwnJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgVHlwZSA9IGZ1bmN0aW9uICgpIHt9O1xuICAgICAgICBUeXBlLnByb3RvdHlwZSA9IHByb3RvdHlwZTtcbiAgICAgICAgb2JqZWN0ID0gbmV3IFR5cGUoKTtcbiAgICAgICAgb2JqZWN0Ll9fcHJvdG9fXyA9IHByb3RvdHlwZTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBwcm9wZXJ0aWVzICE9PSAndW5kZWZpbmVkJyAmJiBPYmplY3QuZGVmaW5lUHJvcGVydGllcykge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyhvYmplY3QsIHByb3BlcnRpZXMpO1xuICAgIH1cbiAgICByZXR1cm4gb2JqZWN0O1xufTtcblxuZXhwb3J0cy5pbmhlcml0cyA9IGZ1bmN0aW9uKGN0b3IsIHN1cGVyQ3Rvcikge1xuICBjdG9yLnN1cGVyXyA9IHN1cGVyQ3RvcjtcbiAgY3Rvci5wcm90b3R5cGUgPSBPYmplY3RfY3JlYXRlKHN1cGVyQ3Rvci5wcm90b3R5cGUsIHtcbiAgICBjb25zdHJ1Y3Rvcjoge1xuICAgICAgdmFsdWU6IGN0b3IsXG4gICAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICAgIHdyaXRhYmxlOiB0cnVlLFxuICAgICAgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgfVxuICB9KTtcbn07XG5cbnZhciBmb3JtYXRSZWdFeHAgPSAvJVtzZGolXS9nO1xuZXhwb3J0cy5mb3JtYXQgPSBmdW5jdGlvbihmKSB7XG4gIGlmICh0eXBlb2YgZiAhPT0gJ3N0cmluZycpIHtcbiAgICB2YXIgb2JqZWN0cyA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBvYmplY3RzLnB1c2goZXhwb3J0cy5pbnNwZWN0KGFyZ3VtZW50c1tpXSkpO1xuICAgIH1cbiAgICByZXR1cm4gb2JqZWN0cy5qb2luKCcgJyk7XG4gIH1cblxuICB2YXIgaSA9IDE7XG4gIHZhciBhcmdzID0gYXJndW1lbnRzO1xuICB2YXIgbGVuID0gYXJncy5sZW5ndGg7XG4gIHZhciBzdHIgPSBTdHJpbmcoZikucmVwbGFjZShmb3JtYXRSZWdFeHAsIGZ1bmN0aW9uKHgpIHtcbiAgICBpZiAoeCA9PT0gJyUlJykgcmV0dXJuICclJztcbiAgICBpZiAoaSA+PSBsZW4pIHJldHVybiB4O1xuICAgIHN3aXRjaCAoeCkge1xuICAgICAgY2FzZSAnJXMnOiByZXR1cm4gU3RyaW5nKGFyZ3NbaSsrXSk7XG4gICAgICBjYXNlICclZCc6IHJldHVybiBOdW1iZXIoYXJnc1tpKytdKTtcbiAgICAgIGNhc2UgJyVqJzogcmV0dXJuIEpTT04uc3RyaW5naWZ5KGFyZ3NbaSsrXSk7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4geDtcbiAgICB9XG4gIH0pO1xuICBmb3IodmFyIHggPSBhcmdzW2ldOyBpIDwgbGVuOyB4ID0gYXJnc1srK2ldKXtcbiAgICBpZiAoeCA9PT0gbnVsbCB8fCB0eXBlb2YgeCAhPT0gJ29iamVjdCcpIHtcbiAgICAgIHN0ciArPSAnICcgKyB4O1xuICAgIH0gZWxzZSB7XG4gICAgICBzdHIgKz0gJyAnICsgZXhwb3J0cy5pbnNwZWN0KHgpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gc3RyO1xufTtcblxufSx7XCJldmVudHNcIjo2fV0sNTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG4oZnVuY3Rpb24gKGV4cG9ydHMpIHtcblx0J3VzZSBzdHJpY3QnO1xuXG5cdHZhciBsb29rdXAgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyc7XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkoYjY0KSB7XG5cdFx0dmFyIGksIGosIGwsIHRtcCwgcGxhY2VIb2xkZXJzLCBhcnI7XG5cdFxuXHRcdGlmIChiNjQubGVuZ3RoICUgNCA+IDApIHtcblx0XHRcdHRocm93ICdJbnZhbGlkIHN0cmluZy4gTGVuZ3RoIG11c3QgYmUgYSBtdWx0aXBsZSBvZiA0Jztcblx0XHR9XG5cblx0XHQvLyB0aGUgbnVtYmVyIG9mIGVxdWFsIHNpZ25zIChwbGFjZSBob2xkZXJzKVxuXHRcdC8vIGlmIHRoZXJlIGFyZSB0d28gcGxhY2Vob2xkZXJzLCB0aGFuIHRoZSB0d28gY2hhcmFjdGVycyBiZWZvcmUgaXRcblx0XHQvLyByZXByZXNlbnQgb25lIGJ5dGVcblx0XHQvLyBpZiB0aGVyZSBpcyBvbmx5IG9uZSwgdGhlbiB0aGUgdGhyZWUgY2hhcmFjdGVycyBiZWZvcmUgaXQgcmVwcmVzZW50IDIgYnl0ZXNcblx0XHQvLyB0aGlzIGlzIGp1c3QgYSBjaGVhcCBoYWNrIHRvIG5vdCBkbyBpbmRleE9mIHR3aWNlXG5cdFx0cGxhY2VIb2xkZXJzID0gYjY0LmluZGV4T2YoJz0nKTtcblx0XHRwbGFjZUhvbGRlcnMgPSBwbGFjZUhvbGRlcnMgPiAwID8gYjY0Lmxlbmd0aCAtIHBsYWNlSG9sZGVycyA6IDA7XG5cblx0XHQvLyBiYXNlNjQgaXMgNC8zICsgdXAgdG8gdHdvIGNoYXJhY3RlcnMgb2YgdGhlIG9yaWdpbmFsIGRhdGFcblx0XHRhcnIgPSBbXTsvL25ldyBVaW50OEFycmF5KGI2NC5sZW5ndGggKiAzIC8gNCAtIHBsYWNlSG9sZGVycyk7XG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGg7XG5cblx0XHRmb3IgKGkgPSAwLCBqID0gMDsgaSA8IGw7IGkgKz0gNCwgaiArPSAzKSB7XG5cdFx0XHR0bXAgPSAobG9va3VwLmluZGV4T2YoYjY0W2ldKSA8PCAxOCkgfCAobG9va3VwLmluZGV4T2YoYjY0W2kgKyAxXSkgPDwgMTIpIHwgKGxvb2t1cC5pbmRleE9mKGI2NFtpICsgMl0pIDw8IDYpIHwgbG9va3VwLmluZGV4T2YoYjY0W2kgKyAzXSk7XG5cdFx0XHRhcnIucHVzaCgodG1wICYgMHhGRjAwMDApID4+IDE2KTtcblx0XHRcdGFyci5wdXNoKCh0bXAgJiAweEZGMDApID4+IDgpO1xuXHRcdFx0YXJyLnB1c2godG1wICYgMHhGRik7XG5cdFx0fVxuXG5cdFx0aWYgKHBsYWNlSG9sZGVycyA9PT0gMikge1xuXHRcdFx0dG1wID0gKGxvb2t1cC5pbmRleE9mKGI2NFtpXSkgPDwgMikgfCAobG9va3VwLmluZGV4T2YoYjY0W2kgKyAxXSkgPj4gNCk7XG5cdFx0XHRhcnIucHVzaCh0bXAgJiAweEZGKTtcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGxvb2t1cC5pbmRleE9mKGI2NFtpXSkgPDwgMTApIHwgKGxvb2t1cC5pbmRleE9mKGI2NFtpICsgMV0pIDw8IDQpIHwgKGxvb2t1cC5pbmRleE9mKGI2NFtpICsgMl0pID4+IDIpO1xuXHRcdFx0YXJyLnB1c2goKHRtcCA+PiA4KSAmIDB4RkYpO1xuXHRcdFx0YXJyLnB1c2godG1wICYgMHhGRik7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIGFycjtcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQodWludDgpIHtcblx0XHR2YXIgaSxcblx0XHRcdGV4dHJhQnl0ZXMgPSB1aW50OC5sZW5ndGggJSAzLCAvLyBpZiB3ZSBoYXZlIDEgYnl0ZSBsZWZ0LCBwYWQgMiBieXRlc1xuXHRcdFx0b3V0cHV0ID0gXCJcIixcblx0XHRcdHRlbXAsIGxlbmd0aDtcblxuXHRcdGZ1bmN0aW9uIHRyaXBsZXRUb0Jhc2U2NCAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwW251bSA+PiAxOCAmIDB4M0ZdICsgbG9va3VwW251bSA+PiAxMiAmIDB4M0ZdICsgbG9va3VwW251bSA+PiA2ICYgMHgzRl0gKyBsb29rdXBbbnVtICYgMHgzRl07XG5cdFx0fTtcblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pO1xuXHRcdFx0b3V0cHV0ICs9IHRyaXBsZXRUb0Jhc2U2NCh0ZW1wKTtcblx0XHR9XG5cblx0XHQvLyBwYWQgdGhlIGVuZCB3aXRoIHplcm9zLCBidXQgbWFrZSBzdXJlIHRvIG5vdCBmb3JnZXQgdGhlIGV4dHJhIGJ5dGVzXG5cdFx0c3dpdGNoIChleHRyYUJ5dGVzKSB7XG5cdFx0XHRjYXNlIDE6XG5cdFx0XHRcdHRlbXAgPSB1aW50OFt1aW50OC5sZW5ndGggLSAxXTtcblx0XHRcdFx0b3V0cHV0ICs9IGxvb2t1cFt0ZW1wID4+IDJdO1xuXHRcdFx0XHRvdXRwdXQgKz0gbG9va3VwWyh0ZW1wIDw8IDQpICYgMHgzRl07XG5cdFx0XHRcdG91dHB1dCArPSAnPT0nO1xuXHRcdFx0XHRicmVhaztcblx0XHRcdGNhc2UgMjpcblx0XHRcdFx0dGVtcCA9ICh1aW50OFt1aW50OC5sZW5ndGggLSAyXSA8PCA4KSArICh1aW50OFt1aW50OC5sZW5ndGggLSAxXSk7XG5cdFx0XHRcdG91dHB1dCArPSBsb29rdXBbdGVtcCA+PiAxMF07XG5cdFx0XHRcdG91dHB1dCArPSBsb29rdXBbKHRlbXAgPj4gNCkgJiAweDNGXTtcblx0XHRcdFx0b3V0cHV0ICs9IGxvb2t1cFsodGVtcCA8PCAyKSAmIDB4M0ZdO1xuXHRcdFx0XHRvdXRwdXQgKz0gJz0nO1xuXHRcdFx0XHRicmVhaztcblx0XHR9XG5cblx0XHRyZXR1cm4gb3V0cHV0O1xuXHR9XG5cblx0bW9kdWxlLmV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheTtcblx0bW9kdWxlLmV4cG9ydHMuZnJvbUJ5dGVBcnJheSA9IHVpbnQ4VG9CYXNlNjQ7XG59KCkpO1xuXG59LHt9XSw3OltmdW5jdGlvbihyZXF1aXJlLG1vZHVsZSxleHBvcnRzKXtcbmV4cG9ydHMucmVhZElFRUU3NTQgPSBmdW5jdGlvbihidWZmZXIsIG9mZnNldCwgaXNCRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLFxuICAgICAgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMSxcbiAgICAgIGVNYXggPSAoMSA8PCBlTGVuKSAtIDEsXG4gICAgICBlQmlhcyA9IGVNYXggPj4gMSxcbiAgICAgIG5CaXRzID0gLTcsXG4gICAgICBpID0gaXNCRSA/IDAgOiAobkJ5dGVzIC0gMSksXG4gICAgICBkID0gaXNCRSA/IDEgOiAtMSxcbiAgICAgIHMgPSBidWZmZXJbb2Zmc2V0ICsgaV07XG5cbiAgaSArPSBkO1xuXG4gIGUgPSBzICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpO1xuICBzID4+PSAoLW5CaXRzKTtcbiAgbkJpdHMgKz0gZUxlbjtcbiAgZm9yICg7IG5CaXRzID4gMDsgZSA9IGUgKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCk7XG5cbiAgbSA9IGUgJiAoKDEgPDwgKC1uQml0cykpIC0gMSk7XG4gIGUgPj49ICgtbkJpdHMpO1xuICBuQml0cyArPSBtTGVuO1xuICBmb3IgKDsgbkJpdHMgPiAwOyBtID0gbSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KTtcblxuICBpZiAoZSA9PT0gMCkge1xuICAgIGUgPSAxIC0gZUJpYXM7XG4gIH0gZWxzZSBpZiAoZSA9PT0gZU1heCkge1xuICAgIHJldHVybiBtID8gTmFOIDogKChzID8gLTEgOiAxKSAqIEluZmluaXR5KTtcbiAgfSBlbHNlIHtcbiAgICBtID0gbSArIE1hdGgucG93KDIsIG1MZW4pO1xuICAgIGUgPSBlIC0gZUJpYXM7XG4gIH1cbiAgcmV0dXJuIChzID8gLTEgOiAxKSAqIG0gKiBNYXRoLnBvdygyLCBlIC0gbUxlbik7XG59O1xuXG5leHBvcnRzLndyaXRlSUVFRTc1NCA9IGZ1bmN0aW9uKGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNCRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLCBjLFxuICAgICAgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMSxcbiAgICAgIGVNYXggPSAoMSA8PCBlTGVuKSAtIDEsXG4gICAgICBlQmlhcyA9IGVNYXggPj4gMSxcbiAgICAgIHJ0ID0gKG1MZW4gPT09IDIzID8gTWF0aC5wb3coMiwgLTI0KSAtIE1hdGgucG93KDIsIC03NykgOiAwKSxcbiAgICAgIGkgPSBpc0JFID8gKG5CeXRlcyAtIDEpIDogMCxcbiAgICAgIGQgPSBpc0JFID8gLTEgOiAxLFxuICAgICAgcyA9IHZhbHVlIDwgMCB8fCAodmFsdWUgPT09IDAgJiYgMSAvIHZhbHVlIDwgMCkgPyAxIDogMDtcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKTtcblxuICBpZiAoaXNOYU4odmFsdWUpIHx8IHZhbHVlID09PSBJbmZpbml0eSkge1xuICAgIG0gPSBpc05hTih2YWx1ZSkgPyAxIDogMDtcbiAgICBlID0gZU1heDtcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMik7XG4gICAgaWYgKHZhbHVlICogKGMgPSBNYXRoLnBvdygyLCAtZSkpIDwgMSkge1xuICAgICAgZS0tO1xuICAgICAgYyAqPSAyO1xuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gYztcbiAgICB9IGVsc2Uge1xuICAgICAgdmFsdWUgKz0gcnQgKiBNYXRoLnBvdygyLCAxIC0gZUJpYXMpO1xuICAgIH1cbiAgICBpZiAodmFsdWUgKiBjID49IDIpIHtcbiAgICAgIGUrKztcbiAgICAgIGMgLz0gMjtcbiAgICB9XG5cbiAgICBpZiAoZSArIGVCaWFzID49IGVNYXgpIHtcbiAgICAgIG0gPSAwO1xuICAgICAgZSA9IGVNYXg7XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICh2YWx1ZSAqIGMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pO1xuICAgICAgZSA9IGUgKyBlQmlhcztcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IHZhbHVlICogTWF0aC5wb3coMiwgZUJpYXMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pO1xuICAgICAgZSA9IDA7XG4gICAgfVxuICB9XG5cbiAgZm9yICg7IG1MZW4gPj0gODsgYnVmZmVyW29mZnNldCArIGldID0gbSAmIDB4ZmYsIGkgKz0gZCwgbSAvPSAyNTYsIG1MZW4gLT0gOCk7XG5cbiAgZSA9IChlIDw8IG1MZW4pIHwgbTtcbiAgZUxlbiArPSBtTGVuO1xuICBmb3IgKDsgZUxlbiA+IDA7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IGUgJiAweGZmLCBpICs9IGQsIGUgLz0gMjU2LCBlTGVuIC09IDgpO1xuXG4gIGJ1ZmZlcltvZmZzZXQgKyBpIC0gZF0gfD0gcyAqIDEyODtcbn07XG5cbn0se31dLDg6W2Z1bmN0aW9uKHJlcXVpcmUsbW9kdWxlLGV4cG9ydHMpe1xuLy8gc2hpbSBmb3IgdXNpbmcgcHJvY2VzcyBpbiBicm93c2VyXG5cbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcblxucHJvY2Vzcy5uZXh0VGljayA9IChmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGNhblNldEltbWVkaWF0ZSA9IHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnXG4gICAgJiYgd2luZG93LnNldEltbWVkaWF0ZTtcbiAgICB2YXIgY2FuUG9zdCA9IHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnXG4gICAgJiYgd2luZG93LnBvc3RNZXNzYWdlICYmIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyXG4gICAgO1xuXG4gICAgaWYgKGNhblNldEltbWVkaWF0ZSkge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGYpIHsgcmV0dXJuIHdpbmRvdy5zZXRJbW1lZGlhdGUoZikgfTtcbiAgICB9XG5cbiAgICBpZiAoY2FuUG9zdCkge1xuICAgICAgICB2YXIgcXVldWUgPSBbXTtcbiAgICAgICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBmdW5jdGlvbiAoZXYpIHtcbiAgICAgICAgICAgIGlmIChldi5zb3VyY2UgPT09IHdpbmRvdyAmJiBldi5kYXRhID09PSAncHJvY2Vzcy10aWNrJykge1xuICAgICAgICAgICAgICAgIGV2LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgICAgIGlmIChxdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBmbiA9IHF1ZXVlLnNoaWZ0KCk7XG4gICAgICAgICAgICAgICAgICAgIGZuKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LCB0cnVlKTtcblxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gbmV4dFRpY2soZm4pIHtcbiAgICAgICAgICAgIHF1ZXVlLnB1c2goZm4pO1xuICAgICAgICAgICAgd2luZG93LnBvc3RNZXNzYWdlKCdwcm9jZXNzLXRpY2snLCAnKicpO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiBmdW5jdGlvbiBuZXh0VGljayhmbikge1xuICAgICAgICBzZXRUaW1lb3V0KGZuLCAwKTtcbiAgICB9O1xufSkoKTtcblxucHJvY2Vzcy50aXRsZSA9ICdicm93c2VyJztcbnByb2Nlc3MuYnJvd3NlciA9IHRydWU7XG5wcm9jZXNzLmVudiA9IHt9O1xucHJvY2Vzcy5hcmd2ID0gW107XG5cbnByb2Nlc3MuYmluZGluZyA9IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmJpbmRpbmcgaXMgbm90IHN1cHBvcnRlZCcpO1xufVxuXG4vLyBUT0RPKHNodHlsbWFuKVxucHJvY2Vzcy5jd2QgPSBmdW5jdGlvbiAoKSB7IHJldHVybiAnLycgfTtcbnByb2Nlc3MuY2hkaXIgPSBmdW5jdGlvbiAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5cbn0se31dLDY6W2Z1bmN0aW9uKHJlcXVpcmUsbW9kdWxlLGV4cG9ydHMpe1xuKGZ1bmN0aW9uKHByb2Nlc3Mpe2lmICghcHJvY2Vzcy5FdmVudEVtaXR0ZXIpIHByb2Nlc3MuRXZlbnRFbWl0dGVyID0gZnVuY3Rpb24gKCkge307XG5cbnZhciBFdmVudEVtaXR0ZXIgPSBleHBvcnRzLkV2ZW50RW1pdHRlciA9IHByb2Nlc3MuRXZlbnRFbWl0dGVyO1xudmFyIGlzQXJyYXkgPSB0eXBlb2YgQXJyYXkuaXNBcnJheSA9PT0gJ2Z1bmN0aW9uJ1xuICAgID8gQXJyYXkuaXNBcnJheVxuICAgIDogZnVuY3Rpb24gKHhzKSB7XG4gICAgICAgIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoeHMpID09PSAnW29iamVjdCBBcnJheV0nXG4gICAgfVxuO1xuZnVuY3Rpb24gaW5kZXhPZiAoeHMsIHgpIHtcbiAgICBpZiAoeHMuaW5kZXhPZikgcmV0dXJuIHhzLmluZGV4T2YoeCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB4cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAoeCA9PT0geHNbaV0pIHJldHVybiBpO1xuICAgIH1cbiAgICByZXR1cm4gLTE7XG59XG5cbi8vIEJ5IGRlZmF1bHQgRXZlbnRFbWl0dGVycyB3aWxsIHByaW50IGEgd2FybmluZyBpZiBtb3JlIHRoYW5cbi8vIDEwIGxpc3RlbmVycyBhcmUgYWRkZWQgdG8gaXQuIFRoaXMgaXMgYSB1c2VmdWwgZGVmYXVsdCB3aGljaFxuLy8gaGVscHMgZmluZGluZyBtZW1vcnkgbGVha3MuXG4vL1xuLy8gT2J2aW91c2x5IG5vdCBhbGwgRW1pdHRlcnMgc2hvdWxkIGJlIGxpbWl0ZWQgdG8gMTAuIFRoaXMgZnVuY3Rpb24gYWxsb3dzXG4vLyB0aGF0IHRvIGJlIGluY3JlYXNlZC4gU2V0IHRvIHplcm8gZm9yIHVubGltaXRlZC5cbnZhciBkZWZhdWx0TWF4TGlzdGVuZXJzID0gMTA7XG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnNldE1heExpc3RlbmVycyA9IGZ1bmN0aW9uKG4pIHtcbiAgaWYgKCF0aGlzLl9ldmVudHMpIHRoaXMuX2V2ZW50cyA9IHt9O1xuICB0aGlzLl9ldmVudHMubWF4TGlzdGVuZXJzID0gbjtcbn07XG5cblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5lbWl0ID0gZnVuY3Rpb24odHlwZSkge1xuICAvLyBJZiB0aGVyZSBpcyBubyAnZXJyb3InIGV2ZW50IGxpc3RlbmVyIHRoZW4gdGhyb3cuXG4gIGlmICh0eXBlID09PSAnZXJyb3InKSB7XG4gICAgaWYgKCF0aGlzLl9ldmVudHMgfHwgIXRoaXMuX2V2ZW50cy5lcnJvciB8fFxuICAgICAgICAoaXNBcnJheSh0aGlzLl9ldmVudHMuZXJyb3IpICYmICF0aGlzLl9ldmVudHMuZXJyb3IubGVuZ3RoKSlcbiAgICB7XG4gICAgICBpZiAoYXJndW1lbnRzWzFdIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgYXJndW1lbnRzWzFdOyAvLyBVbmhhbmRsZWQgJ2Vycm9yJyBldmVudFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVW5jYXVnaHQsIHVuc3BlY2lmaWVkICdlcnJvcicgZXZlbnQuXCIpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIGlmICghdGhpcy5fZXZlbnRzKSByZXR1cm4gZmFsc2U7XG4gIHZhciBoYW5kbGVyID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuICBpZiAoIWhhbmRsZXIpIHJldHVybiBmYWxzZTtcblxuICBpZiAodHlwZW9mIGhhbmRsZXIgPT0gJ2Z1bmN0aW9uJykge1xuICAgIHN3aXRjaCAoYXJndW1lbnRzLmxlbmd0aCkge1xuICAgICAgLy8gZmFzdCBjYXNlc1xuICAgICAgY2FzZSAxOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcyk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAyOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgYXJndW1lbnRzWzFdKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDM6XG4gICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzLCBhcmd1bWVudHNbMV0sIGFyZ3VtZW50c1syXSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgLy8gc2xvd2VyXG4gICAgICBkZWZhdWx0OlxuICAgICAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gICAgICAgIGhhbmRsZXIuYXBwbHkodGhpcywgYXJncyk7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuXG4gIH0gZWxzZSBpZiAoaXNBcnJheShoYW5kbGVyKSkge1xuICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcblxuICAgIHZhciBsaXN0ZW5lcnMgPSBoYW5kbGVyLnNsaWNlKCk7XG4gICAgZm9yICh2YXIgaSA9IDAsIGwgPSBsaXN0ZW5lcnMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICBsaXN0ZW5lcnNbaV0uYXBwbHkodGhpcywgYXJncyk7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuXG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59O1xuXG4vLyBFdmVudEVtaXR0ZXIgaXMgZGVmaW5lZCBpbiBzcmMvbm9kZV9ldmVudHMuY2Ncbi8vIEV2ZW50RW1pdHRlci5wcm90b3R5cGUuZW1pdCgpIGlzIGFsc28gZGVmaW5lZCB0aGVyZS5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXIgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICBpZiAoJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGxpc3RlbmVyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdhZGRMaXN0ZW5lciBvbmx5IHRha2VzIGluc3RhbmNlcyBvZiBGdW5jdGlvbicpO1xuICB9XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpIHRoaXMuX2V2ZW50cyA9IHt9O1xuXG4gIC8vIFRvIGF2b2lkIHJlY3Vyc2lvbiBpbiB0aGUgY2FzZSB0aGF0IHR5cGUgPT0gXCJuZXdMaXN0ZW5lcnNcIiEgQmVmb3JlXG4gIC8vIGFkZGluZyBpdCB0byB0aGUgbGlzdGVuZXJzLCBmaXJzdCBlbWl0IFwibmV3TGlzdGVuZXJzXCIuXG4gIHRoaXMuZW1pdCgnbmV3TGlzdGVuZXInLCB0eXBlLCBsaXN0ZW5lcik7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHNbdHlwZV0pIHtcbiAgICAvLyBPcHRpbWl6ZSB0aGUgY2FzZSBvZiBvbmUgbGlzdGVuZXIuIERvbid0IG5lZWQgdGhlIGV4dHJhIGFycmF5IG9iamVjdC5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0gPSBsaXN0ZW5lcjtcbiAgfSBlbHNlIGlmIChpc0FycmF5KHRoaXMuX2V2ZW50c1t0eXBlXSkpIHtcblxuICAgIC8vIENoZWNrIGZvciBsaXN0ZW5lciBsZWFrXG4gICAgaWYgKCF0aGlzLl9ldmVudHNbdHlwZV0ud2FybmVkKSB7XG4gICAgICB2YXIgbTtcbiAgICAgIGlmICh0aGlzLl9ldmVudHMubWF4TGlzdGVuZXJzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgbSA9IHRoaXMuX2V2ZW50cy5tYXhMaXN0ZW5lcnM7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBtID0gZGVmYXVsdE1heExpc3RlbmVycztcbiAgICAgIH1cblxuICAgICAgaWYgKG0gJiYgbSA+IDAgJiYgdGhpcy5fZXZlbnRzW3R5cGVdLmxlbmd0aCA+IG0pIHtcbiAgICAgICAgdGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZCA9IHRydWU7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJyhub2RlKSB3YXJuaW5nOiBwb3NzaWJsZSBFdmVudEVtaXR0ZXIgbWVtb3J5ICcgK1xuICAgICAgICAgICAgICAgICAgICAgICdsZWFrIGRldGVjdGVkLiAlZCBsaXN0ZW5lcnMgYWRkZWQuICcgK1xuICAgICAgICAgICAgICAgICAgICAgICdVc2UgZW1pdHRlci5zZXRNYXhMaXN0ZW5lcnMoKSB0byBpbmNyZWFzZSBsaW1pdC4nLFxuICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGgpO1xuICAgICAgICBjb25zb2xlLnRyYWNlKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSWYgd2UndmUgYWxyZWFkeSBnb3QgYW4gYXJyYXksIGp1c3QgYXBwZW5kLlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5wdXNoKGxpc3RlbmVyKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBBZGRpbmcgdGhlIHNlY29uZCBlbGVtZW50LCBuZWVkIHRvIGNoYW5nZSB0byBhcnJheS5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0gPSBbdGhpcy5fZXZlbnRzW3R5cGVdLCBsaXN0ZW5lcl07XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub24gPSBFdmVudEVtaXR0ZXIucHJvdG90eXBlLmFkZExpc3RlbmVyO1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLm9uY2UgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHNlbGYub24odHlwZSwgZnVuY3Rpb24gZygpIHtcbiAgICBzZWxmLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGcpO1xuICAgIGxpc3RlbmVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gIH0pO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVMaXN0ZW5lciA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIGlmICgnZnVuY3Rpb24nICE9PSB0eXBlb2YgbGlzdGVuZXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3JlbW92ZUxpc3RlbmVyIG9ubHkgdGFrZXMgaW5zdGFuY2VzIG9mIEZ1bmN0aW9uJyk7XG4gIH1cblxuICAvLyBkb2VzIG5vdCB1c2UgbGlzdGVuZXJzKCksIHNvIG5vIHNpZGUgZWZmZWN0IG9mIGNyZWF0aW5nIF9ldmVudHNbdHlwZV1cbiAgaWYgKCF0aGlzLl9ldmVudHMgfHwgIXRoaXMuX2V2ZW50c1t0eXBlXSkgcmV0dXJuIHRoaXM7XG5cbiAgdmFyIGxpc3QgPSB0aGlzLl9ldmVudHNbdHlwZV07XG5cbiAgaWYgKGlzQXJyYXkobGlzdCkpIHtcbiAgICB2YXIgaSA9IGluZGV4T2YobGlzdCwgbGlzdGVuZXIpO1xuICAgIGlmIChpIDwgMCkgcmV0dXJuIHRoaXM7XG4gICAgbGlzdC5zcGxpY2UoaSwgMSk7XG4gICAgaWYgKGxpc3QubGVuZ3RoID09IDApXG4gICAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICB9IGVsc2UgaWYgKHRoaXMuX2V2ZW50c1t0eXBlXSA9PT0gbGlzdGVuZXIpIHtcbiAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUFsbExpc3RlbmVycyA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIGRvZXMgbm90IHVzZSBsaXN0ZW5lcnMoKSwgc28gbm8gc2lkZSBlZmZlY3Qgb2YgY3JlYXRpbmcgX2V2ZW50c1t0eXBlXVxuICBpZiAodHlwZSAmJiB0aGlzLl9ldmVudHMgJiYgdGhpcy5fZXZlbnRzW3R5cGVdKSB0aGlzLl9ldmVudHNbdHlwZV0gPSBudWxsO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUubGlzdGVuZXJzID0gZnVuY3Rpb24odHlwZSkge1xuICBpZiAoIXRoaXMuX2V2ZW50cykgdGhpcy5fZXZlbnRzID0ge307XG4gIGlmICghdGhpcy5fZXZlbnRzW3R5cGVdKSB0aGlzLl9ldmVudHNbdHlwZV0gPSBbXTtcbiAgaWYgKCFpc0FycmF5KHRoaXMuX2V2ZW50c1t0eXBlXSkpIHtcbiAgICB0aGlzLl9ldmVudHNbdHlwZV0gPSBbdGhpcy5fZXZlbnRzW3R5cGVdXTtcbiAgfVxuICByZXR1cm4gdGhpcy5fZXZlbnRzW3R5cGVdO1xufTtcblxufSkocmVxdWlyZShcIl9fYnJvd3NlcmlmeV9wcm9jZXNzXCIpKVxufSx7XCJfX2Jyb3dzZXJpZnlfcHJvY2Vzc1wiOjh9XSw0OltmdW5jdGlvbihyZXF1aXJlLG1vZHVsZSxleHBvcnRzKXtcbihmdW5jdGlvbigpe2Z1bmN0aW9uIFNsb3dCdWZmZXIgKHNpemUpIHtcbiAgICB0aGlzLmxlbmd0aCA9IHNpemU7XG59O1xuXG52YXIgYXNzZXJ0ID0gcmVxdWlyZSgnYXNzZXJ0Jyk7XG5cbmV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVMgPSA1MDtcblxuXG5mdW5jdGlvbiB0b0hleChuKSB7XG4gIGlmIChuIDwgMTYpIHJldHVybiAnMCcgKyBuLnRvU3RyaW5nKDE2KTtcbiAgcmV0dXJuIG4udG9TdHJpbmcoMTYpO1xufVxuXG5mdW5jdGlvbiB1dGY4VG9CeXRlcyhzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKylcbiAgICBpZiAoc3RyLmNoYXJDb2RlQXQoaSkgPD0gMHg3RilcbiAgICAgIGJ5dGVBcnJheS5wdXNoKHN0ci5jaGFyQ29kZUF0KGkpKTtcbiAgICBlbHNlIHtcbiAgICAgIHZhciBoID0gZW5jb2RlVVJJQ29tcG9uZW50KHN0ci5jaGFyQXQoaSkpLnN1YnN0cigxKS5zcGxpdCgnJScpO1xuICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBoLmxlbmd0aDsgaisrKVxuICAgICAgICBieXRlQXJyYXkucHVzaChwYXJzZUludChoW2pdLCAxNikpO1xuICAgIH1cblxuICByZXR1cm4gYnl0ZUFycmF5O1xufVxuXG5mdW5jdGlvbiBhc2NpaVRvQnl0ZXMoc3RyKSB7XG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKyApXG4gICAgLy8gTm9kZSdzIGNvZGUgc2VlbXMgdG8gYmUgZG9pbmcgdGhpcyBhbmQgbm90ICYgMHg3Ri4uXG4gICAgYnl0ZUFycmF5LnB1c2goIHN0ci5jaGFyQ29kZUF0KGkpICYgMHhGRiApO1xuXG4gIHJldHVybiBieXRlQXJyYXk7XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFRvQnl0ZXMoc3RyKSB7XG4gIHJldHVybiByZXF1aXJlKFwiYmFzZTY0LWpzXCIpLnRvQnl0ZUFycmF5KHN0cik7XG59XG5cblNsb3dCdWZmZXIuYnl0ZUxlbmd0aCA9IGZ1bmN0aW9uIChzdHIsIGVuY29kaW5nKSB7XG4gIHN3aXRjaCAoZW5jb2RpbmcgfHwgXCJ1dGY4XCIpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgICAgcmV0dXJuIHN0ci5sZW5ndGggLyAyO1xuXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0dXJuIHV0ZjhUb0J5dGVzKHN0cikubGVuZ3RoO1xuXG4gICAgY2FzZSAnYXNjaWknOlxuICAgICAgcmV0dXJuIHN0ci5sZW5ndGg7XG5cbiAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgcmV0dXJuIGJhc2U2NFRvQnl0ZXMoc3RyKS5sZW5ndGg7XG5cbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIGVuY29kaW5nJyk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIGJsaXRCdWZmZXIoc3JjLCBkc3QsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBwb3MsIGkgPSAwO1xuICB3aGlsZSAoaSA8IGxlbmd0aCkge1xuICAgIGlmICgoaStvZmZzZXQgPj0gZHN0Lmxlbmd0aCkgfHwgKGkgPj0gc3JjLmxlbmd0aCkpXG4gICAgICBicmVhaztcblxuICAgIGRzdFtpICsgb2Zmc2V0XSA9IHNyY1tpXTtcbiAgICBpKys7XG4gIH1cbiAgcmV0dXJuIGk7XG59XG5cblNsb3dCdWZmZXIucHJvdG90eXBlLnV0ZjhXcml0ZSA9IGZ1bmN0aW9uIChzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBieXRlcywgcG9zO1xuICByZXR1cm4gU2xvd0J1ZmZlci5fY2hhcnNXcml0dGVuID0gIGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nKSwgdGhpcywgb2Zmc2V0LCBsZW5ndGgpO1xufTtcblxuU2xvd0J1ZmZlci5wcm90b3R5cGUuYXNjaWlXcml0ZSA9IGZ1bmN0aW9uIChzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBieXRlcywgcG9zO1xuICByZXR1cm4gU2xvd0J1ZmZlci5fY2hhcnNXcml0dGVuID0gIGJsaXRCdWZmZXIoYXNjaWlUb0J5dGVzKHN0cmluZyksIHRoaXMsIG9mZnNldCwgbGVuZ3RoKTtcbn07XG5cblNsb3dCdWZmZXIucHJvdG90eXBlLmJhc2U2NFdyaXRlID0gZnVuY3Rpb24gKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGJ5dGVzLCBwb3M7XG4gIHJldHVybiBTbG93QnVmZmVyLl9jaGFyc1dyaXR0ZW4gPSBibGl0QnVmZmVyKGJhc2U2NFRvQnl0ZXMoc3RyaW5nKSwgdGhpcywgb2Zmc2V0LCBsZW5ndGgpO1xufTtcblxuU2xvd0J1ZmZlci5wcm90b3R5cGUuYmFzZTY0U2xpY2UgPSBmdW5jdGlvbiAoc3RhcnQsIGVuZCkge1xuICB2YXIgYnl0ZXMgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICByZXR1cm4gcmVxdWlyZShcImJhc2U2NC1qc1wiKS5mcm9tQnl0ZUFycmF5KGJ5dGVzKTtcbn1cblxuZnVuY3Rpb24gZGVjb2RlVXRmOENoYXIoc3RyKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChzdHIpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZSgweEZGRkQpOyAvLyBVVEYgOCBpbnZhbGlkIGNoYXJcbiAgfVxufVxuXG5TbG93QnVmZmVyLnByb3RvdHlwZS51dGY4U2xpY2UgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBieXRlcyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICB2YXIgcmVzID0gXCJcIjtcbiAgdmFyIHRtcCA9IFwiXCI7XG4gIHZhciBpID0gMDtcbiAgd2hpbGUgKGkgPCBieXRlcy5sZW5ndGgpIHtcbiAgICBpZiAoYnl0ZXNbaV0gPD0gMHg3Rikge1xuICAgICAgcmVzICs9IGRlY29kZVV0ZjhDaGFyKHRtcCkgKyBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW2ldKTtcbiAgICAgIHRtcCA9IFwiXCI7XG4gICAgfSBlbHNlXG4gICAgICB0bXAgKz0gXCIlXCIgKyBieXRlc1tpXS50b1N0cmluZygxNik7XG5cbiAgICBpKys7XG4gIH1cblxuICByZXR1cm4gcmVzICsgZGVjb2RlVXRmOENoYXIodG1wKTtcbn1cblxuU2xvd0J1ZmZlci5wcm90b3R5cGUuYXNjaWlTbGljZSA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIGJ5dGVzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gIHZhciByZXQgPSBcIlwiO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSsrKVxuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW2ldKTtcbiAgcmV0dXJuIHJldDtcbn1cblxuU2xvd0J1ZmZlci5wcm90b3R5cGUuaW5zcGVjdCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgb3V0ID0gW10sXG4gICAgICBsZW4gPSB0aGlzLmxlbmd0aDtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgIG91dFtpXSA9IHRvSGV4KHRoaXNbaV0pO1xuICAgIGlmIChpID09IGV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVMpIHtcbiAgICAgIG91dFtpICsgMV0gPSAnLi4uJztcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gJzxTbG93QnVmZmVyICcgKyBvdXQuam9pbignICcpICsgJz4nO1xufTtcblxuXG5TbG93QnVmZmVyLnByb3RvdHlwZS5oZXhTbGljZSA9IGZ1bmN0aW9uKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoO1xuXG4gIGlmICghc3RhcnQgfHwgc3RhcnQgPCAwKSBzdGFydCA9IDA7XG4gIGlmICghZW5kIHx8IGVuZCA8IDAgfHwgZW5kID4gbGVuKSBlbmQgPSBsZW47XG5cbiAgdmFyIG91dCA9ICcnO1xuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIG91dCArPSB0b0hleCh0aGlzW2ldKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufTtcblxuXG5TbG93QnVmZmVyLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKGVuY29kaW5nLCBzdGFydCwgZW5kKSB7XG4gIGVuY29kaW5nID0gU3RyaW5nKGVuY29kaW5nIHx8ICd1dGY4JykudG9Mb3dlckNhc2UoKTtcbiAgc3RhcnQgPSArc3RhcnQgfHwgMDtcbiAgaWYgKHR5cGVvZiBlbmQgPT0gJ3VuZGVmaW5lZCcpIGVuZCA9IHRoaXMubGVuZ3RoO1xuXG4gIC8vIEZhc3RwYXRoIGVtcHR5IHN0cmluZ3NcbiAgaWYgKCtlbmQgPT0gc3RhcnQpIHtcbiAgICByZXR1cm4gJyc7XG4gIH1cblxuICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldHVybiB0aGlzLmhleFNsaWNlKHN0YXJ0LCBlbmQpO1xuXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0dXJuIHRoaXMudXRmOFNsaWNlKHN0YXJ0LCBlbmQpO1xuXG4gICAgY2FzZSAnYXNjaWknOlxuICAgICAgcmV0dXJuIHRoaXMuYXNjaWlTbGljZShzdGFydCwgZW5kKTtcblxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICByZXR1cm4gdGhpcy5iaW5hcnlTbGljZShzdGFydCwgZW5kKTtcblxuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXR1cm4gdGhpcy5iYXNlNjRTbGljZShzdGFydCwgZW5kKTtcblxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIHJldHVybiB0aGlzLnVjczJTbGljZShzdGFydCwgZW5kKTtcblxuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Vua25vd24gZW5jb2RpbmcnKTtcbiAgfVxufTtcblxuXG5TbG93QnVmZmVyLnByb3RvdHlwZS5oZXhXcml0ZSA9IGZ1bmN0aW9uKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgb2Zmc2V0ID0gK29mZnNldCB8fCAwO1xuICB2YXIgcmVtYWluaW5nID0gdGhpcy5sZW5ndGggLSBvZmZzZXQ7XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nO1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9ICtsZW5ndGg7XG4gICAgaWYgKGxlbmd0aCA+IHJlbWFpbmluZykge1xuICAgICAgbGVuZ3RoID0gcmVtYWluaW5nO1xuICAgIH1cbiAgfVxuXG4gIC8vIG11c3QgYmUgYW4gZXZlbiBudW1iZXIgb2YgZGlnaXRzXG4gIHZhciBzdHJMZW4gPSBzdHJpbmcubGVuZ3RoO1xuICBpZiAoc3RyTGVuICUgMikge1xuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJyk7XG4gIH1cbiAgaWYgKGxlbmd0aCA+IHN0ckxlbiAvIDIpIHtcbiAgICBsZW5ndGggPSBzdHJMZW4gLyAyO1xuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgYnl0ZSA9IHBhcnNlSW50KHN0cmluZy5zdWJzdHIoaSAqIDIsIDIpLCAxNik7XG4gICAgaWYgKGlzTmFOKGJ5dGUpKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpO1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSBieXRlO1xuICB9XG4gIFNsb3dCdWZmZXIuX2NoYXJzV3JpdHRlbiA9IGkgKiAyO1xuICByZXR1cm4gaTtcbn07XG5cblxuU2xvd0J1ZmZlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbihzdHJpbmcsIG9mZnNldCwgbGVuZ3RoLCBlbmNvZGluZykge1xuICAvLyBTdXBwb3J0IGJvdGggKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKVxuICAvLyBhbmQgdGhlIGxlZ2FjeSAoc3RyaW5nLCBlbmNvZGluZywgb2Zmc2V0LCBsZW5ndGgpXG4gIGlmIChpc0Zpbml0ZShvZmZzZXQpKSB7XG4gICAgaWYgKCFpc0Zpbml0ZShsZW5ndGgpKSB7XG4gICAgICBlbmNvZGluZyA9IGxlbmd0aDtcbiAgICAgIGxlbmd0aCA9IHVuZGVmaW5lZDtcbiAgICB9XG4gIH0gZWxzZSB7ICAvLyBsZWdhY3lcbiAgICB2YXIgc3dhcCA9IGVuY29kaW5nO1xuICAgIGVuY29kaW5nID0gb2Zmc2V0O1xuICAgIG9mZnNldCA9IGxlbmd0aDtcbiAgICBsZW5ndGggPSBzd2FwO1xuICB9XG5cbiAgb2Zmc2V0ID0gK29mZnNldCB8fCAwO1xuICB2YXIgcmVtYWluaW5nID0gdGhpcy5sZW5ndGggLSBvZmZzZXQ7XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nO1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9ICtsZW5ndGg7XG4gICAgaWYgKGxlbmd0aCA+IHJlbWFpbmluZykge1xuICAgICAgbGVuZ3RoID0gcmVtYWluaW5nO1xuICAgIH1cbiAgfVxuICBlbmNvZGluZyA9IFN0cmluZyhlbmNvZGluZyB8fCAndXRmOCcpLnRvTG93ZXJDYXNlKCk7XG5cbiAgc3dpdGNoIChlbmNvZGluZykge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgICByZXR1cm4gdGhpcy5oZXhXcml0ZShzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKTtcblxuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgIHJldHVybiB0aGlzLnV0ZjhXcml0ZShzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKTtcblxuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIHJldHVybiB0aGlzLmFzY2lpV3JpdGUoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCk7XG5cbiAgICBjYXNlICdiaW5hcnknOlxuICAgICAgcmV0dXJuIHRoaXMuYmluYXJ5V3JpdGUoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCk7XG5cbiAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgcmV0dXJuIHRoaXMuYmFzZTY0V3JpdGUoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCk7XG5cbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgICByZXR1cm4gdGhpcy51Y3MyV3JpdGUoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCk7XG5cbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIGVuY29kaW5nJyk7XG4gIH1cbn07XG5cblxuLy8gc2xpY2Uoc3RhcnQsIGVuZClcblNsb3dCdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24oc3RhcnQsIGVuZCkge1xuICBpZiAoZW5kID09PSB1bmRlZmluZWQpIGVuZCA9IHRoaXMubGVuZ3RoO1xuXG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBFcnJvcignb29iJyk7XG4gIH1cbiAgaWYgKHN0YXJ0ID4gZW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdvb2InKTtcbiAgfVxuXG4gIHJldHVybiBuZXcgQnVmZmVyKHRoaXMsIGVuZCAtIHN0YXJ0LCArc3RhcnQpO1xufTtcblxuU2xvd0J1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKHRhcmdldCwgdGFyZ2V0c3RhcnQsIHNvdXJjZXN0YXJ0LCBzb3VyY2VlbmQpIHtcbiAgdmFyIHRlbXAgPSBbXTtcbiAgZm9yICh2YXIgaT1zb3VyY2VzdGFydDsgaTxzb3VyY2VlbmQ7IGkrKykge1xuICAgIGFzc2VydC5vayh0eXBlb2YgdGhpc1tpXSAhPT0gJ3VuZGVmaW5lZCcsIFwiY29weWluZyB1bmRlZmluZWQgYnVmZmVyIGJ5dGVzIVwiKTtcbiAgICB0ZW1wLnB1c2godGhpc1tpXSk7XG4gIH1cblxuICBmb3IgKHZhciBpPXRhcmdldHN0YXJ0OyBpPHRhcmdldHN0YXJ0K3RlbXAubGVuZ3RoOyBpKyspIHtcbiAgICB0YXJnZXRbaV0gPSB0ZW1wW2ktdGFyZ2V0c3RhcnRdO1xuICB9XG59O1xuXG5mdW5jdGlvbiBjb2VyY2UobGVuZ3RoKSB7XG4gIC8vIENvZXJjZSBsZW5ndGggdG8gYSBudW1iZXIgKHBvc3NpYmx5IE5hTiksIHJvdW5kIHVwXG4gIC8vIGluIGNhc2UgaXQncyBmcmFjdGlvbmFsIChlLmcuIDEyMy40NTYpIHRoZW4gZG8gYVxuICAvLyBkb3VibGUgbmVnYXRlIHRvIGNvZXJjZSBhIE5hTiB0byAwLiBFYXN5LCByaWdodD9cbiAgbGVuZ3RoID0gfn5NYXRoLmNlaWwoK2xlbmd0aCk7XG4gIHJldHVybiBsZW5ndGggPCAwID8gMCA6IGxlbmd0aDtcbn1cblxuXG4vLyBCdWZmZXJcblxuZnVuY3Rpb24gQnVmZmVyKHN1YmplY3QsIGVuY29kaW5nLCBvZmZzZXQpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEJ1ZmZlcikpIHtcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZywgb2Zmc2V0KTtcbiAgfVxuXG4gIHZhciB0eXBlO1xuXG4gIC8vIEFyZSB3ZSBzbGljaW5nP1xuICBpZiAodHlwZW9mIG9mZnNldCA9PT0gJ251bWJlcicpIHtcbiAgICB0aGlzLmxlbmd0aCA9IGNvZXJjZShlbmNvZGluZyk7XG4gICAgdGhpcy5wYXJlbnQgPSBzdWJqZWN0O1xuICAgIHRoaXMub2Zmc2V0ID0gb2Zmc2V0O1xuICB9IGVsc2Uge1xuICAgIC8vIEZpbmQgdGhlIGxlbmd0aFxuICAgIHN3aXRjaCAodHlwZSA9IHR5cGVvZiBzdWJqZWN0KSB7XG4gICAgICBjYXNlICdudW1iZXInOlxuICAgICAgICB0aGlzLmxlbmd0aCA9IGNvZXJjZShzdWJqZWN0KTtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICAgIHRoaXMubGVuZ3RoID0gQnVmZmVyLmJ5dGVMZW5ndGgoc3ViamVjdCwgZW5jb2RpbmcpO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAnb2JqZWN0JzogLy8gQXNzdW1lIG9iamVjdCBpcyBhbiBhcnJheVxuICAgICAgICB0aGlzLmxlbmd0aCA9IGNvZXJjZShzdWJqZWN0Lmxlbmd0aCk7XG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpcnN0IGFyZ3VtZW50IG5lZWRzIHRvIGJlIGEgbnVtYmVyLCAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICdhcnJheSBvciBzdHJpbmcuJyk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMubGVuZ3RoID4gQnVmZmVyLnBvb2xTaXplKSB7XG4gICAgICAvLyBCaWcgYnVmZmVyLCBqdXN0IGFsbG9jIG9uZS5cbiAgICAgIHRoaXMucGFyZW50ID0gbmV3IFNsb3dCdWZmZXIodGhpcy5sZW5ndGgpO1xuICAgICAgdGhpcy5vZmZzZXQgPSAwO1xuXG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFNtYWxsIGJ1ZmZlci5cbiAgICAgIGlmICghcG9vbCB8fCBwb29sLmxlbmd0aCAtIHBvb2wudXNlZCA8IHRoaXMubGVuZ3RoKSBhbGxvY1Bvb2woKTtcbiAgICAgIHRoaXMucGFyZW50ID0gcG9vbDtcbiAgICAgIHRoaXMub2Zmc2V0ID0gcG9vbC51c2VkO1xuICAgICAgcG9vbC51c2VkICs9IHRoaXMubGVuZ3RoO1xuICAgIH1cblxuICAgIC8vIFRyZWF0IGFycmF5LWlzaCBvYmplY3RzIGFzIGEgYnl0ZSBhcnJheS5cbiAgICBpZiAoaXNBcnJheUlzaChzdWJqZWN0KSkge1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHRoaXMucGFyZW50W2kgKyB0aGlzLm9mZnNldF0gPSBzdWJqZWN0W2ldO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodHlwZSA9PSAnc3RyaW5nJykge1xuICAgICAgLy8gV2UgYXJlIGEgc3RyaW5nXG4gICAgICB0aGlzLmxlbmd0aCA9IHRoaXMud3JpdGUoc3ViamVjdCwgMCwgZW5jb2RpbmcpO1xuICAgIH1cbiAgfVxuXG59XG5cbmZ1bmN0aW9uIGlzQXJyYXlJc2goc3ViamVjdCkge1xuICByZXR1cm4gQXJyYXkuaXNBcnJheShzdWJqZWN0KSB8fCBCdWZmZXIuaXNCdWZmZXIoc3ViamVjdCkgfHxcbiAgICAgICAgIHN1YmplY3QgJiYgdHlwZW9mIHN1YmplY3QgPT09ICdvYmplY3QnICYmXG4gICAgICAgICB0eXBlb2Ygc3ViamVjdC5sZW5ndGggPT09ICdudW1iZXInO1xufVxuXG5leHBvcnRzLlNsb3dCdWZmZXIgPSBTbG93QnVmZmVyO1xuZXhwb3J0cy5CdWZmZXIgPSBCdWZmZXI7XG5cbkJ1ZmZlci5wb29sU2l6ZSA9IDggKiAxMDI0O1xudmFyIHBvb2w7XG5cbmZ1bmN0aW9uIGFsbG9jUG9vbCgpIHtcbiAgcG9vbCA9IG5ldyBTbG93QnVmZmVyKEJ1ZmZlci5wb29sU2l6ZSk7XG4gIHBvb2wudXNlZCA9IDA7XG59XG5cblxuLy8gU3RhdGljIG1ldGhvZHNcbkJ1ZmZlci5pc0J1ZmZlciA9IGZ1bmN0aW9uIGlzQnVmZmVyKGIpIHtcbiAgcmV0dXJuIGIgaW5zdGFuY2VvZiBCdWZmZXIgfHwgYiBpbnN0YW5jZW9mIFNsb3dCdWZmZXI7XG59O1xuXG5CdWZmZXIuY29uY2F0ID0gZnVuY3Rpb24gKGxpc3QsIHRvdGFsTGVuZ3RoKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShsaXN0KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlVzYWdlOiBCdWZmZXIuY29uY2F0KGxpc3QsIFt0b3RhbExlbmd0aF0pXFxuIFxcXG4gICAgICBsaXN0IHNob3VsZCBiZSBhbiBBcnJheS5cIik7XG4gIH1cblxuICBpZiAobGlzdC5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcigwKTtcbiAgfSBlbHNlIGlmIChsaXN0Lmxlbmd0aCA9PT0gMSkge1xuICAgIHJldHVybiBsaXN0WzBdO1xuICB9XG5cbiAgaWYgKHR5cGVvZiB0b3RhbExlbmd0aCAhPT0gJ251bWJlcicpIHtcbiAgICB0b3RhbExlbmd0aCA9IDA7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgYnVmID0gbGlzdFtpXTtcbiAgICAgIHRvdGFsTGVuZ3RoICs9IGJ1Zi5sZW5ndGg7XG4gICAgfVxuICB9XG5cbiAgdmFyIGJ1ZmZlciA9IG5ldyBCdWZmZXIodG90YWxMZW5ndGgpO1xuICB2YXIgcG9zID0gMDtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGJ1ZiA9IGxpc3RbaV07XG4gICAgYnVmLmNvcHkoYnVmZmVyLCBwb3MpO1xuICAgIHBvcyArPSBidWYubGVuZ3RoO1xuICB9XG4gIHJldHVybiBidWZmZXI7XG59O1xuXG4vLyBJbnNwZWN0XG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiBpbnNwZWN0KCkge1xuICB2YXIgb3V0ID0gW10sXG4gICAgICBsZW4gPSB0aGlzLmxlbmd0aDtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgb3V0W2ldID0gdG9IZXgodGhpcy5wYXJlbnRbaSArIHRoaXMub2Zmc2V0XSk7XG4gICAgaWYgKGkgPT0gZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFUykge1xuICAgICAgb3V0W2kgKyAxXSA9ICcuLi4nO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuICc8QnVmZmVyICcgKyBvdXQuam9pbignICcpICsgJz4nO1xufTtcblxuXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIGdldChpKSB7XG4gIGlmIChpIDwgMCB8fCBpID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgRXJyb3IoJ29vYicpO1xuICByZXR1cm4gdGhpcy5wYXJlbnRbdGhpcy5vZmZzZXQgKyBpXTtcbn07XG5cblxuQnVmZmVyLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiBzZXQoaSwgdikge1xuICBpZiAoaSA8IDAgfHwgaSA+PSB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IEVycm9yKCdvb2InKTtcbiAgcmV0dXJuIHRoaXMucGFyZW50W3RoaXMub2Zmc2V0ICsgaV0gPSB2O1xufTtcblxuXG4vLyB3cml0ZShzdHJpbmcsIG9mZnNldCA9IDAsIGxlbmd0aCA9IGJ1ZmZlci5sZW5ndGgtb2Zmc2V0LCBlbmNvZGluZyA9ICd1dGY4JylcbkJ1ZmZlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbihzdHJpbmcsIG9mZnNldCwgbGVuZ3RoLCBlbmNvZGluZykge1xuICAvLyBTdXBwb3J0IGJvdGggKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKVxuICAvLyBhbmQgdGhlIGxlZ2FjeSAoc3RyaW5nLCBlbmNvZGluZywgb2Zmc2V0LCBsZW5ndGgpXG4gIGlmIChpc0Zpbml0ZShvZmZzZXQpKSB7XG4gICAgaWYgKCFpc0Zpbml0ZShsZW5ndGgpKSB7XG4gICAgICBlbmNvZGluZyA9IGxlbmd0aDtcbiAgICAgIGxlbmd0aCA9IHVuZGVmaW5lZDtcbiAgICB9XG4gIH0gZWxzZSB7ICAvLyBsZWdhY3lcbiAgICB2YXIgc3dhcCA9IGVuY29kaW5nO1xuICAgIGVuY29kaW5nID0gb2Zmc2V0O1xuICAgIG9mZnNldCA9IGxlbmd0aDtcbiAgICBsZW5ndGggPSBzd2FwO1xuICB9XG5cbiAgb2Zmc2V0ID0gK29mZnNldCB8fCAwO1xuICB2YXIgcmVtYWluaW5nID0gdGhpcy5sZW5ndGggLSBvZmZzZXQ7XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nO1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9ICtsZW5ndGg7XG4gICAgaWYgKGxlbmd0aCA+IHJlbWFpbmluZykge1xuICAgICAgbGVuZ3RoID0gcmVtYWluaW5nO1xuICAgIH1cbiAgfVxuICBlbmNvZGluZyA9IFN0cmluZyhlbmNvZGluZyB8fCAndXRmOCcpLnRvTG93ZXJDYXNlKCk7XG5cbiAgdmFyIHJldDtcbiAgc3dpdGNoIChlbmNvZGluZykge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgICByZXQgPSB0aGlzLnBhcmVudC5oZXhXcml0ZShzdHJpbmcsIHRoaXMub2Zmc2V0ICsgb2Zmc2V0LCBsZW5ndGgpO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgICByZXQgPSB0aGlzLnBhcmVudC51dGY4V3JpdGUoc3RyaW5nLCB0aGlzLm9mZnNldCArIG9mZnNldCwgbGVuZ3RoKTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnYXNjaWknOlxuICAgICAgcmV0ID0gdGhpcy5wYXJlbnQuYXNjaWlXcml0ZShzdHJpbmcsIHRoaXMub2Zmc2V0ICsgb2Zmc2V0LCBsZW5ndGgpO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICdiaW5hcnknOlxuICAgICAgcmV0ID0gdGhpcy5wYXJlbnQuYmluYXJ5V3JpdGUoc3RyaW5nLCB0aGlzLm9mZnNldCArIG9mZnNldCwgbGVuZ3RoKTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgIC8vIFdhcm5pbmc6IG1heExlbmd0aCBub3QgdGFrZW4gaW50byBhY2NvdW50IGluIGJhc2U2NFdyaXRlXG4gICAgICByZXQgPSB0aGlzLnBhcmVudC5iYXNlNjRXcml0ZShzdHJpbmcsIHRoaXMub2Zmc2V0ICsgb2Zmc2V0LCBsZW5ndGgpO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgICByZXQgPSB0aGlzLnBhcmVudC51Y3MyV3JpdGUoc3RyaW5nLCB0aGlzLm9mZnNldCArIG9mZnNldCwgbGVuZ3RoKTtcbiAgICAgIGJyZWFrO1xuXG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biBlbmNvZGluZycpO1xuICB9XG5cbiAgQnVmZmVyLl9jaGFyc1dyaXR0ZW4gPSBTbG93QnVmZmVyLl9jaGFyc1dyaXR0ZW47XG5cbiAgcmV0dXJuIHJldDtcbn07XG5cblxuLy8gdG9TdHJpbmcoZW5jb2RpbmcsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKGVuY29kaW5nLCBzdGFydCwgZW5kKSB7XG4gIGVuY29kaW5nID0gU3RyaW5nKGVuY29kaW5nIHx8ICd1dGY4JykudG9Mb3dlckNhc2UoKTtcblxuICBpZiAodHlwZW9mIHN0YXJ0ID09ICd1bmRlZmluZWQnIHx8IHN0YXJ0IDwgMCkge1xuICAgIHN0YXJ0ID0gMDtcbiAgfSBlbHNlIGlmIChzdGFydCA+IHRoaXMubGVuZ3RoKSB7XG4gICAgc3RhcnQgPSB0aGlzLmxlbmd0aDtcbiAgfVxuXG4gIGlmICh0eXBlb2YgZW5kID09ICd1bmRlZmluZWQnIHx8IGVuZCA+IHRoaXMubGVuZ3RoKSB7XG4gICAgZW5kID0gdGhpcy5sZW5ndGg7XG4gIH0gZWxzZSBpZiAoZW5kIDwgMCkge1xuICAgIGVuZCA9IDA7XG4gIH1cblxuICBzdGFydCA9IHN0YXJ0ICsgdGhpcy5vZmZzZXQ7XG4gIGVuZCA9IGVuZCArIHRoaXMub2Zmc2V0O1xuXG4gIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgICAgcmV0dXJuIHRoaXMucGFyZW50LmhleFNsaWNlKHN0YXJ0LCBlbmQpO1xuXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0dXJuIHRoaXMucGFyZW50LnV0ZjhTbGljZShzdGFydCwgZW5kKTtcblxuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIHJldHVybiB0aGlzLnBhcmVudC5hc2NpaVNsaWNlKHN0YXJ0LCBlbmQpO1xuXG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgIHJldHVybiB0aGlzLnBhcmVudC5iaW5hcnlTbGljZShzdGFydCwgZW5kKTtcblxuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXR1cm4gdGhpcy5wYXJlbnQuYmFzZTY0U2xpY2Uoc3RhcnQsIGVuZCk7XG5cbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgICByZXR1cm4gdGhpcy5wYXJlbnQudWNzMlNsaWNlKHN0YXJ0LCBlbmQpO1xuXG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biBlbmNvZGluZycpO1xuICB9XG59O1xuXG5cbi8vIGJ5dGVMZW5ndGhcbkJ1ZmZlci5ieXRlTGVuZ3RoID0gU2xvd0J1ZmZlci5ieXRlTGVuZ3RoO1xuXG5cbi8vIGZpbGwodmFsdWUsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5maWxsID0gZnVuY3Rpb24gZmlsbCh2YWx1ZSwgc3RhcnQsIGVuZCkge1xuICB2YWx1ZSB8fCAodmFsdWUgPSAwKTtcbiAgc3RhcnQgfHwgKHN0YXJ0ID0gMCk7XG4gIGVuZCB8fCAoZW5kID0gdGhpcy5sZW5ndGgpO1xuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgdmFsdWUgPSB2YWx1ZS5jaGFyQ29kZUF0KDApO1xuICB9XG4gIGlmICghKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicpIHx8IGlzTmFOKHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBFcnJvcigndmFsdWUgaXMgbm90IGEgbnVtYmVyJyk7XG4gIH1cblxuICBpZiAoZW5kIDwgc3RhcnQpIHRocm93IG5ldyBFcnJvcignZW5kIDwgc3RhcnQnKTtcblxuICAvLyBGaWxsIDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVybiAwO1xuICBpZiAodGhpcy5sZW5ndGggPT0gMCkgcmV0dXJuIDA7XG5cbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBFcnJvcignc3RhcnQgb3V0IG9mIGJvdW5kcycpO1xuICB9XG5cbiAgaWYgKGVuZCA8IDAgfHwgZW5kID4gdGhpcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2VuZCBvdXQgb2YgYm91bmRzJyk7XG4gIH1cblxuICByZXR1cm4gdGhpcy5wYXJlbnQuZmlsbCh2YWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhcnQgKyB0aGlzLm9mZnNldCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgZW5kICsgdGhpcy5vZmZzZXQpO1xufTtcblxuXG4vLyBjb3B5KHRhcmdldEJ1ZmZlciwgdGFyZ2V0U3RhcnQ9MCwgc291cmNlU3RhcnQ9MCwgc291cmNlRW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbih0YXJnZXQsIHRhcmdldF9zdGFydCwgc3RhcnQsIGVuZCkge1xuICB2YXIgc291cmNlID0gdGhpcztcbiAgc3RhcnQgfHwgKHN0YXJ0ID0gMCk7XG4gIGVuZCB8fCAoZW5kID0gdGhpcy5sZW5ndGgpO1xuICB0YXJnZXRfc3RhcnQgfHwgKHRhcmdldF9zdGFydCA9IDApO1xuXG4gIGlmIChlbmQgPCBzdGFydCkgdGhyb3cgbmV3IEVycm9yKCdzb3VyY2VFbmQgPCBzb3VyY2VTdGFydCcpO1xuXG4gIC8vIENvcHkgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuIDA7XG4gIGlmICh0YXJnZXQubGVuZ3RoID09IDAgfHwgc291cmNlLmxlbmd0aCA9PSAwKSByZXR1cm4gMDtcblxuICBpZiAodGFyZ2V0X3N0YXJ0IDwgMCB8fCB0YXJnZXRfc3RhcnQgPj0gdGFyZ2V0Lmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBFcnJvcigndGFyZ2V0U3RhcnQgb3V0IG9mIGJvdW5kcycpO1xuICB9XG5cbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSBzb3VyY2UubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzb3VyY2VTdGFydCBvdXQgb2YgYm91bmRzJyk7XG4gIH1cblxuICBpZiAoZW5kIDwgMCB8fCBlbmQgPiBzb3VyY2UubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzb3VyY2VFbmQgb3V0IG9mIGJvdW5kcycpO1xuICB9XG5cbiAgLy8gQXJlIHdlIG9vYj9cbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSB7XG4gICAgZW5kID0gdGhpcy5sZW5ndGg7XG4gIH1cblxuICBpZiAodGFyZ2V0Lmxlbmd0aCAtIHRhcmdldF9zdGFydCA8IGVuZCAtIHN0YXJ0KSB7XG4gICAgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldF9zdGFydCArIHN0YXJ0O1xuICB9XG5cbiAgcmV0dXJuIHRoaXMucGFyZW50LmNvcHkodGFyZ2V0LnBhcmVudCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0X3N0YXJ0ICsgdGFyZ2V0Lm9mZnNldCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhcnQgKyB0aGlzLm9mZnNldCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgZW5kICsgdGhpcy5vZmZzZXQpO1xufTtcblxuXG4vLyBzbGljZShzdGFydCwgZW5kKVxuQnVmZmVyLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uKHN0YXJ0LCBlbmQpIHtcbiAgaWYgKGVuZCA9PT0gdW5kZWZpbmVkKSBlbmQgPSB0aGlzLmxlbmd0aDtcbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgRXJyb3IoJ29vYicpO1xuICBpZiAoc3RhcnQgPiBlbmQpIHRocm93IG5ldyBFcnJvcignb29iJyk7XG5cbiAgcmV0dXJuIG5ldyBCdWZmZXIodGhpcy5wYXJlbnQsIGVuZCAtIHN0YXJ0LCArc3RhcnQgKyB0aGlzLm9mZnNldCk7XG59O1xuXG5cbi8vIExlZ2FjeSBtZXRob2RzIGZvciBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eS5cblxuQnVmZmVyLnByb3RvdHlwZS51dGY4U2xpY2UgPSBmdW5jdGlvbihzdGFydCwgZW5kKSB7XG4gIHJldHVybiB0aGlzLnRvU3RyaW5nKCd1dGY4Jywgc3RhcnQsIGVuZCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmJpbmFyeVNsaWNlID0gZnVuY3Rpb24oc3RhcnQsIGVuZCkge1xuICByZXR1cm4gdGhpcy50b1N0cmluZygnYmluYXJ5Jywgc3RhcnQsIGVuZCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmFzY2lpU2xpY2UgPSBmdW5jdGlvbihzdGFydCwgZW5kKSB7XG4gIHJldHVybiB0aGlzLnRvU3RyaW5nKCdhc2NpaScsIHN0YXJ0LCBlbmQpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS51dGY4V3JpdGUgPSBmdW5jdGlvbihzdHJpbmcsIG9mZnNldCkge1xuICByZXR1cm4gdGhpcy53cml0ZShzdHJpbmcsIG9mZnNldCwgJ3V0ZjgnKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuYmluYXJ5V3JpdGUgPSBmdW5jdGlvbihzdHJpbmcsIG9mZnNldCkge1xuICByZXR1cm4gdGhpcy53cml0ZShzdHJpbmcsIG9mZnNldCwgJ2JpbmFyeScpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5hc2NpaVdyaXRlID0gZnVuY3Rpb24oc3RyaW5nLCBvZmZzZXQpIHtcbiAgcmV0dXJuIHRoaXMud3JpdGUoc3RyaW5nLCBvZmZzZXQsICdhc2NpaScpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBmdW5jdGlvbihvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhciBidWZmZXIgPSB0aGlzO1xuXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQub2sob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyBvZmZzZXQnKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgPCBidWZmZXIubGVuZ3RoLFxuICAgICAgICAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKTtcbiAgfVxuXG4gIHJldHVybiBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXRdO1xufTtcblxuZnVuY3Rpb24gcmVhZFVJbnQxNihidWZmZXIsIG9mZnNldCwgaXNCaWdFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIHZhciB2YWwgPSAwO1xuXG5cbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydC5vayh0eXBlb2YgKGlzQmlnRW5kaWFuKSA9PT0gJ2Jvb2xlYW4nLFxuICAgICAgICAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCxcbiAgICAgICAgJ21pc3Npbmcgb2Zmc2V0Jyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICsgMSA8IGJ1ZmZlci5sZW5ndGgsXG4gICAgICAgICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpO1xuICB9XG5cbiAgaWYgKGlzQmlnRW5kaWFuKSB7XG4gICAgdmFsID0gYnVmZmVyLnBhcmVudFtidWZmZXIub2Zmc2V0ICsgb2Zmc2V0XSA8PCA4O1xuICAgIHZhbCB8PSBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXQgKyAxXTtcbiAgfSBlbHNlIHtcbiAgICB2YWwgPSBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXRdO1xuICAgIHZhbCB8PSBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXQgKyAxXSA8PCA4O1xuICB9XG5cbiAgcmV0dXJuIHZhbDtcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2TEUgPSBmdW5jdGlvbihvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiByZWFkVUludDE2KHRoaXMsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkJFID0gZnVuY3Rpb24ob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gcmVhZFVJbnQxNih0aGlzLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KTtcbn07XG5cbmZ1bmN0aW9uIHJlYWRVSW50MzIoYnVmZmVyLCBvZmZzZXQsIGlzQmlnRW5kaWFuLCBub0Fzc2VydCkge1xuICB2YXIgdmFsID0gMDtcblxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0Lm9rKHR5cGVvZiAoaXNCaWdFbmRpYW4pID09PSAnYm9vbGVhbicsXG4gICAgICAgICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyBvZmZzZXQnKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgKyAzIDwgYnVmZmVyLmxlbmd0aCxcbiAgICAgICAgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJyk7XG4gIH1cblxuICBpZiAoaXNCaWdFbmRpYW4pIHtcbiAgICB2YWwgPSBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXQgKyAxXSA8PCAxNjtcbiAgICB2YWwgfD0gYnVmZmVyLnBhcmVudFtidWZmZXIub2Zmc2V0ICsgb2Zmc2V0ICsgMl0gPDwgODtcbiAgICB2YWwgfD0gYnVmZmVyLnBhcmVudFtidWZmZXIub2Zmc2V0ICsgb2Zmc2V0ICsgM107XG4gICAgdmFsID0gdmFsICsgKGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldF0gPDwgMjQgPj4+IDApO1xuICB9IGVsc2Uge1xuICAgIHZhbCA9IGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldCArIDJdIDw8IDE2O1xuICAgIHZhbCB8PSBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXQgKyAxXSA8PCA4O1xuICAgIHZhbCB8PSBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXRdO1xuICAgIHZhbCA9IHZhbCArIChidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXQgKyAzXSA8PCAyNCA+Pj4gMCk7XG4gIH1cblxuICByZXR1cm4gdmFsO1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJMRSA9IGZ1bmN0aW9uKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHJlYWRVSW50MzIodGhpcywgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyQkUgPSBmdW5jdGlvbihvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiByZWFkVUludDMyKHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpO1xufTtcblxuXG4vKlxuICogU2lnbmVkIGludGVnZXIgdHlwZXMsIHlheSB0ZWFtISBBIHJlbWluZGVyIG9uIGhvdyB0d28ncyBjb21wbGVtZW50IGFjdHVhbGx5XG4gKiB3b3Jrcy4gVGhlIGZpcnN0IGJpdCBpcyB0aGUgc2lnbmVkIGJpdCwgaS5lLiB0ZWxscyB1cyB3aGV0aGVyIG9yIG5vdCB0aGVcbiAqIG51bWJlciBzaG91bGQgYmUgcG9zaXRpdmUgb3IgbmVnYXRpdmUuIElmIHRoZSB0d28ncyBjb21wbGVtZW50IHZhbHVlIGlzXG4gKiBwb3NpdGl2ZSwgdGhlbiB3ZSdyZSBkb25lLCBhcyBpdCdzIGVxdWl2YWxlbnQgdG8gdGhlIHVuc2lnbmVkIHJlcHJlc2VudGF0aW9uLlxuICpcbiAqIE5vdyBpZiB0aGUgbnVtYmVyIGlzIHBvc2l0aXZlLCB5b3UncmUgcHJldHR5IG11Y2ggZG9uZSwgeW91IGNhbiBqdXN0IGxldmVyYWdlXG4gKiB0aGUgdW5zaWduZWQgdHJhbnNsYXRpb25zIGFuZCByZXR1cm4gdGhvc2UuIFVuZm9ydHVuYXRlbHksIG5lZ2F0aXZlIG51bWJlcnNcbiAqIGFyZW4ndCBxdWl0ZSB0aGF0IHN0cmFpZ2h0Zm9yd2FyZC5cbiAqXG4gKiBBdCBmaXJzdCBnbGFuY2UsIG9uZSBtaWdodCBiZSBpbmNsaW5lZCB0byB1c2UgdGhlIHRyYWRpdGlvbmFsIGZvcm11bGEgdG9cbiAqIHRyYW5zbGF0ZSBiaW5hcnkgbnVtYmVycyBiZXR3ZWVuIHRoZSBwb3NpdGl2ZSBhbmQgbmVnYXRpdmUgdmFsdWVzIGluIHR3bydzXG4gKiBjb21wbGVtZW50LiAoVGhvdWdoIGl0IGRvZXNuJ3QgcXVpdGUgd29yayBmb3IgdGhlIG1vc3QgbmVnYXRpdmUgdmFsdWUpXG4gKiBNYWlubHk6XG4gKiAgLSBpbnZlcnQgYWxsIHRoZSBiaXRzXG4gKiAgLSBhZGQgb25lIHRvIHRoZSByZXN1bHRcbiAqXG4gKiBPZiBjb3Vyc2UsIHRoaXMgZG9lc24ndCBxdWl0ZSB3b3JrIGluIEphdmFzY3JpcHQuIFRha2UgZm9yIGV4YW1wbGUgdGhlIHZhbHVlXG4gKiBvZiAtMTI4LiBUaGlzIGNvdWxkIGJlIHJlcHJlc2VudGVkIGluIDE2IGJpdHMgKGJpZy1lbmRpYW4pIGFzIDB4ZmY4MC4gQnV0IG9mXG4gKiBjb3Vyc2UsIEphdmFzY3JpcHQgd2lsbCBkbyB0aGUgZm9sbG93aW5nOlxuICpcbiAqID4gfjB4ZmY4MFxuICogLTY1NDA5XG4gKlxuICogV2hvaCB0aGVyZSwgSmF2YXNjcmlwdCwgdGhhdCdzIG5vdCBxdWl0ZSByaWdodC4gQnV0IHdhaXQsIGFjY29yZGluZyB0b1xuICogSmF2YXNjcmlwdCB0aGF0J3MgcGVyZmVjdGx5IGNvcnJlY3QuIFdoZW4gSmF2YXNjcmlwdCBlbmRzIHVwIHNlZWluZyB0aGVcbiAqIGNvbnN0YW50IDB4ZmY4MCwgaXQgaGFzIG5vIG5vdGlvbiB0aGF0IGl0IGlzIGFjdHVhbGx5IGEgc2lnbmVkIG51bWJlci4gSXRcbiAqIGFzc3VtZXMgdGhhdCB3ZSd2ZSBpbnB1dCB0aGUgdW5zaWduZWQgdmFsdWUgMHhmZjgwLiBUaHVzLCB3aGVuIGl0IGRvZXMgdGhlXG4gKiBiaW5hcnkgbmVnYXRpb24sIGl0IGNhc3RzIGl0IGludG8gYSBzaWduZWQgdmFsdWUsIChwb3NpdGl2ZSAweGZmODApLiBUaGVuXG4gKiB3aGVuIHlvdSBwZXJmb3JtIGJpbmFyeSBuZWdhdGlvbiBvbiB0aGF0LCBpdCB0dXJucyBpdCBpbnRvIGEgbmVnYXRpdmUgbnVtYmVyLlxuICpcbiAqIEluc3RlYWQsIHdlJ3JlIGdvaW5nIHRvIGhhdmUgdG8gdXNlIHRoZSBmb2xsb3dpbmcgZ2VuZXJhbCBmb3JtdWxhLCB0aGF0IHdvcmtzXG4gKiBpbiBhIHJhdGhlciBKYXZhc2NyaXB0IGZyaWVuZGx5IHdheS4gSSdtIGdsYWQgd2UgZG9uJ3Qgc3VwcG9ydCB0aGlzIGtpbmQgb2ZcbiAqIHdlaXJkIG51bWJlcmluZyBzY2hlbWUgaW4gdGhlIGtlcm5lbC5cbiAqXG4gKiAoQklULU1BWCAtICh1bnNpZ25lZCl2YWwgKyAxKSAqIC0xXG4gKlxuICogVGhlIGFzdHV0ZSBvYnNlcnZlciwgbWF5IHRoaW5rIHRoYXQgdGhpcyBkb2Vzbid0IG1ha2Ugc2Vuc2UgZm9yIDgtYml0IG51bWJlcnNcbiAqIChyZWFsbHkgaXQgaXNuJ3QgbmVjZXNzYXJ5IGZvciB0aGVtKS4gSG93ZXZlciwgd2hlbiB5b3UgZ2V0IDE2LWJpdCBudW1iZXJzLFxuICogeW91IGRvLiBMZXQncyBnbyBiYWNrIHRvIG91ciBwcmlvciBleGFtcGxlIGFuZCBzZWUgaG93IHRoaXMgd2lsbCBsb29rOlxuICpcbiAqICgweGZmZmYgLSAweGZmODAgKyAxKSAqIC0xXG4gKiAoMHgwMDdmICsgMSkgKiAtMVxuICogKDB4MDA4MCkgKiAtMVxuICovXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQ4ID0gZnVuY3Rpb24ob2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YXIgYnVmZmVyID0gdGhpcztcbiAgdmFyIG5lZztcblxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0Lm9rKG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCxcbiAgICAgICAgJ21pc3Npbmcgb2Zmc2V0Jyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0IDwgYnVmZmVyLmxlbmd0aCxcbiAgICAgICAgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJyk7XG4gIH1cblxuICBuZWcgPSBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXRdICYgMHg4MDtcbiAgaWYgKCFuZWcpIHtcbiAgICByZXR1cm4gKGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldF0pO1xuICB9XG5cbiAgcmV0dXJuICgoMHhmZiAtIGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldF0gKyAxKSAqIC0xKTtcbn07XG5cbmZ1bmN0aW9uIHJlYWRJbnQxNihidWZmZXIsIG9mZnNldCwgaXNCaWdFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIHZhciBuZWcsIHZhbDtcblxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0Lm9rKHR5cGVvZiAoaXNCaWdFbmRpYW4pID09PSAnYm9vbGVhbicsXG4gICAgICAgICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyBvZmZzZXQnKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgKyAxIDwgYnVmZmVyLmxlbmd0aCxcbiAgICAgICAgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJyk7XG4gIH1cblxuICB2YWwgPSByZWFkVUludDE2KGJ1ZmZlciwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpO1xuICBuZWcgPSB2YWwgJiAweDgwMDA7XG4gIGlmICghbmVnKSB7XG4gICAgcmV0dXJuIHZhbDtcbiAgfVxuXG4gIHJldHVybiAoMHhmZmZmIC0gdmFsICsgMSkgKiAtMTtcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZMRSA9IGZ1bmN0aW9uKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHJlYWRJbnQxNih0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkJFID0gZnVuY3Rpb24ob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gcmVhZEludDE2KHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpO1xufTtcblxuZnVuY3Rpb24gcmVhZEludDMyKGJ1ZmZlciwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgdmFyIG5lZywgdmFsO1xuXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQub2sodHlwZW9mIChpc0JpZ0VuZGlhbikgPT09ICdib29sZWFuJyxcbiAgICAgICAgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsXG4gICAgICAgICdtaXNzaW5nIG9mZnNldCcpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCArIDMgPCBidWZmZXIubGVuZ3RoLFxuICAgICAgICAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKTtcbiAgfVxuXG4gIHZhbCA9IHJlYWRVSW50MzIoYnVmZmVyLCBvZmZzZXQsIGlzQmlnRW5kaWFuLCBub0Fzc2VydCk7XG4gIG5lZyA9IHZhbCAmIDB4ODAwMDAwMDA7XG4gIGlmICghbmVnKSB7XG4gICAgcmV0dXJuICh2YWwpO1xuICB9XG5cbiAgcmV0dXJuICgweGZmZmZmZmZmIC0gdmFsICsgMSkgKiAtMTtcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJMRSA9IGZ1bmN0aW9uKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHJlYWRJbnQzMih0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkJFID0gZnVuY3Rpb24ob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gcmVhZEludDMyKHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpO1xufTtcblxuZnVuY3Rpb24gcmVhZEZsb2F0KGJ1ZmZlciwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydC5vayh0eXBlb2YgKGlzQmlnRW5kaWFuKSA9PT0gJ2Jvb2xlYW4nLFxuICAgICAgICAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCArIDMgPCBidWZmZXIubGVuZ3RoLFxuICAgICAgICAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKTtcbiAgfVxuXG4gIHJldHVybiByZXF1aXJlKCcuL2J1ZmZlcl9pZWVlNzU0JykucmVhZElFRUU3NTQoYnVmZmVyLCBvZmZzZXQsIGlzQmlnRW5kaWFuLFxuICAgICAgMjMsIDQpO1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdExFID0gZnVuY3Rpb24ob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gcmVhZEZsb2F0KHRoaXMsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBmdW5jdGlvbihvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiByZWFkRmxvYXQodGhpcywgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydCk7XG59O1xuXG5mdW5jdGlvbiByZWFkRG91YmxlKGJ1ZmZlciwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydC5vayh0eXBlb2YgKGlzQmlnRW5kaWFuKSA9PT0gJ2Jvb2xlYW4nLFxuICAgICAgICAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCArIDcgPCBidWZmZXIubGVuZ3RoLFxuICAgICAgICAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKTtcbiAgfVxuXG4gIHJldHVybiByZXF1aXJlKCcuL2J1ZmZlcl9pZWVlNzU0JykucmVhZElFRUU3NTQoYnVmZmVyLCBvZmZzZXQsIGlzQmlnRW5kaWFuLFxuICAgICAgNTIsIDgpO1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRSA9IGZ1bmN0aW9uKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHJlYWREb3VibGUodGhpcywgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlQkUgPSBmdW5jdGlvbihvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiByZWFkRG91YmxlKHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpO1xufTtcblxuXG4vKlxuICogV2UgaGF2ZSB0byBtYWtlIHN1cmUgdGhhdCB0aGUgdmFsdWUgaXMgYSB2YWxpZCBpbnRlZ2VyLiBUaGlzIG1lYW5zIHRoYXQgaXQgaXNcbiAqIG5vbi1uZWdhdGl2ZS4gSXQgaGFzIG5vIGZyYWN0aW9uYWwgY29tcG9uZW50IGFuZCB0aGF0IGl0IGRvZXMgbm90IGV4Y2VlZCB0aGVcbiAqIG1heGltdW0gYWxsb3dlZCB2YWx1ZS5cbiAqXG4gKiAgICAgIHZhbHVlICAgICAgICAgICBUaGUgbnVtYmVyIHRvIGNoZWNrIGZvciB2YWxpZGl0eVxuICpcbiAqICAgICAgbWF4ICAgICAgICAgICAgIFRoZSBtYXhpbXVtIHZhbHVlXG4gKi9cbmZ1bmN0aW9uIHZlcmlmdWludCh2YWx1ZSwgbWF4KSB7XG4gIGFzc2VydC5vayh0eXBlb2YgKHZhbHVlKSA9PSAnbnVtYmVyJyxcbiAgICAgICdjYW5ub3Qgd3JpdGUgYSBub24tbnVtYmVyIGFzIGEgbnVtYmVyJyk7XG5cbiAgYXNzZXJ0Lm9rKHZhbHVlID49IDAsXG4gICAgICAnc3BlY2lmaWVkIGEgbmVnYXRpdmUgdmFsdWUgZm9yIHdyaXRpbmcgYW4gdW5zaWduZWQgdmFsdWUnKTtcblxuICBhc3NlcnQub2sodmFsdWUgPD0gbWF4LCAndmFsdWUgaXMgbGFyZ2VyIHRoYW4gbWF4aW11bSB2YWx1ZSBmb3IgdHlwZScpO1xuXG4gIGFzc2VydC5vayhNYXRoLmZsb29yKHZhbHVlKSA9PT0gdmFsdWUsICd2YWx1ZSBoYXMgYSBmcmFjdGlvbmFsIGNvbXBvbmVudCcpO1xufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDggPSBmdW5jdGlvbih2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YXIgYnVmZmVyID0gdGhpcztcblxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0Lm9rKHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsXG4gICAgICAgICdtaXNzaW5nIHZhbHVlJyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyBvZmZzZXQnKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgPCBidWZmZXIubGVuZ3RoLFxuICAgICAgICAndHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJyk7XG5cbiAgICB2ZXJpZnVpbnQodmFsdWUsIDB4ZmYpO1xuICB9XG5cbiAgYnVmZmVyLnBhcmVudFtidWZmZXIub2Zmc2V0ICsgb2Zmc2V0XSA9IHZhbHVlO1xufTtcblxuZnVuY3Rpb24gd3JpdGVVSW50MTYoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydC5vayh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyB2YWx1ZScpO1xuXG4gICAgYXNzZXJ0Lm9rKHR5cGVvZiAoaXNCaWdFbmRpYW4pID09PSAnYm9vbGVhbicsXG4gICAgICAgICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyBvZmZzZXQnKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgKyAxIDwgYnVmZmVyLmxlbmd0aCxcbiAgICAgICAgJ3RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpO1xuXG4gICAgdmVyaWZ1aW50KHZhbHVlLCAweGZmZmYpO1xuICB9XG5cbiAgaWYgKGlzQmlnRW5kaWFuKSB7XG4gICAgYnVmZmVyLnBhcmVudFtidWZmZXIub2Zmc2V0ICsgb2Zmc2V0XSA9ICh2YWx1ZSAmIDB4ZmYwMCkgPj4+IDg7XG4gICAgYnVmZmVyLnBhcmVudFtidWZmZXIub2Zmc2V0ICsgb2Zmc2V0ICsgMV0gPSB2YWx1ZSAmIDB4MDBmZjtcbiAgfSBlbHNlIHtcbiAgICBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXQgKyAxXSA9ICh2YWx1ZSAmIDB4ZmYwMCkgPj4+IDg7XG4gICAgYnVmZmVyLnBhcmVudFtidWZmZXIub2Zmc2V0ICsgb2Zmc2V0XSA9IHZhbHVlICYgMHgwMGZmO1xuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZMRSA9IGZ1bmN0aW9uKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2QkUgPSBmdW5jdGlvbih2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB3cml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydCk7XG59O1xuXG5mdW5jdGlvbiB3cml0ZVVJbnQzMihidWZmZXIsIHZhbHVlLCBvZmZzZXQsIGlzQmlnRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0Lm9rKHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsXG4gICAgICAgICdtaXNzaW5nIHZhbHVlJyk7XG5cbiAgICBhc3NlcnQub2sodHlwZW9mIChpc0JpZ0VuZGlhbikgPT09ICdib29sZWFuJyxcbiAgICAgICAgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsXG4gICAgICAgICdtaXNzaW5nIG9mZnNldCcpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCArIDMgPCBidWZmZXIubGVuZ3RoLFxuICAgICAgICAndHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJyk7XG5cbiAgICB2ZXJpZnVpbnQodmFsdWUsIDB4ZmZmZmZmZmYpO1xuICB9XG5cbiAgaWYgKGlzQmlnRW5kaWFuKSB7XG4gICAgYnVmZmVyLnBhcmVudFtidWZmZXIub2Zmc2V0ICsgb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gMjQpICYgMHhmZjtcbiAgICBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpICYgMHhmZjtcbiAgICBidWZmZXIucGFyZW50W2J1ZmZlci5vZmZzZXQgKyBvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOCkgJiAweGZmO1xuICAgIGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldCArIDNdID0gdmFsdWUgJiAweGZmO1xuICB9IGVsc2Uge1xuICAgIGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNCkgJiAweGZmO1xuICAgIGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNikgJiAweGZmO1xuICAgIGJ1ZmZlci5wYXJlbnRbYnVmZmVyLm9mZnNldCArIG9mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KSAmIDB4ZmY7XG4gICAgYnVmZmVyLnBhcmVudFtidWZmZXIub2Zmc2V0ICsgb2Zmc2V0XSA9IHZhbHVlICYgMHhmZjtcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyTEUgPSBmdW5jdGlvbih2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB3cml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFID0gZnVuY3Rpb24odmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgd3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpO1xufTtcblxuXG4vKlxuICogV2Ugbm93IG1vdmUgb250byBvdXIgZnJpZW5kcyBpbiB0aGUgc2lnbmVkIG51bWJlciBjYXRlZ29yeS4gVW5saWtlIHVuc2lnbmVkXG4gKiBudW1iZXJzLCB3ZSdyZSBnb2luZyB0byBoYXZlIHRvIHdvcnJ5IGEgYml0IG1vcmUgYWJvdXQgaG93IHdlIHB1dCB2YWx1ZXMgaW50b1xuICogYXJyYXlzLiBTaW5jZSB3ZSBhcmUgb25seSB3b3JyeWluZyBhYm91dCBzaWduZWQgMzItYml0IHZhbHVlcywgd2UncmUgaW5cbiAqIHNsaWdodGx5IGJldHRlciBzaGFwZS4gVW5mb3J0dW5hdGVseSwgd2UgcmVhbGx5IGNhbid0IGRvIG91ciBmYXZvcml0ZSBiaW5hcnlcbiAqICYgaW4gdGhpcyBzeXN0ZW0uIEl0IHJlYWxseSBzZWVtcyB0byBkbyB0aGUgd3JvbmcgdGhpbmcuIEZvciBleGFtcGxlOlxuICpcbiAqID4gLTMyICYgMHhmZlxuICogMjI0XG4gKlxuICogV2hhdCdzIGhhcHBlbmluZyBhYm92ZSBpcyByZWFsbHk6IDB4ZTAgJiAweGZmID0gMHhlMC4gSG93ZXZlciwgdGhlIHJlc3VsdHMgb2ZcbiAqIHRoaXMgYXJlbid0IHRyZWF0ZWQgYXMgYSBzaWduZWQgbnVtYmVyLiBVbHRpbWF0ZWx5IGEgYmFkIHRoaW5nLlxuICpcbiAqIFdoYXQgd2UncmUgZ29pbmcgdG8gd2FudCB0byBkbyBpcyBiYXNpY2FsbHkgY3JlYXRlIHRoZSB1bnNpZ25lZCBlcXVpdmFsZW50IG9mXG4gKiBvdXIgcmVwcmVzZW50YXRpb24gYW5kIHBhc3MgdGhhdCBvZmYgdG8gdGhlIHd1aW50KiBmdW5jdGlvbnMuIFRvIGRvIHRoYXRcbiAqIHdlJ3JlIGdvaW5nIHRvIGRvIHRoZSBmb2xsb3dpbmc6XG4gKlxuICogIC0gaWYgdGhlIHZhbHVlIGlzIHBvc2l0aXZlXG4gKiAgICAgIHdlIGNhbiBwYXNzIGl0IGRpcmVjdGx5IG9mZiB0byB0aGUgZXF1aXZhbGVudCB3dWludFxuICogIC0gaWYgdGhlIHZhbHVlIGlzIG5lZ2F0aXZlXG4gKiAgICAgIHdlIGRvIHRoZSBmb2xsb3dpbmcgY29tcHV0YXRpb246XG4gKiAgICAgICAgIG1iICsgdmFsICsgMSwgd2hlcmVcbiAqICAgICAgICAgbWIgICBpcyB0aGUgbWF4aW11bSB1bnNpZ25lZCB2YWx1ZSBpbiB0aGF0IGJ5dGUgc2l6ZVxuICogICAgICAgICB2YWwgIGlzIHRoZSBKYXZhc2NyaXB0IG5lZ2F0aXZlIGludGVnZXJcbiAqXG4gKlxuICogQXMgYSBjb25jcmV0ZSB2YWx1ZSwgdGFrZSAtMTI4LiBJbiBzaWduZWQgMTYgYml0cyB0aGlzIHdvdWxkIGJlIDB4ZmY4MC4gSWZcbiAqIHlvdSBkbyBvdXQgdGhlIGNvbXB1dGF0aW9uczpcbiAqXG4gKiAweGZmZmYgLSAxMjggKyAxXG4gKiAweGZmZmYgLSAxMjdcbiAqIDB4ZmY4MFxuICpcbiAqIFlvdSBjYW4gdGhlbiBlbmNvZGUgdGhpcyB2YWx1ZSBhcyB0aGUgc2lnbmVkIHZlcnNpb24uIFRoaXMgaXMgcmVhbGx5IHJhdGhlclxuICogaGFja3ksIGJ1dCBpdCBzaG91bGQgd29yayBhbmQgZ2V0IHRoZSBqb2IgZG9uZSB3aGljaCBpcyBvdXIgZ29hbCBoZXJlLlxuICovXG5cbi8qXG4gKiBBIHNlcmllcyBvZiBjaGVja3MgdG8gbWFrZSBzdXJlIHdlIGFjdHVhbGx5IGhhdmUgYSBzaWduZWQgMzItYml0IG51bWJlclxuICovXG5mdW5jdGlvbiB2ZXJpZnNpbnQodmFsdWUsIG1heCwgbWluKSB7XG4gIGFzc2VydC5vayh0eXBlb2YgKHZhbHVlKSA9PSAnbnVtYmVyJyxcbiAgICAgICdjYW5ub3Qgd3JpdGUgYSBub24tbnVtYmVyIGFzIGEgbnVtYmVyJyk7XG5cbiAgYXNzZXJ0Lm9rKHZhbHVlIDw9IG1heCwgJ3ZhbHVlIGxhcmdlciB0aGFuIG1heGltdW0gYWxsb3dlZCB2YWx1ZScpO1xuXG4gIGFzc2VydC5vayh2YWx1ZSA+PSBtaW4sICd2YWx1ZSBzbWFsbGVyIHRoYW4gbWluaW11bSBhbGxvd2VkIHZhbHVlJyk7XG5cbiAgYXNzZXJ0Lm9rKE1hdGguZmxvb3IodmFsdWUpID09PSB2YWx1ZSwgJ3ZhbHVlIGhhcyBhIGZyYWN0aW9uYWwgY29tcG9uZW50Jyk7XG59XG5cbmZ1bmN0aW9uIHZlcmlmSUVFRTc1NCh2YWx1ZSwgbWF4LCBtaW4pIHtcbiAgYXNzZXJ0Lm9rKHR5cGVvZiAodmFsdWUpID09ICdudW1iZXInLFxuICAgICAgJ2Nhbm5vdCB3cml0ZSBhIG5vbi1udW1iZXIgYXMgYSBudW1iZXInKTtcblxuICBhc3NlcnQub2sodmFsdWUgPD0gbWF4LCAndmFsdWUgbGFyZ2VyIHRoYW4gbWF4aW11bSBhbGxvd2VkIHZhbHVlJyk7XG5cbiAgYXNzZXJ0Lm9rKHZhbHVlID49IG1pbiwgJ3ZhbHVlIHNtYWxsZXIgdGhhbiBtaW5pbXVtIGFsbG93ZWQgdmFsdWUnKTtcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDggPSBmdW5jdGlvbih2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YXIgYnVmZmVyID0gdGhpcztcblxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0Lm9rKHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsXG4gICAgICAgICdtaXNzaW5nIHZhbHVlJyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyBvZmZzZXQnKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgPCBidWZmZXIubGVuZ3RoLFxuICAgICAgICAnVHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJyk7XG5cbiAgICB2ZXJpZnNpbnQodmFsdWUsIDB4N2YsIC0weDgwKTtcbiAgfVxuXG4gIGlmICh2YWx1ZSA+PSAwKSB7XG4gICAgYnVmZmVyLndyaXRlVUludDgodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpO1xuICB9IGVsc2Uge1xuICAgIGJ1ZmZlci53cml0ZVVJbnQ4KDB4ZmYgKyB2YWx1ZSArIDEsIG9mZnNldCwgbm9Bc3NlcnQpO1xuICB9XG59O1xuXG5mdW5jdGlvbiB3cml0ZUludDE2KGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNCaWdFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQub2sodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCxcbiAgICAgICAgJ21pc3NpbmcgdmFsdWUnKTtcblxuICAgIGFzc2VydC5vayh0eXBlb2YgKGlzQmlnRW5kaWFuKSA9PT0gJ2Jvb2xlYW4nLFxuICAgICAgICAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCxcbiAgICAgICAgJ21pc3Npbmcgb2Zmc2V0Jyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICsgMSA8IGJ1ZmZlci5sZW5ndGgsXG4gICAgICAgICdUcnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKTtcblxuICAgIHZlcmlmc2ludCh2YWx1ZSwgMHg3ZmZmLCAtMHg4MDAwKTtcbiAgfVxuXG4gIGlmICh2YWx1ZSA+PSAwKSB7XG4gICAgd3JpdGVVSW50MTYoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpO1xuICB9IGVsc2Uge1xuICAgIHdyaXRlVUludDE2KGJ1ZmZlciwgMHhmZmZmICsgdmFsdWUgKyAxLCBvZmZzZXQsIGlzQmlnRW5kaWFuLCBub0Fzc2VydCk7XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbih2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB3cml0ZUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHdyaXRlSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpO1xufTtcblxuZnVuY3Rpb24gd3JpdGVJbnQzMihidWZmZXIsIHZhbHVlLCBvZmZzZXQsIGlzQmlnRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0Lm9rKHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsXG4gICAgICAgICdtaXNzaW5nIHZhbHVlJyk7XG5cbiAgICBhc3NlcnQub2sodHlwZW9mIChpc0JpZ0VuZGlhbikgPT09ICdib29sZWFuJyxcbiAgICAgICAgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsXG4gICAgICAgICdtaXNzaW5nIG9mZnNldCcpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCArIDMgPCBidWZmZXIubGVuZ3RoLFxuICAgICAgICAnVHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJyk7XG5cbiAgICB2ZXJpZnNpbnQodmFsdWUsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKTtcbiAgfVxuXG4gIGlmICh2YWx1ZSA+PSAwKSB7XG4gICAgd3JpdGVVSW50MzIoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpO1xuICB9IGVsc2Uge1xuICAgIHdyaXRlVUludDMyKGJ1ZmZlciwgMHhmZmZmZmZmZiArIHZhbHVlICsgMSwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpO1xuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkxFID0gZnVuY3Rpb24odmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgd3JpdGVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbih2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB3cml0ZUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KTtcbn07XG5cbmZ1bmN0aW9uIHdyaXRlRmxvYXQoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0JpZ0VuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydC5vayh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyB2YWx1ZScpO1xuXG4gICAgYXNzZXJ0Lm9rKHR5cGVvZiAoaXNCaWdFbmRpYW4pID09PSAnYm9vbGVhbicsXG4gICAgICAgICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyBvZmZzZXQnKTtcblxuICAgIGFzc2VydC5vayhvZmZzZXQgKyAzIDwgYnVmZmVyLmxlbmd0aCxcbiAgICAgICAgJ1RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpO1xuXG4gICAgdmVyaWZJRUVFNzU0KHZhbHVlLCAzLjQwMjgyMzQ2NjM4NTI4ODZlKzM4LCAtMy40MDI4MjM0NjYzODUyODg2ZSszOCk7XG4gIH1cblxuICByZXF1aXJlKCcuL2J1ZmZlcl9pZWVlNzU0Jykud3JpdGVJRUVFNzU0KGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNCaWdFbmRpYW4sXG4gICAgICAyMywgNCk7XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdExFID0gZnVuY3Rpb24odmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0QkUgPSBmdW5jdGlvbih2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KTtcbn07XG5cbmZ1bmN0aW9uIHdyaXRlRG91YmxlKGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNCaWdFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQub2sodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCxcbiAgICAgICAgJ21pc3NpbmcgdmFsdWUnKTtcblxuICAgIGFzc2VydC5vayh0eXBlb2YgKGlzQmlnRW5kaWFuKSA9PT0gJ2Jvb2xlYW4nLFxuICAgICAgICAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpO1xuXG4gICAgYXNzZXJ0Lm9rKG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCxcbiAgICAgICAgJ21pc3Npbmcgb2Zmc2V0Jyk7XG5cbiAgICBhc3NlcnQub2sob2Zmc2V0ICsgNyA8IGJ1ZmZlci5sZW5ndGgsXG4gICAgICAgICdUcnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKTtcblxuICAgIHZlcmlmSUVFRTc1NCh2YWx1ZSwgMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgsIC0xLjc5NzY5MzEzNDg2MjMxNTdFKzMwOCk7XG4gIH1cblxuICByZXF1aXJlKCcuL2J1ZmZlcl9pZWVlNzU0Jykud3JpdGVJRUVFNzU0KGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNCaWdFbmRpYW4sXG4gICAgICA1MiwgOCk7XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVMRSA9IGZ1bmN0aW9uKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlQkUgPSBmdW5jdGlvbih2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydCk7XG59O1xuXG5TbG93QnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBCdWZmZXIucHJvdG90eXBlLnJlYWRVSW50ODtcblNsb3dCdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IEJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkxFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkJFID0gQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyTEUgPSBCdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJMRTtcblNsb3dCdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IEJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkJFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBCdWZmZXIucHJvdG90eXBlLnJlYWRJbnQ4O1xuU2xvd0J1ZmZlci5wcm90b3R5cGUucmVhZEludDE2TEUgPSBCdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkxFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUucmVhZEludDE2QkUgPSBCdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkJFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUucmVhZEludDMyTEUgPSBCdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkxFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUucmVhZEludDMyQkUgPSBCdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkJFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEUgPSBCdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdExFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBCdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdEJFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUxFID0gQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlTEU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlQkUgPSBCdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVCRTtcblNsb3dCdWZmZXIucHJvdG90eXBlLndyaXRlVUludDggPSBCdWZmZXIucHJvdG90eXBlLndyaXRlVUludDg7XG5TbG93QnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFID0gQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZCRSA9IEJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZCRTtcblNsb3dCdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyTEUgPSBCdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyTEU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFID0gQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQ4ID0gQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDg7XG5TbG93QnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBCdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZMRTtcblNsb3dCdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IEJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkJFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkxFID0gQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyTEU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBCdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJCRTtcblNsb3dCdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRMRSA9IEJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdExFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdEJFID0gQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0QkU7XG5TbG93QnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUxFID0gQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUxFO1xuU2xvd0J1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVCRSA9IEJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVCRTtcblxufSkoKVxufSx7XCJhc3NlcnRcIjoyLFwiLi9idWZmZXJfaWVlZTc1NFwiOjcsXCJiYXNlNjQtanNcIjo5fV0sOTpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cyl7XG4oZnVuY3Rpb24gKGV4cG9ydHMpIHtcblx0J3VzZSBzdHJpY3QnO1xuXG5cdHZhciBsb29rdXAgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyc7XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkoYjY0KSB7XG5cdFx0dmFyIGksIGosIGwsIHRtcCwgcGxhY2VIb2xkZXJzLCBhcnI7XG5cdFxuXHRcdGlmIChiNjQubGVuZ3RoICUgNCA+IDApIHtcblx0XHRcdHRocm93ICdJbnZhbGlkIHN0cmluZy4gTGVuZ3RoIG11c3QgYmUgYSBtdWx0aXBsZSBvZiA0Jztcblx0XHR9XG5cblx0XHQvLyB0aGUgbnVtYmVyIG9mIGVxdWFsIHNpZ25zIChwbGFjZSBob2xkZXJzKVxuXHRcdC8vIGlmIHRoZXJlIGFyZSB0d28gcGxhY2Vob2xkZXJzLCB0aGFuIHRoZSB0d28gY2hhcmFjdGVycyBiZWZvcmUgaXRcblx0XHQvLyByZXByZXNlbnQgb25lIGJ5dGVcblx0XHQvLyBpZiB0aGVyZSBpcyBvbmx5IG9uZSwgdGhlbiB0aGUgdGhyZWUgY2hhcmFjdGVycyBiZWZvcmUgaXQgcmVwcmVzZW50IDIgYnl0ZXNcblx0XHQvLyB0aGlzIGlzIGp1c3QgYSBjaGVhcCBoYWNrIHRvIG5vdCBkbyBpbmRleE9mIHR3aWNlXG5cdFx0cGxhY2VIb2xkZXJzID0gYjY0LmluZGV4T2YoJz0nKTtcblx0XHRwbGFjZUhvbGRlcnMgPSBwbGFjZUhvbGRlcnMgPiAwID8gYjY0Lmxlbmd0aCAtIHBsYWNlSG9sZGVycyA6IDA7XG5cblx0XHQvLyBiYXNlNjQgaXMgNC8zICsgdXAgdG8gdHdvIGNoYXJhY3RlcnMgb2YgdGhlIG9yaWdpbmFsIGRhdGFcblx0XHRhcnIgPSBbXTsvL25ldyBVaW50OEFycmF5KGI2NC5sZW5ndGggKiAzIC8gNCAtIHBsYWNlSG9sZGVycyk7XG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGg7XG5cblx0XHRmb3IgKGkgPSAwLCBqID0gMDsgaSA8IGw7IGkgKz0gNCwgaiArPSAzKSB7XG5cdFx0XHR0bXAgPSAobG9va3VwLmluZGV4T2YoYjY0W2ldKSA8PCAxOCkgfCAobG9va3VwLmluZGV4T2YoYjY0W2kgKyAxXSkgPDwgMTIpIHwgKGxvb2t1cC5pbmRleE9mKGI2NFtpICsgMl0pIDw8IDYpIHwgbG9va3VwLmluZGV4T2YoYjY0W2kgKyAzXSk7XG5cdFx0XHRhcnIucHVzaCgodG1wICYgMHhGRjAwMDApID4+IDE2KTtcblx0XHRcdGFyci5wdXNoKCh0bXAgJiAweEZGMDApID4+IDgpO1xuXHRcdFx0YXJyLnB1c2godG1wICYgMHhGRik7XG5cdFx0fVxuXG5cdFx0aWYgKHBsYWNlSG9sZGVycyA9PT0gMikge1xuXHRcdFx0dG1wID0gKGxvb2t1cC5pbmRleE9mKGI2NFtpXSkgPDwgMikgfCAobG9va3VwLmluZGV4T2YoYjY0W2kgKyAxXSkgPj4gNCk7XG5cdFx0XHRhcnIucHVzaCh0bXAgJiAweEZGKTtcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGxvb2t1cC5pbmRleE9mKGI2NFtpXSkgPDwgMTApIHwgKGxvb2t1cC5pbmRleE9mKGI2NFtpICsgMV0pIDw8IDQpIHwgKGxvb2t1cC5pbmRleE9mKGI2NFtpICsgMl0pID4+IDIpO1xuXHRcdFx0YXJyLnB1c2goKHRtcCA+PiA4KSAmIDB4RkYpO1xuXHRcdFx0YXJyLnB1c2godG1wICYgMHhGRik7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIGFycjtcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQodWludDgpIHtcblx0XHR2YXIgaSxcblx0XHRcdGV4dHJhQnl0ZXMgPSB1aW50OC5sZW5ndGggJSAzLCAvLyBpZiB3ZSBoYXZlIDEgYnl0ZSBsZWZ0LCBwYWQgMiBieXRlc1xuXHRcdFx0b3V0cHV0ID0gXCJcIixcblx0XHRcdHRlbXAsIGxlbmd0aDtcblxuXHRcdGZ1bmN0aW9uIHRyaXBsZXRUb0Jhc2U2NCAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwW251bSA+PiAxOCAmIDB4M0ZdICsgbG9va3VwW251bSA+PiAxMiAmIDB4M0ZdICsgbG9va3VwW251bSA+PiA2ICYgMHgzRl0gKyBsb29rdXBbbnVtICYgMHgzRl07XG5cdFx0fTtcblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pO1xuXHRcdFx0b3V0cHV0ICs9IHRyaXBsZXRUb0Jhc2U2NCh0ZW1wKTtcblx0XHR9XG5cblx0XHQvLyBwYWQgdGhlIGVuZCB3aXRoIHplcm9zLCBidXQgbWFrZSBzdXJlIHRvIG5vdCBmb3JnZXQgdGhlIGV4dHJhIGJ5dGVzXG5cdFx0c3dpdGNoIChleHRyYUJ5dGVzKSB7XG5cdFx0XHRjYXNlIDE6XG5cdFx0XHRcdHRlbXAgPSB1aW50OFt1aW50OC5sZW5ndGggLSAxXTtcblx0XHRcdFx0b3V0cHV0ICs9IGxvb2t1cFt0ZW1wID4+IDJdO1xuXHRcdFx0XHRvdXRwdXQgKz0gbG9va3VwWyh0ZW1wIDw8IDQpICYgMHgzRl07XG5cdFx0XHRcdG91dHB1dCArPSAnPT0nO1xuXHRcdFx0XHRicmVhaztcblx0XHRcdGNhc2UgMjpcblx0XHRcdFx0dGVtcCA9ICh1aW50OFt1aW50OC5sZW5ndGggLSAyXSA8PCA4KSArICh1aW50OFt1aW50OC5sZW5ndGggLSAxXSk7XG5cdFx0XHRcdG91dHB1dCArPSBsb29rdXBbdGVtcCA+PiAxMF07XG5cdFx0XHRcdG91dHB1dCArPSBsb29rdXBbKHRlbXAgPj4gNCkgJiAweDNGXTtcblx0XHRcdFx0b3V0cHV0ICs9IGxvb2t1cFsodGVtcCA8PCAyKSAmIDB4M0ZdO1xuXHRcdFx0XHRvdXRwdXQgKz0gJz0nO1xuXHRcdFx0XHRicmVhaztcblx0XHR9XG5cblx0XHRyZXR1cm4gb3V0cHV0O1xuXHR9XG5cblx0bW9kdWxlLmV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheTtcblx0bW9kdWxlLmV4cG9ydHMuZnJvbUJ5dGVBcnJheSA9IHVpbnQ4VG9CYXNlNjQ7XG59KCkpO1xuXG59LHt9XX0se30sW10pXG47O21vZHVsZS5leHBvcnRzPXJlcXVpcmUoXCJidWZmZXItYnJvd3NlcmlmeVwiKVxuIiwiKGZ1bmN0aW9uKEJ1ZmZlcil7dmFyIGVuY29kZSA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKHhzKSB7XG4gICAgZnVuY3Rpb24gYnl0ZXMgKHMpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBzID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgcmV0dXJuIHMuc3BsaXQoJycpLm1hcChvcmQpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKEFycmF5LmlzQXJyYXkocykpIHtcbiAgICAgICAgICAgIHJldHVybiBzLnJlZHVjZShmdW5jdGlvbiAoYWNjLCBjKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGFjYy5jb25jYXQoYnl0ZXMoYykpO1xuICAgICAgICAgICAgfSwgW10pO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBuZXcgQnVmZmVyKFsgMHgxYiBdLmNvbmNhdChieXRlcyh4cykpKTtcbn07XG5cbnZhciBvcmQgPSBlbmNvZGUub3JkID0gZnVuY3Rpb24gb3JkIChjKSB7XG4gICAgcmV0dXJuIGMuY2hhckNvZGVBdCgwKVxufTtcblxufSkocmVxdWlyZShcIl9fYnJvd3NlcmlmeV9idWZmZXJcIikuQnVmZmVyKSJdfQ==
;