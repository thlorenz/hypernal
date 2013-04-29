'use strict';

module.exports = function (Terminal) {
  // CSI Pm ` Character Position Absolute
  // [column] (default = [row,1]) (HPA).
  Terminal.prototype.charPosAbsolute = function(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.x = param - 1;
    if (this.x >= this.cols) {
      this.x = this.cols - 1;
    }
  };

  // 141 61 a * HPR -
  // Horizontal Position Relative
  // reuse CSI Ps C ?
  Terminal.prototype.HPositionRelative = function(params) {
    var param = params[0];
    if (param < 1) param = 1;
    this.x += param;
    if (this.x >= this.cols) {
      this.x = this.cols - 1;
    }
  };
  
  // CSI Pm d
  // Line Position Absolute [row] (default = [1,column]) (VPA).
  Terminal.prototype.linePosAbsolute = function(params) {
      var param = params[0];
      if (param < 1) param = 1;
      this.y = param - 1;
      if (this.y >= this.rows) {
          this.y = this.rows - 1;
      }
  };

  // 145 65 e * VPR - Vertical Position Relative
  // reuse CSI Ps B ?
  Terminal.prototype.VPositionRelative = function(params) {
      var param = params[0];
      if (param < 1) param = 1;
      this.y += param;
      if (this.y >= this.rows) {
          this.y = this.rows - 1;
      }
  };

  // CSI Ps ; Ps f
  // Horizontal and Vertical Position [row;column] (default =
  // [1,1]) (HVP).
  Terminal.prototype.HVPosition = function(params) {
      if (params[0] < 1) params[0] = 1;
      if (params[1] < 1) params[1] = 1;

      this.y = params[0] - 1;
      if (this.y >= this.rows) {
          this.y = this.rows - 1;
      }

      this.x = params[1] - 1;
      if (this.x >= this.cols) {
          this.x = this.cols - 1;
      }
  };
};
