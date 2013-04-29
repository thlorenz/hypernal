'use strict';
// ignore warnings regarging == and != (coersion makes things work here appearently)

module.exports = function (Terminal) {
  
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
};
