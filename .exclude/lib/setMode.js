'use strict';

module.exports = function (Terminal) {
  // CSI Pm h Set Mode (SM).
  // Ps = 2 -> Keyboard Action Mode (AM).
  // Ps = 4 -> Insert Mode (IRM).
  // Ps = 1 2 -> Send/receive (SRM).
  // Ps = 2 0 -> Automatic Newline (LNM).
  // CSI ? Pm h
  // DEC Private Mode Set (DECSET).
  // Ps = 1 -> Application Cursor Keys (DECCKM).
  // Ps = 2 -> Designate USASCII for character sets G0-G3
  // (DECANM), and set VT100 mode.
  // Ps = 3 -> 132 Column Mode (DECCOLM).
  // Ps = 4 -> Smooth (Slow) Scroll (DECSCLM).
  // Ps = 5 -> Reverse Video (DECSCNM).
  // Ps = 6 -> Origin Mode (DECOM).
  // Ps = 7 -> Wraparound Mode (DECAWM).
  // Ps = 8 -> Auto-repeat Keys (DECARM).
  // Ps = 9 -> Send Mouse X & Y on button press. See the sec-
  // tion Mouse Tracking.
  // Ps = 1 0 -> Show toolbar (rxvt).
  // Ps = 1 2 -> Start Blinking Cursor (att610).
  // Ps = 1 8 -> Print form feed (DECPFF).
  // Ps = 1 9 -> Set print extent to full screen (DECPEX).
  // Ps = 2 5 -> Show Cursor (DECTCEM).
  // Ps = 3 0 -> Show scrollbar (rxvt).
  // Ps = 3 5 -> Enable font-shifting functions (rxvt).
  // Ps = 3 8 -> Enter Tektronix Mode (DECTEK).
  // Ps = 4 0 -> Allow 80 -> 132 Mode.
  // Ps = 4 1 -> more(1) fix (see curses resource).
  // Ps = 4 2 -> Enable Nation Replacement Character sets (DECN-
  // RCM).
  // Ps = 4 4 -> Turn On Margin Bell.
  // Ps = 4 5 -> Reverse-wraparound Mode.
  // Ps = 4 6 -> Start Logging. This is normally disabled by a
  // compile-time option.
  // Ps = 4 7 -> Use Alternate Screen Buffer. (This may be dis-
  // abled by the titeInhibit resource).
  // Ps = 6 6 -> Application keypad (DECNKM).
  // Ps = 6 7 -> Backarrow key sends backspace (DECBKM).
  // Ps = 1 0 0 0 -> Send Mouse X & Y on button press and
  // release. See the section Mouse Tracking.
  // Ps = 1 0 0 1 -> Use Hilite Mouse Tracking.
  // Ps = 1 0 0 2 -> Use Cell Motion Mouse Tracking.
  // Ps = 1 0 0 3 -> Use All Motion Mouse Tracking.
  // Ps = 1 0 0 4 -> Send FocusIn/FocusOut events.
  // Ps = 1 0 0 5 -> Enable Extended Mouse Mode.
  // Ps = 1 0 1 0 -> Scroll to bottom on tty output (rxvt).
  // Ps = 1 0 1 1 -> Scroll to bottom on key press (rxvt).
  // Ps = 1 0 3 4 -> Interpret "meta" key, sets eighth bit.
  // (enables the eightBitInput resource).
  // Ps = 1 0 3 5 -> Enable special modifiers for Alt and Num-
  // Lock keys. (This enables the numLock resource).
  // Ps = 1 0 3 6 -> Send ESC when Meta modifies a key. (This
  // enables the metaSendsEscape resource).
  // Ps = 1 0 3 7 -> Send DEL from the editing-keypad Delete
  // key.
  // Ps = 1 0 3 9 -> Send ESC when Alt modifies a key. (This
  // enables the altSendsEscape resource).
  // Ps = 1 0 4 0 -> Keep selection even if not highlighted.
  // (This enables the keepSelection resource).
  // Ps = 1 0 4 1 -> Use the CLIPBOARD selection. (This enables
  // the selectToClipboard resource).
  // Ps = 1 0 4 2 -> Enable Urgency window manager hint when
  // Control-G is received. (This enables the bellIsUrgent
  // resource).
  // Ps = 1 0 4 3 -> Enable raising of the window when Control-G
  // is received. (enables the popOnBell resource).
  // Ps = 1 0 4 7 -> Use Alternate Screen Buffer. (This may be
  // disabled by the titeInhibit resource).
  // Ps = 1 0 4 8 -> Save cursor as in DECSC. (This may be dis-
  // abled by the titeInhibit resource).
  // Ps = 1 0 4 9 -> Save cursor as in DECSC and use Alternate
  // Screen Buffer, clearing it first. (This may be disabled by
  // the titeInhibit resource). This combines the effects of the 1
  // 0 4 7 and 1 0 4 8 modes. Use this with terminfo-based
  // applications rather than the 4 7 mode.
  // Ps = 1 0 5 0 -> Set terminfo/termcap function-key mode.
  // Ps = 1 0 5 1 -> Set Sun function-key mode.
  // Ps = 1 0 5 2 -> Set HP function-key mode.
  // Ps = 1 0 5 3 -> Set SCO function-key mode.
  // Ps = 1 0 6 0 -> Set legacy keyboard emulation (X11R6).
  // Ps = 1 0 6 1 -> Set VT220 keyboard emulation.
  // Ps = 2 0 0 4 -> Set bracketed paste mode.
  // Modes:
  // http://vt100.net/docs/vt220-rm/chapter4.html

  Terminal.prototype.setMode = function(params) {
    if (typeof params === 'object') {
      var l = params.length,
        i = 0;

      for (; i < l; i++) {
        this.setMode(params[i]);
      }

      return;
    }

    if (!this.prefix) {
      switch (params) {
      case 4:
        this.insertMode = true;
        break;
      case 20:
        //this.convertEol = true;
        break;
      }
    } else if (this.prefix === '?') {
      switch (params) {
      case 1:
        this.applicationKeypad = true;
        break;
      case 2:
        this.setgCharset(0, Terminal.charsets.US);
        this.setgCharset(1, Terminal.charsets.US);
        this.setgCharset(2, Terminal.charsets.US);
        this.setgCharset(3, Terminal.charsets.US);
        // set VT100 mode here
        break;
      case 3:
        // 132 col mode
        this.savedCols = this.cols;
        this.resize(132, this.rows);
        break;
      case 6:
        this.originMode = true;
        break;
      case 7:
        this.wraparoundMode = true;
        break;
      case 12:
        // this.cursorBlink = true;
        break;
      case 9:
        // X10 Mouse
        // no release, no motion, no wheel, no modifiers.
      case 1000:
        // vt200 mouse
        // no motion.
        // no modifiers, except control on the wheel.
      case 1002:
        // button event mouse
      case 1003:
        // any event mouse
        // any event - sends motion events,
        // even if there is no button held down.
        //- this.x10Mouse = params === 9;
        //- this.vt200Mouse = params === 1000;
        //- this.normalMouse = params > 1000;
        //- this.mouseEvents = true;
        //- this.element.style.cursor = 'default';
        break;
      case 1004:
        // send focusin/focusout events
        // focusin: ^[[I
        // focusout: ^[[O
        this.sendFocus = true;
        break;
      case 1005:
        // utf8 ext mode mouse
        this.utfMouse = true;
        // for wide terminals
        // simply encodes large values as utf8 characters
        break;
      case 1006:
        // sgr ext mode mouse
        this.sgrMouse = true;
        // for wide terminals
        // does not add 32 to fields
        // press: ^[[<b;x;yM
        // release: ^[[<b;x;ym
        break;
      case 1015:
        // urxvt ext mode mouse
        this.urxvtMouse = true;
        // for wide terminals
        // numbers for fields
        // press: ^[[b;x;yM
        // motion: ^[[b;x;yT
        break;
      case 25:
        // show cursor
        this.cursorHidden = false;
        break;
      case 1049:
        // alt screen buffer cursor
        //this.saveCursor();
        ; // FALL-THROUGH
      case 47:
        // alt screen buffer
      case 1047:
        // alt screen buffer
        if (!this.normal) {
          var normal = {
            lines: this.lines,
            ybase: this.ybase,
            ydisp: this.ydisp,
            x: this.x,
            y: this.y,
            scrollTop: this.scrollTop,
            scrollBottom: this.scrollBottom,
            tabs: this.tabs
            // XXX save charset(s) here?
            // charset: this.charset,
            // glevel: this.glevel,
            // charsets: this.charsets
          };
          this.reset();
          this.normal = normal;
          this.showCursor();
        }
        break;
      }
    }
  };
};
