'use strict'

var cp = require('child_process')
var dgram = require('dgram')
var gulp = require('gulp')
var gulpfile = require('../../gulpfile')
var net = require('../../lib/net')
var path = require('path')

var turnAddr = process.env.TURN_ADDR
var turnPort = process.env.TURN_PORT
var turnUser = process.env.TURN_USER
var turnPwd = process.env.TURN_PASS
var registrar = process.env.ONETP_REGISTRAR

var modules = {
  'dgram': 'chrome-dgram',
  'net': 'chrome-net',
  'winston-debug': 'winston-browser',
  'wrtc': false
}

describe('net api', function () {
  this.timeout(160000)

  it('should establish connection with 1tp client in cordova app', function (done) {
    var child
    var onetpServerAddress
    // create 1tp server
    var server = net.createServer(function (connection) {
      console.log('connection established')
      connection.on('data', function (data) {
        console.log('received message ' + data)
        switch (data.toString()) {
          case 'hello':
            connection.write('world')
            break
          case 'done':
            child.kill()
            done()
            break
          default:
            var errorMsg = "don't know how to process message " + data
            done(errorMsg)
        }
      })
    })
    // start 1tp server
    server.listen(function () {
      onetpServerAddress = server.address()
      console.log('1tp server listening at ' + JSON.stringify(onetpServerAddress))
      // start gulp task
      gulp.start('build-cordova-client')
    })
    // build bundle.js
    gulp.task('build-cordova-client', function () {
      var destFile = 'bundle.js'
      var destFolder = './cordova-app/www/js'
      var entry = './client.js'
      var env = {
        onetpServerAddress: onetpServerAddress,
        turnAddr: turnAddr,
        turnPort: turnPort,
        turnUser: turnUser,
        turnPwd: turnPwd,
        registrar: registrar
      }
      return gulpfile
        .bundle(entry, modules, destFile, destFolder, true, env)
        .on('end', onBundleReady)
        .on('error', function (error) {
          console.error(error)
          done(error)
        })
    })
    // launch chrome app
    function onBundleReady () {
      console.log('clean browserify build, launching cordova emulator -- please wait a few seconds')
      var options = {
        cwd: path.join(__dirname, './cordova-app'),
        maxBuffer: 1000 * 1024
      }
      child = cp.exec(path.join(__dirname, './cordova-app', 'start.sh'), options, function (error, stdout, stderr) {
        if (error) {
          console.error(error)
          done(error)
        }
      // console.log(stdout)
      })
    }
  })
})
