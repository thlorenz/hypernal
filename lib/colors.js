'use strict';

module.exports = function (Terminal) {

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
};
