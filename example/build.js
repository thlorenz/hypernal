'use strict';

require('browserify')()
  .require(require.resolve('./main.js'))
  .bundle()
  .pipe(require('fs').createWriteStream(__dirname + '/bundle.js'), 'utf-8');

