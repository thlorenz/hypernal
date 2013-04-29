'use strict';

module.exports = function (Terminal) {

Terminal.charsets = {};

  // DEC Special Character and Line Drawing Set.
  // http://vt100.net/docs/vt102-ug/table5-13.html
  // A lot of curses apps use this if they see TERM=xterm.
  // testing: echo -e '\e(0a\e(B'
  // The xterm output sometimes seems to conflict with the
  // reference above. xterm seems in line with the reference
  // when running vttest however.
  // The table below now uses xterm's output from vttest.
  Terminal.charsets.SCLD = { // (0
    '`': '\u25c6', // '◆'
    'a': '\u2592', // '▒'
    'b': '\u0009', // '\t'
    'c': '\u000c', // '\f'
    'd': '\u000d', // '\r'
    'e': '\u000a', // '\n'
    'f': '\u00b0', // '°'
    'g': '\u00b1', // '±'
    'h': '\u2424', // '\u2424' (NL)
    'i': '\u000b', // '\v'
    'j': '\u2518', // '┘'
    'k': '\u2510', // '┐'
    'l': '\u250c', // '┌'
    'm': '\u2514', // '└'
    'n': '\u253c', // '┼'
    'o': '\u23ba', // '⎺'
    'p': '\u23bb', // '⎻'
    'q': '\u2500', // '─'
    'r': '\u23bc', // '⎼'
    's': '\u23bd', // '⎽'
    't': '\u251c', // '├'
    'u': '\u2524', // '┤'
    'v': '\u2534', // '┴'
    'w': '\u252c', // '┬'
    'x': '\u2502', // '│'
    'y': '\u2264', // '≤'
    'z': '\u2265', // '≥'
    '{': '\u03c0', // 'π'
    '|': '\u2260', // '≠'
    '}': '\u00a3', // '£'
    '~': '\u00b7' // '·'
  };

  Terminal.charsets.UK = null; // (A
  Terminal.charsets.US = null; // (B (USASCII)
  Terminal.charsets.Dutch = null; // (4
  Terminal.charsets.Finnish = null; // (C or (5
  Terminal.charsets.French = null; // (R
  Terminal.charsets.FrenchCanadian = null; // (Q
  Terminal.charsets.German = null; // (K
  Terminal.charsets.Italian = null; // (Y
  Terminal.charsets.NorwegianDanish = null; // (E or (6
  Terminal.charsets.Spanish = null; // (Z
  Terminal.charsets.Swedish = null; // (H or (7
  Terminal.charsets.Swiss = null; // (=
  Terminal.charsets.ISOLatin = null; // /A

};
