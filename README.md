# hypernal

Renders terminal output as html to simplify reusing server side modules in the browser.

## Example

**main.js**
```js
var term = require('hypernal')();
term.appendTo('#terminal');

var difflet = require('difflet')({
      indent : 2 
    , comma : 'first'
    , comment: true
    });

var diff = difflet.compare({ a : [1, 2, 3 ], c : 5 }, { a : [1, 2, 3, 4 ], b : 4 });
term.write(diff);
```

**browserify-build.js**
```js
require('browserify')()
  .require(require.resolve('./main.js'), { entry: true })
  .bundle()
  .pipe(require('fs').createWriteStream(__dirname + '/bundle.js'), 'utf-8');
```

**index.html**
```html
<body>
  <div id="terminal"></div>
  <script type="text/javascript" src="./bundle.js"></script>
</body>
```

**index.css**
```css
#terminal {
  width         :  600px;
  height        :  400px;
  background    :  black;
  padding       :  15px 20px 15px 20px;
  border-radius :  15px;
  border        :  2px solid #CEE1F0;
  font-family   :  Monaco;
  font-size     :  16px;
}
```

![difflet.png](https://github.com/thlorenz/hypernal/raw/master/assets/difflet.png)

View [more complete example](http://thlorenz.github.com/hypernal/) and its [source](https://github.com/thlorenz/hypernal/tree/master/example)

## Installation

    npm install hypernal

## Demo

    npm explore hypernal && npm run demo

## API

***hypernal(options:Object)***

creates a **render only** terminal and returns an interface to interact with it as described below.

**options**:
- allow overriding `{ cols: Number, rows: Number }` of the terminal, which generally is not necessary
**Note:**
  - number of cols will be applied to any row
  - number of rows will indicate how many rows to add initially, but more will be added if needed

***term.tail:Boolean***

- when set to true, the terminal will automatically scroll to the bottom when more lines are added than fit in its
  container

***term.appendTo(elem:String|Object)***

appends the terminal to the given DOM element.

***term.write(s:String)***

writes the given string to the terminal.

***term.writeln(s:String)***

writes the given string to the terminal and adds a line break.

***term.reset()***

clears the terminal

## Kudos

hypernal is basically a trimmed down version of [tty.js](https://github.com/chjj/tty.js/) focused on and improved for rendering only.
