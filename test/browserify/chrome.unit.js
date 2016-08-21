'use strict'

var helper = require('./helper')
var net = require('../../lib/net')

var onetpTransports = require('../../lib/transports')
var TcpTransport = onetpTransports.tcp
var UdpTransport = onetpTransports.udp
var TurnTransport = onetpTransports.turn
var TurnProtocols = require('turn-js').transports
var WebSocketSignaling = require('../../lib/signaling').websocket

var turnAddr = process.env.TURN_ADDR
var turnPort = process.env.TURN_PORT
var turnUser = process.env.TURN_USER
var turnPwd = process.env.TURN_PASS
var registrar = process.env.ONETP_REGISTRAR

describe('net api', function () {
  this.timeout(10000)

  // it('should establish connection with 1tp client in chrome app', function (done) {
  //   var child
  //   // start chrome app
  //   var launchChrome = function (serverInfo) {
  //     var env = {
  //       serverInfo: serverInfo,
  //       turnAddr: turnAddr,
  //       turnPort: turnPort,
  //       turnUser: turnUser,
  //       turnPwd: turnPwd,
  //       registrar: registrar
  //     }
  //     helper.browserify('chrome-app/client.js', env, function (error) {
  //       if (error) {
  //         done(error)
  //       }
  //       console.log('clean browserify build')
  //       child = helper.launchBrowser()
  //     })
  //   }
  //   // create 1tp server
  //   var transports = []
  //   transports.push(new UdpTransport())
  //   transports.push(new TcpTransport())
  //   transports.push(
  //     new TurnTransport({
  //       turnServer: turnAddr,
  //       turnPort: turnPort,
  //       turnProtocol: new TurnProtocols.TCP(),
  //       turnUsername: turnUser,
  //       turnPassword: turnPwd,
  //       signaling: new WebSocketSignaling({
  //         url: registrar
  //       })
  //     })
  //   )
  //   var server = net.createServer(transports, function (connection) {
  //     console.log('connection established')
  //     connection.on('data', function (data) {
  //       console.log('received message ' + data)
  //       switch (data.toString()) {
  //         case 'hello':
  //           connection.write('world')
  //           break
  //         case 'done':
  //           child.kill()
  //           done()
  //           break
  //         default:
  //           var errorMsg = "don't know how to process message " + data
  //           done(errorMsg)
  //       }
  //     })
  //   })
  //   server.listen(function () {
  //     launchChrome(server.address())
  //   })
  // })

  it('should launch 1tp server in chrome app and verify server address', function (done) {
    var child
    // start chrome app
    var launchChrome = function () {
      var env = {
        turnAddr: turnAddr,
        turnPort: turnPort,
        turnUser: turnUser,
        turnPwd: turnPwd,
        registrar: registrar
      }
      helper.browserify('chrome-app/server.js', env, function (error) {
        if (error) {
          done(error)
        }
        console.log('clean browserify build')
        child = helper.launchBrowser()
      })
    }
    // create 1tp server
    var transports = []
    transports.push(new UdpTransport())
    transports.push(new TcpTransport())
    transports.push(
      new TurnTransport({
        turnServer: turnAddr,
        turnPort: turnPort,
        turnProtocol: new TurnProtocols.TCP(),
        turnUsername: turnUser,
        turnPassword: turnPwd,
        signaling: new WebSocketSignaling({
          url: registrar
        })
      })
    )
    launchChrome()
  })
})
