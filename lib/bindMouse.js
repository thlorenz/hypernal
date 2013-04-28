'use strict';
var on       =  require('./helpers/on')
  , off      =  require('./helpers/off')
  , cancel   =  require('./helpers/cancel');

module.exports = function (Terminal) {
  
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
          var data;
          if (self.vt300Mouse) {
              // NOTE: Unstable.
              // http://www.vt100.net/docs/vt3xx-gp/chapter15.html
              button &= 3;
              pos.x -= 32;
              pos.y -= 32;
              data = '\x1b[24';
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

          data = [];

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
              button = ev.button !== null ? +ev.button : ev.which !== null ? ev.which - 1 : null;

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
          if (ev.pageX === null) return;

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
};
