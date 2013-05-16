'use strict';
/*jshint browser:true */

var term = require('../index')();
term.appendTo('#terminal');

var difflet = require('difflet')({
      indent : 2 
    , comma : 'first'
    , comment: true
    });

var diff = difflet.compare({ a : [1, 2, 3 ], c : 5 }, { a : [1, 2, 3, 4 ], b : 4 });
term.write(diff);

// starting out with just 10 rows, however if more are needed, they are added on demand
var termcode = require('../index')( { rows: 10 });
termcode.appendTo('#terminal-code');

[ '\u001b[92m\'use strict\'\u001b[39m\u001b[90m;\u001b[39m',
  '\u001b[90m/*jshint browser:true */\u001b[39m',
  '',
  '\u001b[32mvar\u001b[39m \u001b[37mTerminal\u001b[39m \u001b[93m=\u001b[39m \u001b[37mrequire\u001b[39m\u001b[90m(\u001b[39m\u001b[92m\'./term\'\u001b[39m\u001b[90m)\u001b[39m',
  '  \u001b[32m,\u001b[39m \u001b[37mthrough\u001b[39m \u001b[93m=\u001b[39m \u001b[37mrequire\u001b[39m\u001b[90m(\u001b[39m\u001b[92m\'through\'\u001b[39m\u001b[90m)\u001b[39m',
  '  \u001b[90m;\u001b[39m',
  '',
  '\u001b[37mmodule\u001b[39m\u001b[32m.\u001b[39m\u001b[37mexports\u001b[39m \u001b[93m=\u001b[39m \u001b[94mfunction\u001b[39m \u001b[90m(\u001b[39m\u001b[37mcols\u001b[39m\u001b[32m,\u001b[39m \u001b[37mrows\u001b[39m\u001b[32m,\u001b[39m \u001b[37mhandler\u001b[39m\u001b[90m)\u001b[39m \u001b[33m{\u001b[39m',
  '  \u001b[32mvar\u001b[39m \u001b[37mterm\u001b[39m \u001b[93m=\u001b[39m \u001b[31mnew\u001b[39m \u001b[37mTerminal\u001b[39m\u001b[90m(\u001b[39m\u001b[37mcols\u001b[39m\u001b[32m,\u001b[39m \u001b[37mrows\u001b[39m\u001b[32m,\u001b[39m \u001b[37mhandler\u001b[39m\u001b[90m)\u001b[39m\u001b[90m;\u001b[39m',
  '  \u001b[37mterm\u001b[39m\u001b[32m.\u001b[39m\u001b[37mopen\u001b[39m\u001b[90m(\u001b[39m\u001b[90m)\u001b[39m\u001b[90m;\u001b[39m',
  '  ',
  '  \u001b[32mvar\u001b[39m \u001b[37mhypernal\u001b[39m \u001b[93m=\u001b[39m \u001b[37mthrough\u001b[39m\u001b[90m(\u001b[39m\u001b[37mterm\u001b[39m\u001b[32m.\u001b[39m\u001b[37mwrite\u001b[39m\u001b[32m.\u001b[39m\u001b[37mbind\u001b[39m\u001b[90m(\u001b[39m\u001b[37mterm\u001b[39m\u001b[90m)\u001b[39m\u001b[90m)\u001b[39m\u001b[90m;\u001b[39m',
  '  \u001b[37mhypernal\u001b[39m\u001b[32m.\u001b[39m\u001b[37mappendTo\u001b[39m \u001b[93m=\u001b[39m \u001b[94mfunction\u001b[39m \u001b[90m(\u001b[39m\u001b[37melem\u001b[39m\u001b[90m)\u001b[39m \u001b[33m{\u001b[39m',
  '    \u001b[94mif\u001b[39m \u001b[90m(\u001b[39m\u001b[94mtypeof\u001b[39m \u001b[37melem\u001b[39m \u001b[93m===\u001b[39m \u001b[92m\'string\'\u001b[39m\u001b[90m)\u001b[39m \u001b[37melem\u001b[39m \u001b[93m=\u001b[39m \u001b[37mdocument\u001b[39m\u001b[32m.\u001b[39m\u001b[37mquerySelector\u001b[39m\u001b[90m(\u001b[39m\u001b[37melem\u001b[39m\u001b[90m)\u001b[39m\u001b[90m;\u001b[39m',
  '',
  '    \u001b[37melem\u001b[39m\u001b[32m.\u001b[39m\u001b[37mappendChild\u001b[39m\u001b[90m(\u001b[39m\u001b[37mterm\u001b[39m\u001b[32m.\u001b[39m\u001b[37melement\u001b[39m\u001b[90m)\u001b[39m\u001b[90m;\u001b[39m',
  '    \u001b[37mterm\u001b[39m\u001b[32m.\u001b[39m\u001b[37melement\u001b[39m\u001b[32m.\u001b[39m\u001b[37mstyle\u001b[39m\u001b[32m.\u001b[39m\u001b[37mposition\u001b[39m \u001b[93m=\u001b[39m \u001b[92m\'relative\'\u001b[39m\u001b[90m;\u001b[39m',
  '  \u001b[33m}\u001b[39m\u001b[90m;\u001b[39m',
  '',
  '  \u001b[37mhypernal\u001b[39m\u001b[32m.\u001b[39m\u001b[37mwriteln\u001b[39m \u001b[93m=\u001b[39m \u001b[94mfunction\u001b[39m \u001b[90m(\u001b[39m\u001b[37mline\u001b[39m\u001b[90m)\u001b[39m \u001b[33m{\u001b[39m',
  '    \u001b[37mterm\u001b[39m\u001b[32m.\u001b[39m\u001b[37mwriteln\u001b[39m\u001b[90m(\u001b[39m\u001b[37mline\u001b[39m\u001b[90m)\u001b[39m\u001b[90m;\u001b[39m',
  '  \u001b[33m}\u001b[39m\u001b[90m;\u001b[39m',
  '',
  '  \u001b[37mhypernal\u001b[39m\u001b[32m.\u001b[39m\u001b[37mwrite\u001b[39m \u001b[93m=\u001b[39m \u001b[37mterm\u001b[39m\u001b[32m.\u001b[39m\u001b[37mwrite\u001b[39m\u001b[32m.\u001b[39m\u001b[37mbind\u001b[39m\u001b[90m(\u001b[39m\u001b[37mterm\u001b[39m\u001b[90m)\u001b[39m\u001b[90m;\u001b[39m',
  '',
  '  \u001b[31mreturn\u001b[39m \u001b[37mhypernal\u001b[39m\u001b[90m;\u001b[39m',
  '\u001b[33m}\u001b[39m\u001b[90m;\u001b[39m',
  '' 
].forEach(function (line) { termcode.writeln(line); });

