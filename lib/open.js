'use strict';

var on     =  require('./helpers/on')
  , cancel =  require('./helpers/cancel')
  ;

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

module.exports = function (Terminal) {
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
      var button = ev.button !== null ? +ev.button : ev.which !== null ? ev.which - 1 : null;

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

    this.bindMouse && this.bindMouse();

    // XXX - hack, move this somewhere else.
    if (Terminal.brokenBold === null) {
      Terminal.brokenBold = isBoldBroken();
    }

    // sync default bg/fg colors
    this.element.style.backgroundColor = Terminal.defaultColors.bg;
    this.element.style.color = Terminal.defaultColors.fg;

    //this.emit('open');
  };
};
