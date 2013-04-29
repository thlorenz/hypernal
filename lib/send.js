'use strict';

module.exports = function (Terminal) {
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
};
