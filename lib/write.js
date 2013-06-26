'use strict';

var states = require('./states');

function fixLinefeed(data) {
  return data.replace(/([^\r])\n/g, '$1\r\n');
}

function fixIndent(data) {
  if (!/(^|\n) /.test(data)) return data;

  // not very efficient, but works and would only become a problem
  // once we render huge amounts of data
  return data
    .split('\n')
    .map(function (line) {
      var count = 0;
      while(line.charAt(0) === ' '){
        line = line.slice(1);
        count++;
      }
      while(count--) {
        line = '&nbsp;' + line;
      }
      return line;
    })
    .join('\r\n');
}

module.exports = function(Terminal) {

  Terminal.prototype.write = function(data) {

    data = fixLinefeed(data);
    data = fixIndent(data);

    var l = data.length,
      i = 0,
      cs, ch;

    this.refreshStart = this.y;
    this.refreshEnd = this.y;

    if (this.ybase !== this.ydisp) {
      this.ydisp = this.ybase;
      this.maxRange();
    }

    // this.log(JSON.stringify(data.replace(/\x1b/g, '^[')));

    for (; i < l; i++) {
      ch = data[i];
      switch (this.state) {
      case states.normal:
        switch (ch) {
          // '\0'
          // case '\0':
          // break;

          // '\a'
        case '\x07':
          this.bell();
          break;

          // '\n', '\v', '\f'
        case '\n':
        case '\x0b':
        case '\x0c':
          if (this.convertEol) {
            this.x = 0;
          }
          this.y++;
          break;

          // '\r'
        case '\r':
          this.x = 0;
          break;

          // '\b'
        case '\x08':
          if (this.x > 0) {
            this.x--;
          }
          break;

          // '\t'
        case '\t':
          this.x = this.nextStop();
          break;

          // shift out
        case '\x0e':
          this.setgLevel(1);
          break;

          // shift in
        case '\x0f':
          this.setgLevel(0);
          break;

          // '\e'
        case '\x1b':
          this.state = states.escaped;
          break;

        default:
          // ' '
          if (ch >= ' ') {
            if (this.charset && this.charset[ch]) {
              ch = this.charset[ch];
            }
            if (this.x >= this.cols) {
              this.x = 0;
              this.y++;
            }

            // FIXME: this prevents errors from being thrown, but needs a proper fix
            if (this.lines[this.y + this.ybase])
              this.lines[this.y + this.ybase][this.x] = [this.curAttr, ch];

            this.x++;
            this.updateRange(this.y);
          }
          break;
        }
        break;
      case states.escaped:
        switch (ch) {
          // ESC [ Control Sequence Introducer ( CSI is 0x9b).
        case '[':
          this.params = [];
          this.currentParam = 0;
          this.state = states.csi;
          break;

          // ESC ] Operating System Command ( OSC is 0x9d).
        case ']':
          this.params = [];
          this.currentParam = 0;
          this.state = states.osc;
          break;

          // ESC P Device Control String ( DCS is 0x90).
        case 'P':
          this.params = [];
          this.currentParam = 0;
          this.state = states.dcs;
          break;

          // ESC _ Application Program Command ( APC is 0x9f).
        case '_':
          this.stateType = 'apc';
          this.state = states.ignore;
          break;

          // ESC ^ Privacy Message ( PM is 0x9e).
        case '^':
          this.stateType = 'pm';
          this.state = states.ignore;
          break;

          // ESC c Full Reset (RIS).
        case 'c':
          this.reset();
          break;

          // ESC E Next Line ( NEL is 0x85).
          // ESC D Index ( IND is 0x84).
        case 'E':
          this.x = 0;
          break;
        case 'D':
          this.index();
          break;

          // ESC M Reverse Index ( RI is 0x8d).
        case 'M':
          this.reverseIndex();
          break;

          // ESC % Select default/utf-8 character set.
          // @ = default, G = utf-8
        case '%':
          //this.charset = null;
          this.setgLevel(0);
          this.setgCharset(0, Terminal.charsets.US);
          this.state = states.normal;
          i++;
          break;

          // ESC (,),*,+,-,. Designate G0-G2 Character Set.
        case '(':
          // <-- this seems to get all the attention
        case ')':
        case '*':
        case '+':
        case '-':
        case '.':
          switch (ch) {
          case '(':
            this.gcharset = 0;
            break;
          case ')':
            this.gcharset = 1;
            break;
          case '*':
            this.gcharset = 2;
            break;
          case '+':
            this.gcharset = 3;
            break;
          case '-':
            this.gcharset = 1;
            break;
          case '.':
            this.gcharset = 2;
            break;
          }
          this.state = states.charset;
          break;

          // Designate G3 Character Set (VT300).
          // A = ISO Latin-1 Supplemental.
          // Not implemented.
        case '/':
          this.gcharset = 3;
          this.state = states.charset;
          i--;
          break;

          // ESC N
          // Single Shift Select of G2 Character Set
          // ( SS2 is 0x8e). This affects next character only.
        case 'N':
          break;
          // ESC O
          // Single Shift Select of G3 Character Set
          // ( SS3 is 0x8f). This affects next character only.
        case 'O':
          break;
          // ESC n
          // Invoke the G2 Character Set as GL (LS2).
        case 'n':
          this.setgLevel(2);
          break;
          // ESC o
          // Invoke the G3 Character Set as GL (LS3).
        case 'o':
          this.setgLevel(3);
          break;
          // ESC |
          // Invoke the G3 Character Set as GR (LS3R).
        case '|':
          this.setgLevel(3);
          break;
          // ESC }
          // Invoke the G2 Character Set as GR (LS2R).
        case '}':
          this.setgLevel(2);
          break;
          // ESC ~
          // Invoke the G1 Character Set as GR (LS1R).
        case '~':
          this.setgLevel(1);
          break;

          // ESC 7 Save Cursor (DECSC).
        case '7':
          this.saveCursor();
          this.state = states.normal;
          break;

          // ESC 8 Restore Cursor (DECRC).
        case '8':
          this.restoreCursor();
          this.state = states.normal;
          break;

          // ESC # 3 DEC line height/width
        case '#':
          this.state = states.normal;
          i++;
          break;

          // ESC H Tab Set (HTS is 0x88).
        case 'H':
          this.tabSet();
          break;

          // ESC = Application Keypad (DECPAM).
        case '=':
          this.log('Serial port requested application keypad.');
          this.applicationKeypad = true;
          this.state = states.normal;
          break;

          // ESC > Normal Keypad (DECPNM).
        case '>':
          this.log('Switching back to normal keypad.');
          this.applicationKeypad = false;
          this.state = states.normal;
          break;

        default:
          this.state = states.normal;
          this.error('Unknown ESC control: %s.', ch);
          break;
        }
        break;

      case states.charset:
        switch (ch) {
        case '0':
          // DEC Special Character and Line Drawing Set.
          cs = Terminal.charsets.SCLD;
          break;
        case 'A':
          // UK
          cs = Terminal.charsets.UK;
          break;
        case 'B':
          // United States (USASCII).
          cs = Terminal.charsets.US;
          break;
        case '4':
          // Dutch
          cs = Terminal.charsets.Dutch;
          break;
        case 'C':
          // Finnish
        case '5':
          cs = Terminal.charsets.Finnish;
          break;
        case 'R':
          // French
          cs = Terminal.charsets.French;
          break;
        case 'Q':
          // FrenchCanadian
          cs = Terminal.charsets.FrenchCanadian;
          break;
        case 'K':
          // German
          cs = Terminal.charsets.German;
          break;
        case 'Y':
          // Italian
          cs = Terminal.charsets.Italian;
          break;
        case 'E':
          // NorwegianDanish
        case '6':
          cs = Terminal.charsets.NorwegianDanish;
          break;
        case 'Z':
          // Spanish
          cs = Terminal.charsets.Spanish;
          break;
        case 'H':
          // Swedish
        case '7':
          cs = Terminal.charsets.Swedish;
          break;
        case '=':
          // Swiss
          cs = Terminal.charsets.Swiss;
          break;
        case '/':
          // ISOLatin (actually /A)
          cs = Terminal.charsets.ISOLatin;
          i++;
          break;
        default:
          // Default
          cs = Terminal.charsets.US;
          break;
        }
        this.setgCharset(this.gcharset, cs);
        this.gcharset = null;
        this.state = states.normal;
        break;

      case states.osc:
        // OSC Ps ; Pt ST
        // OSC Ps ; Pt BEL
        // Set Text Parameters.
        if (ch === '\x1b' || ch === '\x07') {
          if (ch === '\x1b') i++;

          this.params.push(this.currentParam);

          switch (this.params[0]) {
          case 0:
          case 1:
          case 2:
            if (this.params[1]) {
              this.title = this.params[1];
              this.handleTitle(this.title);
            }
            break;
          case 3:
            // set X property
            break;
          case 4:
          case 5:
            // change dynamic colors
            break;
          case 10:
          case 11:
          case 12:
          case 13:
          case 14:
          case 15:
          case 16:
          case 17:
          case 18:
          case 19:
            // change dynamic ui colors
            break;
          case 46:
            // change log file
            break;
          case 50:
            // dynamic font
            break;
          case 51:
            // emacs shell
            break;
          case 52:
            // manipulate selection data
            break;
          case 104:
          case 105:
          case 110:
          case 111:
          case 112:
          case 113:
          case 114:
          case 115:
          case 116:
          case 117:
          case 118:
            // reset colors
            break;
          }

          this.params = [];
          this.currentParam = 0;
          this.state = states.normal;
        } else {
          if (!this.params.length) {
            if (ch >= '0' && ch <= '9') {
              this.currentParam = this.currentParam * 10 + ch.charCodeAt(0) - 48;
            } else if (ch === ';') {
              this.params.push(this.currentParam);
              this.currentParam = '';
            }
          } else {
            this.currentParam += ch;
          }
        }
        break;

      case states.csi:
        // '?', '>', '!'
        if (ch === '?' || ch === '>' || ch === '!') {
          this.prefix = ch;
          break;
        }

        // 0 - 9
        if (ch >= '0' && ch <= '9') {
          this.currentParam = this.currentParam * 10 + ch.charCodeAt(0) - 48;
          break;
        }

        // '$', '"', ' ', '\''
        if (ch === '$' || ch === '"' || ch === ' ' || ch === '\'') {
          this.postfix = ch;
          break;
        }

        this.params.push(this.currentParam);
        this.currentParam = 0;

        // ';'
        if (ch === ';') break;

        this.state = states.normal;

        switch (ch) {
          // CSI Ps A
          // Cursor Up Ps Times (default = 1) (CUU).
        case 'A':
          this.cursorUp(this.params);
          break;

          // CSI Ps B
          // Cursor Down Ps Times (default = 1) (CUD).
        case 'B':
          this.cursorDown(this.params);
          break;

          // CSI Ps C
          // Cursor Forward Ps Times (default = 1) (CUF).
        case 'C':
          this.cursorForward(this.params);
          break;

          // CSI Ps D
          // Cursor Backward Ps Times (default = 1) (CUB).
        case 'D':
          this.cursorBackward(this.params);
          break;

          // CSI Ps ; Ps H
          // Cursor Position [row;column] (default = [1,1]) (CUP).
        case 'H':
          this.cursorPos(this.params);
          break;

          // CSI Ps J Erase in Display (ED).
        case 'J':
          this.eraseInDisplay(this.params);
          break;

          // CSI Ps K Erase in Line (EL).
        case 'K':
          this.eraseInLine(this.params);
          break;

          // CSI Pm m Character Attributes (SGR).
        case 'm':
          this.charAttributes(this.params);
          break;

          // CSI Ps n Device Status Report (DSR).
        case 'n':
          this.deviceStatus(this.params);
          break;

          /**
          * Additions
          */

          // CSI Ps @
          // Insert Ps (Blank) Character(s) (default = 1) (ICH).
        case '@':
          this.insertChars(this.params);
          break;

          // CSI Ps E
          // Cursor Next Line Ps Times (default = 1) (CNL).
        case 'E':
          this.cursorNextLine(this.params);
          break;

          // CSI Ps F
          // Cursor Preceding Line Ps Times (default = 1) (CNL).
        case 'F':
          this.cursorPrecedingLine(this.params);
          break;

          // CSI Ps G
          // Cursor Character Absolute [column] (default = [row,1]) (CHA).
        case 'G':
          this.cursorCharAbsolute(this.params);
          break;

          // CSI Ps L
          // Insert Ps Line(s) (default = 1) (IL).
        case 'L':
          this.insertLines(this.params);
          break;

          // CSI Ps M
          // Delete Ps Line(s) (default = 1) (DL).
        case 'M':
          this.deleteLines(this.params);
          break;

          // CSI Ps P
          // Delete Ps Character(s) (default = 1) (DCH).
        case 'P':
          this.deleteChars(this.params);
          break;

          // CSI Ps X
          // Erase Ps Character(s) (default = 1) (ECH).
        case 'X':
          this.eraseChars(this.params);
          break;

          // CSI Pm ` Character Position Absolute
          // [column] (default = [row,1]) (HPA).
        case '`':
          this.charPosAbsolute(this.params);
          break;

          // 141 61 a * HPR -
          // Horizontal Position Relative
        case 'a':
          this.HPositionRelative(this.params);
          break;

          // CSI P s c
          // Send Device Attributes (Primary DA).
          // CSI > P s c
          // Send Device Attributes (Secondary DA)
        case 'c':
          //- this.sendDeviceAttributes(this.params);
          break;

          // CSI Pm d
          // Line Position Absolute [row] (default = [1,column]) (VPA).
        case 'd':
          this.linePosAbsolute(this.params);
          break;

          // 145 65 e * VPR - Vertical Position Relative
        case 'e':
          this.VPositionRelative(this.params);
          break;

          // CSI Ps ; Ps f
          // Horizontal and Vertical Position [row;column] (default =
          // [1,1]) (HVP).
        case 'f':
          this.HVPosition(this.params);
          break;

          // CSI Pm h Set Mode (SM).
          // CSI ? Pm h - mouse escape codes, cursor escape codes
        case 'h':
          //- this.setMode(this.params);
          break;

          // CSI Pm l Reset Mode (RM).
          // CSI ? Pm l
        case 'l':
          //- this.resetMode(this.params);
          break;

          // CSI Ps ; Ps r
          // Set Scrolling Region [top;bottom] (default = full size of win-
          // dow) (DECSTBM).
          // CSI ? Pm r
        case 'r':
          //- this.setScrollRegion(this.params);
          break;

          // CSI s
          // Save cursor (ANSI.SYS).
        case 's':
          this.saveCursor(this.params);
          break;

          // CSI u
          // Restore cursor (ANSI.SYS).
        case 'u':
          this.restoreCursor(this.params);
          break;

          /**
          * Lesser Used
          */

          // CSI Ps I
          // Cursor Forward Tabulation Ps tab stops (default = 1) (CHT).
        case 'I':
          this.cursorForwardTab(this.params);
          break;

          // CSI Ps S Scroll up Ps lines (default = 1) (SU).
        case 'S':
          //- this.scrollUp(this.params);
          break;

          // CSI Ps T Scroll down Ps lines (default = 1) (SD).
          // CSI Ps ; Ps ; Ps ; Ps ; Ps T
          // CSI > Ps; Ps T
        case 'T':
          if (this.params.length < 2 && !this.prefix) {
            //- this.scrollDown(this.params);
          }
          break;

          // CSI Ps Z
          // Cursor Backward Tabulation Ps tab stops (default = 1) (CBT).
        case 'Z':
          this.cursorBackwardTab(this.params);
          break;

          // CSI Ps b Repeat the preceding graphic character Ps times (REP).
        case 'b':
          this.repeatPrecedingCharacter(this.params);
          break;

          // CSI Ps g Tab Clear (TBC).
        case 'g':
          this.tabClear(this.params);
          break;
        case 'p':
          switch (this.prefix) {
          case '!':
            this.softReset(this.params);
            break;
          }
          break;

        default:
          this.error('Unknown CSI code: %s.', ch);
          break;
        }

        this.prefix = '';
        this.postfix = '';
        break;

      case states.dcs:
        if (ch === '\x1b' || ch === '\x07') {
          if (ch === '\x1b') i++;

          switch (this.prefix) {
            // User-Defined Keys (DECUDK).
          case '':
            break;

            // Request Status String (DECRQSS).
            // test: echo -e '\eP$q"p\e\\'
          case '$q':
            var pt = this.currentParam,
              valid = false;

            switch (pt) {
              // DECSCA
            case '"q':
              pt = '0"q';
              break;

              // DECSCL
            case '"p':
              pt = '61"p';
              break;

              // DECSTBM
            case 'r':
              pt = '' + (this.scrollTop + 1) + ';' + (this.scrollBottom + 1) + 'r';
              break;

              // SGR
            case 'm':
              pt = '0m';
              break;

            default:
              this.error('Unknown DCS Pt: %s.', pt);
              pt = '';
              break;
            }

            //- this.send('\x1bP' + valid + '$r' + pt + '\x1b\\');
            break;

            // Set Termcap/Terminfo Data (xterm, experimental).
          case '+p':
            break;

          default:
            this.error('Unknown DCS prefix: %s.', this.prefix);
            break;
          }

          this.currentParam = 0;
          this.prefix = '';
          this.state = states.normal;
        } else if (!this.currentParam) {
          if (!this.prefix && ch !== '$' && ch !== '+') {
            this.currentParam = ch;
          } else if (this.prefix.length === 2) {
            this.currentParam = ch;
          } else {
            this.prefix += ch;
          }
        } else {
          this.currentParam += ch;
        }
        break;

      case states.ignore:
        // For PM and APC.
        if (ch === '\x1b' || ch === '\x07') {
          if (ch === '\x1b') i++;
          this.stateData = '';
          this.state = states.normal;
        } else {
          if (!this.stateData) this.stateData = '';
          this.stateData += ch;
        }
        break;
      }
    }

    this.updateRange(this.y);
    this.refresh(this.refreshStart, this.refreshEnd);
  };

  Terminal.prototype.writeln = function(data) {
    // at times spaces appear in between escape chars and fixIndent fails us, so we fix it here
    data = data.replace(/ /g, '&nbsp;');
    // adding empty char before line break ensures that empty lines render properly
    this.write(data + ' \r\n');
  };
};
