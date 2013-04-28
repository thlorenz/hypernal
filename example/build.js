'use strict';

var build = module.exports = function () {
  return require('browserify')()
    .require(require.resolve('./main.js'), { entry: true })
    .bundle({ debug: true })
    .pipe(require('mold-source-map').transformSourcesRelativeTo(__dirname + '/../'));
};

if (!module.parent)
  build().pipe(require('fs').createWriteStream(__dirname + '/bundle.js'), 'utf-8');

