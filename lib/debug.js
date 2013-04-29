'use strict';

module.exports = function (Terminal) {
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
};
