'use strict';

module.exports = function (Terminal) {

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

    
    width = this.cols;
    y = start;

    for (; y <= end; y++) {
      row = y + this.ydisp;

      line = this.lines[row];
      if (!line) {
        // simple solution in case we have more lines than rows
        // could be improved to instead remove first line (and related html element)
        return this.reset();
      }

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
};
