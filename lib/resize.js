'use strict';

module.exports = function (Terminal) {
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
};
