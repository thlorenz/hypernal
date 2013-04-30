'use strict';

var cancel = require('./helpers/cancel');

module.exports = function (Terminal) {
  Terminal.prototype.keyPress = function(ev) {
    var key;

    cancel(ev);

    if (ev.charCode) {
      key = ev.charCode;
    } else if (ev.which === null) {
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
};
