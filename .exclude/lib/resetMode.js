'use strict';

module.exports = function (Terminal) {
  // CSI Pm l Reset Mode (RM).
  // Ps = 2 -> Keyboard Action Mode (AM).
  // Ps = 4 -> Replace Mode (IRM).
  // Ps = 1 2 -> Send/receive (SRM).
  // Ps = 2 0 -> Normal Linefeed (LNM).
  // CSI ? Pm l
  // DEC Private Mode Reset (DECRST).
  // Ps = 1 -> Normal Cursor Keys (DECCKM).
  // Ps = 2 -> Designate VT52 mode (DECANM).
  // Ps = 3 -> 80 Column Mode (DECCOLM).
  // Ps = 4 -> Jump (Fast) Scroll (DECSCLM).
  // Ps = 5 -> Normal Video (DECSCNM).
  // Ps = 6 -> Normal Cursor Mode (DECOM).
  // Ps = 7 -> No Wraparound Mode (DECAWM).
  // Ps = 8 -> No Auto-repeat Keys (DECARM).
  // Ps = 9 -> Don't send Mouse X & Y on button press.
  // Ps = 1 0 -> Hide toolbar (rxvt).
  // Ps = 1 2 -> Stop Blinking Cursor (att610).
  // Ps = 1 8 -> Don't print form feed (DECPFF).
  // Ps = 1 9 -> Limit print to scrolling region (DECPEX).
  // Ps = 2 5 -> Hide Cursor (DECTCEM).
  // Ps = 3 0 -> Don't show scrollbar (rxvt).
  // Ps = 3 5 -> Disable font-shifting functions (rxvt).
  // Ps = 4 0 -> Disallow 80 -> 132 Mode.
  // Ps = 4 1 -> No more(1) fix (see curses resource).
  // Ps = 4 2 -> Disable Nation Replacement Character sets (DEC-
  // NRCM).
  // Ps = 4 4 -> Turn Off Margin Bell.
  // Ps = 4 5 -> No Reverse-wraparound Mode.
  // Ps = 4 6 -> Stop Logging. (This is normally disabled by a
  // compile-time option).
  // Ps = 4 7 -> Use Normal Screen Buffer.
  // Ps = 6 6 -> Numeric keypad (DECNKM).
  // Ps = 6 7 -> Backarrow key sends delete (DECBKM).
  // Ps = 1 0 0 0 -> Don't send Mouse X & Y on button press and
  // release. See the section Mouse Tracking.
  // Ps = 1 0 0 1 -> Don't use Hilite Mouse Tracking.
  // Ps = 1 0 0 2 -> Don't use Cell Motion Mouse Tracking.
  // Ps = 1 0 0 3 -> Don't use All Motion Mouse Tracking.
  // Ps = 1 0 0 4 -> Don't send FocusIn/FocusOut events.
  // Ps = 1 0 0 5 -> Disable Extended Mouse Mode.
  // Ps = 1 0 1 0 -> Don't scroll to bottom on tty output
  // (rxvt).
  // Ps = 1 0 1 1 -> Don't scroll to bottom on key press (rxvt).
  // Ps = 1 0 3 4 -> Don't interpret "meta" key. (This disables
  // the eightBitInput resource).
  // Ps = 1 0 3 5 -> Disable special modifiers for Alt and Num-
  // Lock keys. (This disables the numLock resource).
  // Ps = 1 0 3 6 -> Don't send ESC when Meta modifies a key.
  // (This disables the metaSendsEscape resource).
  // Ps = 1 0 3 7 -> Send VT220 Remove from the editing-keypad
  // Delete key.
  // Ps = 1 0 3 9 -> Don't send ESC when Alt modifies a key.
  // (This disables the altSendsEscape resource).
  // Ps = 1 0 4 0 -> Do not keep selection when not highlighted.
  // (This disables the keepSelection resource).
  // Ps = 1 0 4 1 -> Use the PRIMARY selection. (This disables
  // the selectToClipboard resource).
  // Ps = 1 0 4 2 -> Disable Urgency window manager hint when
  // Control-G is received. (This disables the bellIsUrgent
  // resource).
  // Ps = 1 0 4 3 -> Disable raising of the window when Control-
  // G is received. (This disables the popOnBell resource).
  // Ps = 1 0 4 7 -> Use Normal Screen Buffer, clearing screen
  // first if in the Alternate Screen. (This may be disabled by
  // the titeInhibit resource).
  // Ps = 1 0 4 8 -> Restore cursor as in DECRC. (This may be
  // disabled by the titeInhibit resource).
  // Ps = 1 0 4 9 -> Use Normal Screen Buffer and restore cursor
  // as in DECRC. (This may be disabled by the titeInhibit
  // resource). This combines the effects of the 1 0 4 7 and 1 0
  // 4 8 modes. Use this with terminfo-based applications rather
  // than the 4 7 mode.
  // Ps = 1 0 5 0 -> Reset terminfo/termcap function-key mode.
  // Ps = 1 0 5 1 -> Reset Sun function-key mode.
  // Ps = 1 0 5 2 -> Reset HP function-key mode.
  // Ps = 1 0 5 3 -> Reset SCO function-key mode.
  // Ps = 1 0 6 0 -> Reset legacy keyboard emulation (X11R6).
  // Ps = 1 0 6 1 -> Reset keyboard emulation to Sun/PC style.
  // Ps = 2 0 0 4 -> Reset bracketed paste mode.
  Terminal.prototype.resetMode = function(params) {
    if (typeof params === 'object') {
      var l = params.length,
        i = 0;

      for (; i < l; i++) {
        this.resetMode(params[i]);
      }

      return;
    }

    if (!this.prefix) {
      switch (params) {
      case 4:
        this.insertMode = false;
        break;
      case 20:
        //this.convertEol = false;
        break;
      }
    } else if (this.prefix === '?') {
      switch (params) {
      case 1:
        this.applicationKeypad = false;
        break;
      case 3:
        //- if (this.cols === 132 && this.savedCols) {
        //-   this.resize(this.savedCols, this.rows);
        //- }
        delete this.savedCols;
        break;
      case 6:
        this.originMode = false;
        break;
      case 7:
        this.wraparoundMode = false;
        break;
      case 12:
        // this.cursorBlink = false;
        break;
      case 9:
        // X10 Mouse
      case 1000:
        // vt200 mouse
      case 1002:
        // button event mouse
      case 1003:
        // any event mouse
        //- this.x10Mouse = false;
        //- this.vt200Mouse = false;
        //- this.normalMouse = false;
        //- this.mouseEvents = false;
        //- this.element.style.cursor = '';
        break;
      case 1004:
        // send focusin/focusout events
        this.sendFocus = false;
        break;
      case 1005:
        // utf8 ext mode mouse
        //- this.utfMouse = false;
        break;
      case 1006:
        // sgr ext mode mouse
        //- this.sgrMouse = false;
        break;
      case 1015:
        // urxvt ext mode mouse
        //- this.urxvtMouse = false;
        break;
      case 25:
        // hide cursor
        this.cursorHidden = true;
        break;
      case 1049:
        // alt screen buffer cursor
        ; // FALL-THROUGH
      case 47:
        // normal screen buffer
      case 1047:
        // normal screen buffer - clearing it first
        if (this.normal) {
          this.lines = this.normal.lines;
          this.ybase = this.normal.ybase;
          this.ydisp = this.normal.ydisp;
          this.x = this.normal.x;
          this.y = this.normal.y;
          this.scrollTop = this.normal.scrollTop;
          this.scrollBottom = this.normal.scrollBottom;
          this.tabs = this.normal.tabs;
          this.normal = null;

          this.refresh(0, this.rows - 1);
        }
        break;
      }
    }
  };
};
