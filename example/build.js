'use strict';
var path = require('path');

require('browserify')()
  .require(require.resolve('./main.js'), { entry: true })
  .bundle({ debug: true })
  .pipe(require('mold-source-map').transformSourcesRelativeTo(path.join(__dirname, '..')))
  .pipe(require('fs').createWriteStream(__dirname + '/bundle.js'), 'utf-8');

