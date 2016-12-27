'use strict'

var net = require('../index').net
var Server = net.Server
var Socket = net.Socket

var onetpTransports = require('../lib/transports')
var TcpTransport = onetpTransports.tcp
var TurnTransport = onetpTransports.turn
var UdpTransport = onetpTransports.udp
var WebRtcTransport = onetpTransports.webrtc
var TurnProtocols = require('turn-js').transports

var WebSocketSignaling = require('../lib/signaling/out-of-band').websocket

var chai = require('chai')
var expect = chai.expect

var defaultProtocolVersion = require('../package.json').version

var turnAddr = process.env.TURN_ADDR
var turnPort = process.env.TURN_PORT
var turnUser = process.env.TURN_USER
var turnPwd = process.env.TURN_PASS
var registrar = process.env.ONETP_REGISTRAR

if (!turnAddr) {
  throw new Error('TURN_ADDR undefined -- giving up')
}
if (!turnPort) {
  throw new Error('TURN_PORT undefined -- giving up')
}
if (!turnUser) {
  throw new Error('TURN_USER undefined -- giving up')
}
if (!turnPwd) {
  throw new Error('TURN_PASS undefined -- giving up')
}
if (!registrar) {
  throw new Error('ONETP_REGISTRAR undefined -- giving up')
}

describe('net api + parallel scheduler', function () {
  this.timeout(20000)

  it('should establish a connection between two UDP sockets and exchange a test message', function (done) {
    var client, server
    var testMessage = 'test'

    var localUdpServerInfo = [{
      transportType: 'udp',
      transportInfo: {
        address: '127.0.0.1',
        port: 40010
      }
    }]

    var createServer = function () {
      var transports = []
      transports.push(new UdpTransport())
      server = net.createServer(transports, function (connection) {
        expect(connection).to.not.be.undefined
        expect(connection.isConnected()).to.be.true
        expect(connection.remoteAddress).to.not.be.undefined
        connection.on('data', function (data) {
          expect(data.toString()).to.equal(testMessage)
          var openServerSessions = 0
          setTimeout(function() {
            server._transports.forEach(function (transport) {
              if (transport._sessions !== undefined) {
                openServerSessions += Object.keys(transport._sessions).length
              }
            })
            expect(openServerSessions).to.equal(1)
            done()
          }, client._connectTimeout() + 250)
        })
      })
      return server
    }

    var launchServer = function (serverInfo, onReady) {
      server.listen(serverInfo, function () {
        onReady()
      })
    }

    var createClient = function (serverInfo) {
      var transports = []
      transports.push(new UdpTransport())
      var args = {
        parallelConnectionSetup: true
      }
      client = net.createConnection(serverInfo, transports, args, function () {
        expect(client.isConnected()).to.be.true
        expect(client.remoteAddress).to.not.be.undefined
        var openClientSessions = 0
        client._transports.forEach(function (transport) {
          if (transport._sessions !== undefined) {
            openClientSessions += Object.keys(transport._sessions).length
          }
        })
        expect(openClientSessions).to.equal(1)
        client.write(testMessage)
      })
      expect(client.isConnected()).to.be.false
    }

    server = createServer()
    launchServer(localUdpServerInfo, function () {
      createClient(localUdpServerInfo)
    })
  })

  it('should establish a connection between two 1tp sockets (using default transports) and exchange a test message', function (done) {
    var client, server
    var testMessage = 'test'

    var openClientSessions = 0
    var openServerSessions = 0

    var createServer = function () {
      server = new Server(function (connection) {
        expect(connection).to.not.be.undefined
        expect(connection.isConnected()).to.be.true
        expect(connection.remoteAddress).to.not.be.undefined
        connection.on('data', function (data) {
          expect(data.toString()).to.equal(testMessage)
          setTimeout(function() {
            // check if all server sessions have closed
            server._transports.forEach(function (transport) {
              if (transport._sessions !== undefined) {
                openServerSessions += Object.keys(transport._sessions).length
              }
            })
            // TcpTransport does not track ongoing sessions
            if (connection.remoteAddress[0].transportType === 'tcp') {
              openServerSessions += 1
            }
            expect(openServerSessions).to.equal(1)
            // done
            done()
          }, client._connectTimeout() + 250)
        })
      })
      return server
    }

    var launchServer = function (onReady) {
      server.listen(function () {
        onReady(server.address())
      })
    }

    var createClient = function (connectionInfo) {
      var args = {
        parallelConnectionSetup: true
      }
      client = new Socket(args)
      client.connect(connectionInfo, function () {
        // verify if client is connected
        expect(client.isConnected()).to.be.true
        expect(client.remoteAddress).to.not.be.undefined
        // check if all 'other' client sessions have closed
        client._transports.forEach(function (transport) {
          if (transport._sessions !== undefined) {
            openClientSessions += Object.keys(transport._sessions).length
          }
        })
        // TcpTransport does not track ongoing sessions
        if (client.remoteAddress[0].transportType === 'tcp') {
          openClientSessions += 1
        }
        expect(openClientSessions).to.equal(1)
        // send test message
        client.write(testMessage)
      })
      expect(client.isConnected()).to.be.false
    }

    server = createServer()
    launchServer(function (connectionInfo) {
      createClient(connectionInfo)
    })
  })

  // it('should run server listening to TCP socket + client tries connecting over TCP and UDP', function (done) {
  //   var client, server
  //   var testMessage = 'test'
  //
  //   var createServer = function () {
  //     var transports = []
  //     transports.push(new TcpTransport())
  //     var server = net.createServer(transports, function (connection) {
  //       expect(connection).to.not.be.undefined
  //       expect(connection.isConnected()).to.be.true
  //       expect(connection.remoteAddress).to.not.be.undefined
  //       connection.on('data', function (data) {
  //         expect(data.toString()).to.equal(testMessage)
  //         done()
  //       })
  //     })
  //     return server
  //   }
  //
  //   var launchServer = function (serverInfo, onReady) {
  //     server.listen(serverInfo, function () {
  //       onReady()
  //     })
  //   }
  //
  //   var createClient = function (serverInfo) {
  //     client = net.createConnection(serverInfo, function () {
  //       expect(client.isConnected()).to.be.true
  //       expect(client.remoteAddress).to.not.be.undefined
  //       client.write(testMessage)
  //     })
  //     expect(client.isConnected()).to.be.false
  //   }
  //
  //   var serverInfo = [{
  //     transportType: 'tcp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30011
  //     }
  //   }]
  //   var connectionInfo = [{
  //     transportType: 'tcp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30011
  //     }
  //   }, {
  //     transportType: 'udp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30012
  //     }
  //   }]
  //
  //   server = createServer()
  //   launchServer(serverInfo, function () {
  //     createClient(connectionInfo)
  //   })
  // })
  //
  // it('should run server listening to TCP socket + client tries connecting over UDP and TCP', function (done) {
  //   var client, server
  //   var testMessage = 'test'
  //
  //   var createServer = function () {
  //     var transports = []
  //     transports.push(new TcpTransport())
  //     var server = net.createServer(transports, function (connection) {
  //       expect(connection).to.not.be.undefined
  //       expect(connection.isConnected()).to.be.true
  //       expect(connection.remoteAddress).to.not.be.undefined
  //       connection.on('data', function (data) {
  //         expect(data.toString()).to.equal(testMessage)
  //         done()
  //       })
  //     })
  //     return server
  //   }
  //
  //   var launchServer = function (serverInfo, onReady) {
  //     server.listen(serverInfo, function () {
  //       onReady()
  //     })
  //   }
  //
  //   var createClient = function (serverInfo) {
  //     var transports = []
  //     transports.push(new UdpTransport())
  //     transports.push(new TcpTransport())
  //     client = net.createConnection(serverInfo, transports, function () {
  //       expect(client.isConnected()).to.be.true
  //       expect(client.remoteAddress).to.not.be.undefined
  //       client.write(testMessage)
  //     })
  //     expect(client.isConnected()).to.be.false
  //   }
  //
  //   var serverInfo = [{
  //     transportType: 'tcp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30013
  //     }
  //   }]
  //   var connectionInfo = [{
  //     transportType: 'udp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30014
  //     }
  //   }, {
  //     transportType: 'tcp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30013
  //     }
  //   }]
  //
  //   server = createServer()
  //   launchServer(serverInfo, function () {
  //     createClient(connectionInfo)
  //   })
  // })
  //
  // it('should run server listening to UDP socket + client tries connecting over UDP and TCP', function (done) {
  //   var client, server
  //   var testMessage = 'test'
  //
  //   var createServer = function () {
  //     var transports = []
  //     transports.push(new UdpTransport())
  //     var server = net.createServer(transports, function (connection) {
  //       expect(connection).to.not.be.undefined
  //       expect(connection.isConnected()).to.be.true
  //       expect(connection.remoteAddress).to.not.be.undefined
  //       connection.on('data', function (data) {
  //         expect(data.toString()).to.equal(testMessage)
  //         done()
  //       })
  //     })
  //     return server
  //   }
  //
  //   var launchServer = function (serverInfo, onReady) {
  //     server.listen(serverInfo, function () {
  //       onReady()
  //     })
  //   }
  //
  //   var createClient = function (serverInfo) {
  //     client = net.createConnection(serverInfo, function () {
  //       expect(client.isConnected()).to.be.true
  //       expect(client.remoteAddress).to.not.be.undefined
  //       client.write(testMessage)
  //     })
  //     expect(client.isConnected()).to.be.false
  //   }
  //
  //   var serverInfo = [{
  //     transportType: 'udp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30015
  //     }
  //   }]
  //   var connectionInfo = [{
  //     transportType: 'udp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30015
  //     }
  //   }, {
  //     transportType: 'tcp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30016
  //     }
  //   }]
  //
  //   server = createServer()
  //   launchServer(serverInfo, function () {
  //     createClient(connectionInfo)
  //   })
  // })
  //
  // it('should run server listening to UDP socket + client tries connecting over TCP and UDP', function (done) {
  //   var client, server
  //   var testMessage = 'test'
  //
  //   var createServer = function () {
  //     var transports = []
  //     transports.push(new UdpTransport())
  //     var server = net.createServer(transports, function (connection) {
  //       expect(connection).to.not.be.undefined
  //       expect(connection.isConnected()).to.be.true
  //       expect(connection.remoteAddress).to.not.be.undefined
  //       connection.on('data', function (data) {
  //         expect(data.toString()).to.equal(testMessage)
  //         done()
  //       })
  //     })
  //     return server
  //   }
  //
  //   var launchServer = function (serverInfo, onReady) {
  //     server.listen(serverInfo, function () {
  //       onReady()
  //     })
  //   }
  //
  //   var createClient = function (serverInfo) {
  //     var transports = []
  //     transports.push(new TcpTransport())
  //     transports.push(new UdpTransport())
  //     client = net.createConnection(serverInfo, transports, function () {
  //       expect(client.isConnected()).to.be.true
  //       expect(client.remoteAddress).to.not.be.undefined
  //       client.write(testMessage)
  //     })
  //     expect(client.isConnected()).to.be.false
  //   }
  //
  //   var serverInfo = [{
  //     transportType: 'udp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30016
  //     }
  //   }]
  //   var connectionInfo = [{
  //     transportType: 'tcp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30017
  //     }
  //   }, {
  //     transportType: 'udp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30016
  //     }
  //   }]
  //
  //   server = createServer()
  //   launchServer(serverInfo, function () {
  //     createClient(connectionInfo)
  //   })
  // })
  //
  // it('should run server listening to UDP socket + client tries connecting over TCP', function (done) {
  //   var client, server
  //   var testMessage = 'test'
  //
  //   var createServer = function () {
  //     var transports = []
  //     transports.push(new UdpTransport())
  //     var server = net.createServer(transports, function (connection) {
  //       var errorMsg = 'not expecting to receive a connection event'
  //       done(errorMsg)
  //     })
  //     return server
  //   }
  //
  //   var launchServer = function (serverInfo, onReady) {
  //     server.listen(serverInfo, function () {
  //       onReady()
  //     })
  //   }
  //
  //   var createClient = function (serverInfo) {
  //     var transports = []
  //     transports.push(new TcpTransport())
  //     client = net.createConnection(serverInfo, transports, function () {
  //       var errorMsg = 'not expecting to receive a connection event'
  //       done(errorMsg)
  //     })
  //     client.on('error', function (error) {
  //       done()
  //     })
  //   }
  //
  //   var serverInfo = [{
  //     transportType: 'udp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30018
  //     }
  //   }]
  //   var connectionInfo = [{
  //     transportType: 'tcp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30018
  //     }
  //   }]
  //
  //   server = createServer()
  //   launchServer(serverInfo, function () {
  //     createClient(connectionInfo)
  //   })
  // })
  //
  // it('should run server listening to TCP socket + client tries connecting over UDP and TCP using incorrect connectInfo', function (done) {
  //   var client, server
  //   var testMessage = 'test'
  //
  //   var createServer = function () {
  //     var transports = []
  //     transports.push(new UdpTransport())
  //     var server = net.createServer(transports, function (connection) {
  //       var errorMsg = 'not expecting to receive a connection event'
  //       done(errorMsg)
  //     })
  //     return server
  //   }
  //
  //   var launchServer = function (serverInfo, onReady) {
  //     server.listen(serverInfo, function () {
  //       onReady()
  //     })
  //   }
  //
  //   var createClient = function (serverInfo) {
  //     client = net.createConnection(serverInfo, function () {
  //       var errorMsg = 'not expecting to receive a connection event'
  //       done(errorMsg)
  //     })
  //     client.on('error', function (error) {
  //       done()
  //     })
  //   }
  //
  //   var serverInfo = [{
  //     transportType: 'udp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30019
  //     }
  //   }]
  //   var connectionInfo = [{
  //     transportType: 'udp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30020
  //     }
  //   }, {
  //     transportType: 'tcp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30020
  //     }
  //   }]
  //
  //   server = createServer()
  //   launchServer(serverInfo, function () {
  //     createClient(connectionInfo)
  //   })
  // })
  //
  // it('should run server listening to UDP socket + client tries connecting to two different UDP endpoints', function (done) {
  //   var client, server
  //   var testMessage = 'test'
  //
  //   var createServer = function () {
  //     var transports = []
  //     transports.push(new UdpTransport())
  //     var server = net.createServer(transports, function (connection) {
  //       expect(connection).to.not.be.undefined
  //       expect(connection.isConnected()).to.be.true
  //       expect(connection.remoteAddress).to.not.be.undefined
  //       connection.on('data', function (data) {
  //         expect(data.toString()).to.equal(testMessage)
  //         done()
  //       })
  //     })
  //     return server
  //   }
  //
  //   var launchServer = function (serverInfo, onReady) {
  //     server.listen(serverInfo, function () {
  //       onReady()
  //     })
  //   }
  //
  //   var createClient = function (serverInfo) {
  //     var transports = []
  //     transports.push(new UdpTransport())
  //     client = net.createConnection(serverInfo, transports, function () {
  //       expect(client.isConnected()).to.be.true
  //       expect(client.remoteAddress).to.not.be.undefined
  //       client.write(testMessage)
  //     })
  //     expect(client.isConnected()).to.be.false
  //   }
  //
  //   var serverInfo = [{
  //     transportType: 'udp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30021
  //     }
  //   }]
  //   var connectionInfo = [{
  //     transportType: 'udp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30022
  //     }
  //   }, {
  //     transportType: 'udp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30021
  //     }
  //   }]
  //
  //   server = createServer()
  //   launchServer(serverInfo, function () {
  //     createClient(connectionInfo)
  //   })
  // })
  //
  // it('should run server listening to TCP socket + client tries connecting to two different TCP endpoints', function (done) {
  //   var client, server
  //   var testMessage = 'test'
  //
  //   var createServer = function () {
  //     var transports = []
  //     transports.push(new TcpTransport())
  //     var server = net.createServer(transports, function (connection) {
  //       expect(connection).to.not.be.undefined
  //       expect(connection.isConnected()).to.be.true
  //       expect(connection.remoteAddress).to.not.be.undefined
  //       connection.on('data', function (data) {
  //         expect(data.toString()).to.equal(testMessage)
  //         done()
  //       })
  //     })
  //     return server
  //   }
  //
  //   var launchServer = function (serverInfo, onReady) {
  //     server.listen(serverInfo, function () {
  //       onReady()
  //     })
  //   }
  //
  //   var createClient = function (serverInfo) {
  //     var transports = []
  //     transports.push(new TcpTransport())
  //     client = net.createConnection(serverInfo, transports, function () {
  //       expect(client.isConnected()).to.be.true
  //       expect(client.remoteAddress).to.not.be.undefined
  //       client.write(testMessage)
  //     })
  //     expect(client.isConnected()).to.be.false
  //   }
  //
  //   var serverInfo = [{
  //     transportType: 'tcp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30023
  //     }
  //   }]
  //   var connectionInfo = [{
  //     transportType: 'tcp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30024
  //     }
  //   }, {
  //     transportType: 'tcp',
  //     transportInfo: {
  //       address: '127.0.0.1',
  //       port: 30023
  //     }
  //   }]
  //
  //   server = createServer()
  //   launchServer(serverInfo, function () {
  //     createClient(connectionInfo)
  //   })
  // })
  //
  // it('should correctly close server socket after UdpSession was established -- case 1', function (done) {
  //   var client, server
  //   var testMessage = 'test'
  //
  //   var createServer = function () {
  //     var transports = []
  //     transports.push(new UdpTransport())
  //     transports.push(new TcpTransport())
  //     transports.push(
  //       new TurnTransport({
  //         turnServer: turnAddr,
  //         turnPort: turnPort,
  //         turnProtocol: new TurnProtocols.TCP(),
  //         turnUsername: turnUser,
  //         turnPassword: turnPwd,
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     transports.push(
  //       new WebRtcTransport({
  //         config: {
  //           iceServers: [ { url: 'stun:23.21.150.121' } ]
  //         },
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     var server = net.createServer(transports, function (connection) {
  //       expect(connection).to.not.be.undefined
  //       expect(connection.isConnected()).to.be.true
  //       expect(connection.remoteAddress).to.not.be.undefined
  //       var udpTransport = server._transports[0]
  //       var tcpTransport = server._transports[1]
  //       var turnTransport = server._transports[2]
  //       var webRtcTransport = server._transports[3]
  //       // test if UdpSession is established
  //       expect(Object.keys(udpTransport._sessions).length).to.equal(1)
  //       expect(Object.keys(tcpTransport._connectingSockets).length).to.equal(0)
  //       expect(Object.keys(turnTransport._sessions).length).to.equal(0)
  //       expect(Object.keys(webRtcTransport._sessions).length).to.equal(0)
  //       server.closeP()
  //         .then(function () {
  //           // test if UdpSession is closed
  //           expect(Object.keys(udpTransport._sessions).length).to.equal(0)
  //           expect(Object.keys(tcpTransport._connectingSockets).length).to.equal(0)
  //           expect(Object.keys(turnTransport._sessions).length).to.equal(0)
  //           expect(Object.keys(webRtcTransport._sessions).length).to.equal(0)
  //           done()
  //         })
  //         .catch(function (error) {
  //           done(error)
  //         })
  //       connection.on('data', function (data) {
  //         expect(data.toString()).to.equal(testMessage)
  //         connection.destroy()
  //       })
  //     })
  //     return server
  //   }
  //
  //   var launchServer = function (onReady) {
  //     server.listen(function () {
  //       onReady()
  //     })
  //   }
  //
  //   var createClient = function (serverInfo) {
  //     var transports = []
  //     transports.push(new UdpTransport())
  //     transports.push(new TcpTransport())
  //     transports.push(
  //       new TurnTransport({
  //         turnServer: turnAddr,
  //         turnPort: turnPort,
  //         turnProtocol: new TurnProtocols.TCP(),
  //         turnUsername: turnUser,
  //         turnPassword: turnPwd,
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     transports.push(
  //       new WebRtcTransport({
  //         config: {
  //           iceServers: [ { url: 'stun:23.21.150.121' } ]
  //         },
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     client = net.createConnection(serverInfo, transports, function () {
  //       expect(client.isConnected()).to.be.true
  //       expect(client.remoteAddress).to.not.be.undefined
  //       client.write(testMessage)
  //     })
  //     expect(client.isConnected()).to.be.false
  //   }
  //
  //   server = createServer()
  //   launchServer(function () {
  //     createClient(server.address())
  //   })
  // })
  //
  // it('should correctly close server socket after TcpSession was established', function (done) {
  //   var client, server
  //   var testMessage = 'test'
  //
  //   var createServer = function () {
  //     var transports = []
  //     transports.push(new TcpTransport())
  //     transports.push(
  //       new TurnTransport({
  //         turnServer: turnAddr,
  //         turnPort: turnPort,
  //         turnProtocol: new TurnProtocols.TCP(),
  //         turnUsername: turnUser,
  //         turnPassword: turnPwd,
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     transports.push(
  //       new WebRtcTransport({
  //         config: {
  //           iceServers: [ { url: 'stun:23.21.150.121' } ]
  //         },
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     transports.push(new UdpTransport())
  //     var server = net.createServer(transports, function (connection) {
  //       expect(connection).to.not.be.undefined
  //       expect(connection.isConnected()).to.be.true
  //       expect(connection.remoteAddress).to.not.be.undefined
  //       var tcpTransport = server._transports[0]
  //       var turnTransport = server._transports[1]
  //       var webRtcTransport = server._transports[2]
  //       var udpTransport = server._transports[3]
  //       // test if no other sessions are established (TcpTransport doesn't keep track of open TCP sessions)
  //       expect(Object.keys(udpTransport._sessions).length).to.equal(0)
  //       expect(Object.keys(tcpTransport._connectingSockets).length).to.equal(0)
  //       expect(Object.keys(turnTransport._sessions).length).to.equal(0)
  //       expect(Object.keys(webRtcTransport._sessions).length).to.equal(0)
  //       server.closeP()
  //         .then(function () {
  //           // test if all sessions are closed
  //           expect(Object.keys(udpTransport._sessions).length).to.equal(0)
  //           expect(Object.keys(tcpTransport._connectingSockets).length).to.equal(0)
  //           expect(Object.keys(turnTransport._sessions).length).to.equal(0)
  //           expect(Object.keys(webRtcTransport._sessions).length).to.equal(0)
  //           done()
  //         })
  //         .catch(function (error) {
  //           done(error)
  //         })
  //       connection.on('data', function (data) {
  //         expect(data.toString()).to.equal(testMessage)
  //         connection.destroy()
  //       })
  //     })
  //     return server
  //   }
  //
  //   var launchServer = function (onReady) {
  //     server.listen(function () {
  //       onReady()
  //     })
  //   }
  //
  //   var createClient = function (serverInfo) {
  //     var transports = []
  //     transports.push(new TcpTransport())
  //     transports.push(
  //       new TurnTransport({
  //         turnServer: turnAddr,
  //         turnPort: turnPort,
  //         turnProtocol: new TurnProtocols.TCP(),
  //         turnUsername: turnUser,
  //         turnPassword: turnPwd,
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     transports.push(
  //       new WebRtcTransport({
  //         config: {
  //           iceServers: [ { url: 'stun:23.21.150.121' } ]
  //         },
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     transports.push(new UdpTransport())
  //     client = net.createConnection(serverInfo, transports, function () {
  //       expect(client.isConnected()).to.be.true
  //       expect(client.remoteAddress).to.not.be.undefined
  //       client.write(testMessage)
  //     })
  //     expect(client.isConnected()).to.be.false
  //   }
  //
  //   server = createServer()
  //   launchServer(function () {
  //     createClient(server.address())
  //   })
  // })
  //
  // it('should correctly close server socket after TurnSession was established', function (done) {
  //   var client, server
  //   var testMessage = 'test'
  //
  //   var createServer = function () {
  //     var transports = []
  //     transports.push(
  //       new TurnTransport({
  //         turnServer: turnAddr,
  //         turnPort: turnPort,
  //         turnProtocol: new TurnProtocols.TCP(),
  //         turnUsername: turnUser,
  //         turnPassword: turnPwd,
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     transports.push(
  //       new WebRtcTransport({
  //         config: {
  //           iceServers: [ { url: 'stun:23.21.150.121' } ]
  //         },
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     transports.push(new UdpTransport())
  //     transports.push(new TcpTransport())
  //     var server = net.createServer(transports, function (connection) {
  //       expect(connection).to.not.be.undefined
  //       expect(connection.isConnected()).to.be.true
  //       expect(connection.remoteAddress).to.not.be.undefined
  //       var turnTransport = server._transports[0]
  //       var webRtcTransport = server._transports[1]
  //       var udpTransport = server._transports[2]
  //       var tcpTransport = server._transports[3]
  //       // test if TurnSession is established
  //       expect(Object.keys(udpTransport._sessions).length).to.equal(0)
  //       expect(Object.keys(tcpTransport._connectingSockets).length).to.equal(0)
  //       expect(Object.keys(turnTransport._sessions).length).to.equal(1)
  //       expect(Object.keys(webRtcTransport._sessions).length).to.equal(0)
  //       server.closeP()
  //         .then(function () {
  //           // test if TurnSession is closed
  //           expect(Object.keys(udpTransport._sessions).length).to.equal(0)
  //           expect(Object.keys(tcpTransport._connectingSockets).length).to.equal(0)
  //           expect(Object.keys(turnTransport._sessions).length).to.equal(0)
  //           expect(Object.keys(webRtcTransport._sessions).length).to.equal(0)
  //           done()
  //         })
  //         .catch(function (error) {
  //           done(error)
  //         })
  //       connection.on('data', function (data) {
  //         expect(data.toString()).to.equal(testMessage)
  //         connection.destroy()
  //       })
  //     })
  //     return server
  //   }
  //
  //   var launchServer = function (onReady) {
  //     server.listen(function () {
  //       onReady()
  //     })
  //   }
  //
  //   var createClient = function (serverInfo) {
  //     var transports = []
  //     transports.push(
  //       new TurnTransport({
  //         turnServer: turnAddr,
  //         turnPort: turnPort,
  //         turnProtocol: new TurnProtocols.TCP(),
  //         turnUsername: turnUser,
  //         turnPassword: turnPwd,
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     transports.push(
  //       new WebRtcTransport({
  //         config: {
  //           iceServers: [ { url: 'stun:23.21.150.121' } ]
  //         },
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     transports.push(new UdpTransport())
  //     transports.push(new TcpTransport())
  //     client = net.createConnection(serverInfo, transports, function () {
  //       expect(client.isConnected()).to.be.true
  //       expect(client.remoteAddress).to.not.be.undefined
  //       client.write(testMessage)
  //     })
  //     expect(client.isConnected()).to.be.false
  //   }
  //
  //   server = createServer()
  //   launchServer(function () {
  //     createClient(server.address())
  //   })
  // })
  //
  // it('should correctly close server socket after WebRtcSession was established', function (done) {
  //   var client, server
  //   var testMessage = 'test'
  //
  //   var createServer = function () {
  //     var transports = []
  //     transports.push(
  //       new WebRtcTransport({
  //         config: {
  //           iceServers: [ { url: 'stun:23.21.150.121' } ]
  //         },
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     transports.push(new UdpTransport())
  //     transports.push(new TcpTransport())
  //     transports.push(
  //       new TurnTransport({
  //         turnServer: turnAddr,
  //         turnPort: turnPort,
  //         turnProtocol: new TurnProtocols.TCP(),
  //         turnUsername: turnUser,
  //         turnPassword: turnPwd,
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     var server = net.createServer(transports, function (connection) {
  //       expect(connection).to.not.be.undefined
  //       expect(connection.isConnected()).to.be.true
  //       expect(connection.remoteAddress).to.not.be.undefined
  //       var webRtcTransport = server._transports[0]
  //       var udpTransport = server._transports[1]
  //       var tcpTransport = server._transports[2]
  //       var turnTransport = server._transports[3]
  //       // test if WebRtcSession is established
  //       expect(Object.keys(udpTransport._sessions).length).to.equal(0)
  //       expect(Object.keys(tcpTransport._connectingSockets).length).to.equal(0)
  //       expect(Object.keys(turnTransport._sessions).length).to.equal(0)
  //       expect(Object.keys(webRtcTransport._sessions).length).to.equal(1)
  //       server.closeP()
  //         .then(function () {
  //           // test if WebRtcSession is closed
  //           expect(Object.keys(udpTransport._sessions).length).to.equal(0)
  //           expect(Object.keys(tcpTransport._connectingSockets).length).to.equal(0)
  //           expect(Object.keys(turnTransport._sessions).length).to.equal(0)
  //           expect(Object.keys(webRtcTransport._sessions).length).to.equal(0)
  //           done()
  //         })
  //         .catch(function (error) {
  //           done(error)
  //         })
  //       connection.on('data', function (data) {
  //         expect(data.toString()).to.equal(testMessage)
  //         connection.destroy()
  //       })
  //     })
  //     return server
  //   }
  //
  //   var launchServer = function (onReady) {
  //     server.listen(function () {
  //       onReady()
  //     })
  //   }
  //
  //   var createClient = function (serverInfo) {
  //     var transports = []
  //     transports.push(
  //       new WebRtcTransport({
  //         config: {
  //           iceServers: [ { url: 'stun:23.21.150.121' } ]
  //         },
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     transports.push(new UdpTransport())
  //     transports.push(new TcpTransport())
  //     transports.push(
  //       new TurnTransport({
  //         turnServer: turnAddr,
  //         turnPort: turnPort,
  //         turnProtocol: new TurnProtocols.TCP(),
  //         turnUsername: turnUser,
  //         turnPassword: turnPwd,
  //         signaling: new WebSocketSignaling({
  //           url: registrar
  //         })
  //       })
  //     )
  //     client = net.createConnection(serverInfo, transports, function () {
  //       expect(client.isConnected()).to.be.true
  //       expect(client.remoteAddress).to.not.be.undefined
  //       client.write(testMessage)
  //     })
  //     expect(client.isConnected()).to.be.false
  //   }
  //
  //   server = createServer()
  //   launchServer(function () {
  //     createClient(server.address())
  //   })
  // })
})