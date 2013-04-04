'use strict';
/*jshint browser:true */

var term = require('../index')(100, 80);

term.appendTo('#terminal');
var lines =
  [ '\u001b[90m1: \u001b[39m\u001b[32mvar\u001b[39m \u001b[37ma\u001b[39m \u001b[93m=\u001b[39m \u001b[34m3\u001b[39m\u001b[90m;\u001b[39m',
    '\u001b[92m+\u001b[39m  a: \u001b[34m\u001b[1m3\u001b[0m',
    '',
    '\u001b[90m2: \u001b[39m',
    '\u001b[90m3: \u001b[39m\u001b[37ma\u001b[39m \u001b[93m=\u001b[39m \u001b[37ma\u001b[39m \u001b[93m+\u001b[39m \u001b[34m1\u001b[39m\u001b[90m;\u001b[39m',
    '\u001b[94m~\u001b[39m  a: \u001b[34m\u001b[1m4\u001b[0m',
    '\u001b[36m=>\u001b[39m \u001b[34m\u001b[1m4\u001b[0m',
    '',
    '\u001b[90m4: \u001b[39m\u001b[37ma\u001b[39m\u001b[93m++\u001b[39m\u001b[90m;\u001b[39m',
    '\u001b[94m~\u001b[39m  a: \u001b[34m\u001b[1m5\u001b[0m',
    '\u001b[36m=>\u001b[39m \u001b[34m\u001b[1m4\u001b[0m',
    '',
    '\u001b[90m5: \u001b[39m',
    '\u001b[90m6: \u001b[39m\u001b[32mvar\u001b[39m \u001b[37mb\u001b[39m \u001b[93m=\u001b[39m \u001b[34m2\u001b[39m\u001b[90m;\u001b[39m',
    '\u001b[92m+\u001b[39m  b: \u001b[34m\u001b[1m2\u001b[0m',
    '',
    '\u001b[90m7: \u001b[39m\u001b[37mb\u001b[39m \u001b[93m=\u001b[39m \u001b[37mb\u001b[39m \u001b[93m+\u001b[39m \u001b[37ma\u001b[39m\u001b[90m;\u001b[39m',
    '\u001b[94m~\u001b[39m  b: \u001b[34m\u001b[1m7\u001b[0m',
    '\u001b[36m=>\u001b[39m \u001b[34m\u001b[1m7\u001b[0m',
    ''
  ];

function write(term, lines) {
  lines.forEach(function (line) { term.writeln(line); });
}

function animate(term, lines) {
  lines
    .join('\r\n')
    .split('')
    .forEach(function (line, idx) { 
      setTimeout(function () { term.write(line); }, idx * 2);
    });
}

write(term, lines);
