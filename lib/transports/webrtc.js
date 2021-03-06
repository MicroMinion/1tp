'use strict'

var AbstractTransport = require('./abstract')
var EventEmitter = require('events').EventEmitter
var freeice = require('freeice')
var merge = require('merge')
var myUtils = require('../utils')
var OneTpError = require('../error')
var Q = require('q')
var runtime = require('mm-runtime-info')
var SimplePeer = require('simple-peer')
var util = require('util')
var winston = require('winston-debug')
var winstonWrapper = require('winston-meta-wrapper')

function WebRtcTransport (args) {
  if (!(this instanceof WebRtcTransport)) {
    return new WebRtcTransport(args)
  }
  AbstractTransport.call(this)
  // verify runtime compatibility
  if (!WebRtcTransport.isCompatibleWithRuntime()) {
    var errorMsg = 'WebRtc transport cannot be used on this runtime'
    this._error(errorMsg)
  }
  // logging
  this._log = winstonWrapper(winston)
  this._log.addMeta({
    module: '1tp:transports:webrtc'
  })
  // verify signaling args
  if (args.signaling === undefined) {
    var signalingArgsError = 'incorrect args: signaling is undefined'
    this._log.error(signalingArgsError)
    throw new Error(signalingArgsError)
  }
  // merge args
  this._args = merge(Object.create(WebRtcTransport.DEFAULTS), args)
  try {
    var wrtc = require('wrtc')
    this._log.debug('using wrtc module')
    this._args.wrtc = wrtc
  } catch (error) {
    this._log.debug('cannot load wrtc module')
  }
  delete this._args.signaling
  // init
  this._signaling = args.signaling
  this._state = WebRtcTransport.STATE.INIT
  // keep track of udp sessions
  this._sessions = {}
  // done
  this._log.debug('created webrtc transport, config = ' + JSON.stringify(this._args))
}

// Inherit from abstract transport
util.inherits(WebRtcTransport, AbstractTransport)

WebRtcTransport.DEFAULTS = {
  config: { iceServers: freeice() },
  trickle: true,
  connectTimeout: 6000
}

WebRtcTransport.STATE = {
  INIT: 0,
  LISTENING: 1,
  CLOSING: 2,
  CLOSED: 3
}

WebRtcTransport.isCompatibleWithRuntime = function () {
  return !runtime.onRpi() &&
    !(runtime.isCordovaApp() && runtime.onIDevice())
}

WebRtcTransport.prototype.transportType = function () {
  return 'webrtc'
}

WebRtcTransport.prototype.listen = function (listeningInfo, onSuccess, onFailure) {
  this._log.debug('listen to ' + JSON.stringify(listeningInfo))
  var requestedRegistrationInfo
  if (listeningInfo !== undefined) {
    // verify listeningInfo
    if (listeningInfo.transportType !== this.transportType()) {
      var transportTypeError = 'incorrect listeningInfo: unexpected transportType -- ignoring request'
      this._log.error(transportTypeError)
      this._error(transportTypeError, onFailure)
      return
    }
    if (listeningInfo.transportInfo === undefined) {
      var transportInfoUndefined = 'incorrect connectionInfo: transportInfo is undefined'
      this._log.error(transportInfoUndefined)
      this._error(transportInfoUndefined, onFailure)
      return
    }
    requestedRegistrationInfo = listeningInfo.transportInfo
  }
  // register callback with signaling connector
  var self = this
  this._signaling.registerP(this._onSignalingMessage.bind(this), requestedRegistrationInfo)
    .then(function (actualRegistrationInfo) {
      self._state = WebRtcTransport.STATE.LISTENING
      var myConnectionInfo = {
        transportType: self.transportType(),
        transportInfo: actualRegistrationInfo,
        version: self.version
      }
      self._myListeningConnectionInfo = myConnectionInfo
      // send 'listening' event
      self._fireListeningEvent(myConnectionInfo, onSuccess)
    })
    .catch(function (error) {
      self._log.error(error)
      self._error(error, onFailure)
    })
}

WebRtcTransport.prototype.connect = function (peerConnectionInfo, onSuccess, onFailure) {
  this._log.debug('connect to ' + JSON.stringify(peerConnectionInfo))
  // verify peerConnectionInfo
  if (peerConnectionInfo.transportType !== this.transportType()) {
    var transportTypeError = 'incorrect connectionInfo: unexpected transportType -- ignoring request'
    this._log.error(transportTypeError)
    this._error(transportTypeError, onFailure)
    return
  }
  if (peerConnectionInfo.transportInfo === undefined) {
    var transportInfoUndefined = 'incorrect connectionInfo: transportInfo is undefined'
    this._log.error(transportInfoUndefined)
    this._error(transportInfoUndefined, onFailure)
    return
  }
  // create and store session info
  var sessionId = myUtils.generateSessionId()
  var sessionInfo = new EventEmitter()
  sessionInfo.sessionId = sessionId
  sessionInfo.peerConnectionInfo = peerConnectionInfo
  this._sessions[sessionId] = sessionInfo
  // register callback with signaling connector
  var self = this
  this._signaling.registerP(this._onSignalingMessage.bind(this))
    .then(function (actualRegistrationInfo) {
      self._log.debug('connection with registrar established')
      // create and store my connection info
      var myConnectionInfo = {
        transportType: self.transportType(),
        transportInfo: actualRegistrationInfo,
        version: self.version
      }
      sessionInfo.myConnectionInfo = myConnectionInfo
      // create simple peer
      var simplePeerArgs = merge(true, self._args)
      simplePeerArgs.initiator = true
      var peer = self._createSimplePeer(
        simplePeerArgs,
        sessionInfo,
        // when handshake aborts
        function () {
          // send error message
          var handshakeAbortedMessage = 'handshake aborted'
          self._log.error(handshakeAbortedMessage)
          self._error(new OneTpError(OneTpError.CODES.handshakeAborted, handshakeAbortedMessage), onFailure)
        }
      )
      sessionInfo.webrtcPeer = peer
      sessionInfo.emit('webRtcPeerAvailable')
      // fire connect event on webrtc connect
      peer.on('connect', function () {
        // fire connect event
        self._fireConnectEvent(
          peer,
          peerConnectionInfo,
          onSuccess
        )
      })
      // when something goes wrong
      peer.on('error', function (error) {
        // close connection with signaling server
        self._signaling.deregisterP(actualRegistrationInfo)
          .then(function () {
            // remove session info
            delete self._sessions[sessionId]
            // throw error event
            self._error(error, onFailure)
          })
          .catch(function (error) {
            self._error(error, onFailure)
          })
      })
      peer.on('close', function () {
        // close connection with signaling server
        self._signaling.deregisterP(actualRegistrationInfo)
          .catch(function (error) {
            self._error(error, onFailure)
          })
      })
    })
    .catch(function (error) {
      // delete session info
      delete self._sessions[sessionId]
      // fire error event
      self._log.error(error)
      self._error(error, onFailure)
    })
}

WebRtcTransport.prototype.abort = function (peerConnectionInfo, onSuccess, onFailure) {
  this._log.debug('aborting handshake with ' + JSON.stringify(peerConnectionInfo))
  // verify peerConnectionInfo
  if (peerConnectionInfo.transportType !== this.transportType()) {
    var transportTypeError = 'incorrect connectionInfo: unexpected transportType -- ignoring request'
    this._log.error(transportTypeError)
    this._error(transportTypeError, onFailure)
    return
  }
  if (peerConnectionInfo.transportInfo === undefined) {
    var transportInfoUndefined = 'incorrect connectionInfo: transportInfo is undefined'
    this._log.error(transportInfoUndefined)
    this._error(transportInfoUndefined, onFailure)
    return
  }
  var self = this
  this._getSimplePeerP(peerConnectionInfo)
    .then(function (peer) {
      // remove 'signal' listeners
      self._log.debug('removing signal listeners')
      peer.removeAllListeners('signal')
      // destroy peer
      peer.destroy(function () {
        // stop and remove timer
        clearTimeout(peer._1tpConnectionTimeout)
        delete peer._1tpConnectionTimeout
        onSuccess()
      })
    })
    .catch(function (error) {
      self._log.error(error)
      var noPeerMessage = 'cannot find peer for connectionInfo ' + JSON.stringify(peerConnectionInfo)
      self._error(new OneTpError(OneTpError.CODES.nothingToAbort, noPeerMessage), onFailure)
    })
}

WebRtcTransport.prototype.close = function (onSuccess, onFailure) {
  this._log.debug('closing WebRtcTransport')
  this._onClosingSuccess = onSuccess
  this._onClosingFailure = onFailure
  this._state = WebRtcTransport.STATE.CLOSING
  if (myUtils.isEmpty(this._sessions)) {
    this._close()
    return
  }
}

WebRtcTransport.prototype._close = function () {
  if (this._state === WebRtcTransport.STATE.CLOSED) {
    this._log.debug('WebRtcTransport already closed, ignoring _close request')
    return
  }
  this._state = WebRtcTransport.STATE.CLOSED
  var self = this
  // when socket was not connected with signaling server listening for incoming requests
  if (this._myListeningConnectionInfo === undefined) {
    // then we're done
    self._fireCloseEvent(self._onClosingSuccess)
    return
  }
  // otherwise, close connection with signaling server
  this._signaling.deregisterP(this._myListeningConnectionInfo.transportInfo)
    .then(function () {
      self._fireCloseEvent(self._onClosingSuccess)
    })
    .catch(function (error) {
      self._log.error(error)
      self._error(error, self._onClosingFailure)
    })
}

WebRtcTransport.prototype._sendSignalingMessage = function (signalingDestination, sessionInfo, onSuccess, onFailure) {
  var self = this
  return function (data) {
    var signalingMessage = {
      version: self.version,
      sender: sessionInfo.myConnectionInfo.transportInfo,
      sessionId: sessionInfo.sessionId,
      data: data
    }
    self._signaling.sendP(signalingMessage, signalingDestination)
      .then(function () {
        self._log.debug(JSON.stringify(signalingMessage) + ' sent to ' + JSON.stringify(signalingDestination))
        if (onSuccess) {
          onSuccess()
        }
      })
      .catch(function (error) {
        self._log.error(error)
      // don't raise error, instread silently discard
      })
  }
}

WebRtcTransport.prototype._onSignalingMessage = function (message) {
  this._log.debug('receiving signaling message ' + JSON.stringify(message))
  if (message.version === undefined) {
    var undefinedVersionError = 'incorrect signaling message: undefined version -- ignoring request'
    this._log.error(undefinedVersionError)
    this._error(undefinedVersionError)
    return
  }
  var data = message.data
  if (data === undefined) {
    var undefinedDataError = 'incorrect signaling message: undefined data -- ignoring request'
    this._log.error(undefinedDataError)
    this._error(undefinedDataError)
    return
  }
  var sessionId = message.sessionId
  if (sessionId === undefined) {
    var undefinedSessionIdError = 'incorrect signaling message: undefined session id -- ignoring request'
    this._log.error(undefinedSessionIdError)
    this._error(undefinedSessionIdError)
    return
  }
  // if transport accepts connections + this is an 'init' message (SDP offer)
  if (this._acceptIncomingConnections() &&
    (data.type === 'offer')
  ) {
    // then create a new session
    this._processIncomingSessionRequest(message)
  }
  // get session info
  var sessionInfo = this._sessions[sessionId]
  // if no session info instance available, then
  if (sessionInfo === undefined) {
    // ignore request
    var noSessionInfoMsg = 'no session info available for session ' + sessionId + ' -- ignoring request'
    this._log.debug(noSessionInfoMsg)
    return
  }
  // otherwise, forward signaling data to peer instance
  sessionInfo.webrtcPeer.signal(data)
}

WebRtcTransport.prototype._processIncomingSessionRequest = function (message) {
  var sessionId = message.sessionId
  var peerTransportInfo = message.sender
  // check if a session exists for this sessionId
  if (this._sessions[sessionId]) {
    var sessionAlreadyAvailableError = 'session ' + sessionId + ' already exists'
    this._log.error(sessionAlreadyAvailableError)
    this._error(sessionAlreadyAvailableError)
  }
  this._log.debug("let's create a new webrtc session")
  // compose peerConnectionInfo
  var peerConnectionInfo = {
    transportType: this.transportType(),
    transportInfo: peerTransportInfo,
    version: this.version
  }
  // create and store session info
  var sessionInfo = new EventEmitter()
  sessionInfo.sessionId = sessionId
  sessionInfo.peerConnectionInfo = peerConnectionInfo
  sessionInfo.myConnectionInfo = this._myListeningConnectionInfo
  this._sessions[sessionId] = sessionInfo
  // create simple peer
  var peer = this._createSimplePeer(
    this._args,
    sessionInfo
  )
  sessionInfo.webrtcPeer = peer
  sessionInfo.emit('webRtcPeerAvailable')
  var self = this
  // fire connection event on webrtc connect
  peer.on('connect', function () {
    // fire connection event
    self._fireConnectionEvent(peer, self, peerConnectionInfo)
  })
  // when something goes wrong
  peer.on('error', function (error) {
    // remove sessionInfo
    delete self._sessions[sessionId]
    // throw error event
    self._error(error)
  })
  this._log.debug('created new peer instance for ' + JSON.stringify(message.sender))
}

WebRtcTransport.prototype._createSimplePeer = function (simplePeerArgs, sessionInfo, onAbort) {
  onAbort = (onAbort === undefined) ? function () { /* do nothing */} : onAbort
  var peer = new SimplePeer(simplePeerArgs)
  var streamId = myUtils.generateStreamId()
  var peerConnectionInfo = sessionInfo.peerConnectionInfo
  var self = this
  // activate connect timeout logic
  this._setConnectTimeout(
    peer,
    // on timeout -- abort handshake init
    self.abort.bind(
      self,
      peerConnectionInfo,
      // on success, fire handshake aborted error
      onAbort,
      // on failure, fire error event
      function (error) {
        // fire error event
        self._error(error)
      }
    )
  )
  // register event listeners
  peer.on('signal', this._sendSignalingMessage(peerConnectionInfo.transportInfo, sessionInfo))
  peer.once('close', function () {
    self._log.debug('session ' + sessionInfo.sessionId + '/' + streamId + ' closed')
    delete self._sessions[sessionInfo.sessionId]
    if (myUtils.isEmpty(self._sessions) && self._state === WebRtcTransport.STATE.CLOSING) {
      self._close(self._onClosingSuccess)
    }
  })
  peer.once('end', function () {
    self._log.debug('session ' + sessionInfo.sessionId + '/' + streamId + ' is no more readable')
    // delete if finished + ended
    if (!peer.writable) {
      delete self._sessions[sessionInfo.sessionId]
      if (myUtils.isEmpty(self._sessions) && self._state === WebRtcTransport.STATE.CLOSING) {
        self._close(self._onClosingSuccess)
      }
    }
  })
  peer.once('finish', function () {
    self._log.debug('session ' + sessionInfo.sessionId + '/' + streamId + ' is no more writable')
    // delete if finished + ended
    if (!peer.readable) {
      delete self._sessions[sessionInfo.sessionId]
      if (myUtils.isEmpty(self._sessions) && self._state === WebRtcTransport.STATE.CLOSING) {
        self._close(self._onClosingSuccess)
      }
    }
  })
  return peer
}

WebRtcTransport.prototype._setConnectTimeout = function (peer, onTimeout) {
  peer.on('connect', function () {
    // stop and remove connection timer if present
    clearTimeout(peer._1tpConnectionTimeout)
    delete peer._1tpConnectionTimeout
  })
  // when something goes wrong
  peer.on('error', function () {
    // stop and remove connection timer if present
    if (peer._1tpConnectionTimeout) {
      clearTimeout(peer._1tpConnectionTimeout)
      delete peer._1tpConnectionTimeout
    }
  })
  // set timeout
  var self = this
  var timeout = setTimeout(function () {
    // create and display error message
    var connectionTimeoutError = 'connection timeout'
    self._log.error(connectionTimeoutError)
    // execute onTimeout cb
    onTimeout()
  }, self._args.connectTimeout)
  peer._1tpConnectionTimeout = timeout
}

WebRtcTransport.prototype._getSimplePeerP = function (peerConnectionInfo) {
  this._log.debug('trying to find peer for peerConnectionInfo ' + JSON.stringify(peerConnectionInfo))
  // init
  var deferred = Q.defer()
  var self = this
  var delay = 1000
  // try to find sessionInfo object
  var sessionInfo
  for (var sessionId in this._sessions) {
    sessionInfo = this._sessions[sessionId]
    if (sessionInfo.peerConnectionInfo === peerConnectionInfo) {
      break
    }
  }
  // reject if no sessionInfo object was found
  if (sessionInfo === undefined) {
    var rejectMessage = 'could not find sessioInfo that matches peerConnectionInfo'
    deferred.reject(rejectMessage)
  } else {
    // resolve if webrtcPeer is available
    if (sessionInfo.webrtcPeer !== undefined) {
      var readyMsg = 'found webrtc peer, ready to roll'
      this._log.debug(readyMsg)
      deferred.resolve(sessionInfo.webrtcPeer)
    } else {
      // otherwise wait until webrtcPeer appears
      var timeout = setTimeout(function () {
        var timeoutMessage = 'timeout while waiting for webrtc peer'
        self._log.debug(timeoutMessage)
        deferred.reject()
      }, delay)
      sessionInfo.on('webRtcPeerAvailable', function () {
        clearTimeout(timeout)
        var readyMsg = 'webrtc peer available, ready to roll'
        self._log.debug(readyMsg)
        deferred.resolve(sessionInfo.webrtcPeer)
      })
    }
  }
  // done
  return deferred.promise
}

WebRtcTransport.prototype._acceptIncomingConnections = function () {
  return this._state === WebRtcTransport.STATE.LISTENING
}

module.exports = WebRtcTransport
