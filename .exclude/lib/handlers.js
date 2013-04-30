'use strict';

module.exports = function (Terminal) {
  Terminal.prototype.handler = function(data) {
    this.emit('data', data);
  };

  Terminal.prototype.handleTitle = function(title) {
    this.emit('title', title);
  };
};
