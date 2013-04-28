'use strict';

var http         =  require('http')
  , ecstatic     =  require('ecstatic')
  , build        =  require('./build')
  , staticServer =  ecstatic({ root: __dirname, autoIndex: true });

http.createServer(function (req, res) {
  console.log('%s  %s', req.method, req.url);
  return req.url === '/bundle.js' ? serveBundle(req, res) : staticServer(req, res);
}).listen(3000);

console.log('Listening: http://localhost:3000');

function serveBundle(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  build().pipe(res);
}
