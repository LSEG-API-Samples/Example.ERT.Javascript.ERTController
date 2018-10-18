// Simple access point when Browserifying pako.  To build self-contained
//
// > browserify pako.js --s zlib -o zlib.js
//
// Within HTML:
//
//      <script type="text/javascript" src="zlib.js"></script>
//
// Within Javascript
//
//      var data = zlib.pako.inflate(binData);
//
this.pako = require('pako');
