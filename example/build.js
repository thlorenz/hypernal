'use strict';

require('browserify')()
  .require(require.resolve('./main.js'), { entry: true })
  .bundle({ debug: true })
  .pipe(require('fs').createWriteStream(__dirname + '/bundle.js'), 'utf-8');

