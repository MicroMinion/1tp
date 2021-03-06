'use strict'

var events = require('events')
var myUtils = require('../utils')
var Q = require('q')
var util = require('util')
var winston = require('winston-debug')
var winstonWrapper = require('winston-meta-wrapper')

function AbstractTransport () {
  // logging -- subclass will override this
  this._log = winstonWrapper(winston)
  this._log.addMeta({
    module: '1tp:transports'
  })
  // event emitter
  events.EventEmitter.call(this)
  // register _error handler
  myUtils.mixinEventEmitterErrorFunction(this)
  // version number
  this.version = myUtils.version
}

// Inherit EventEmitter
util.inherits(AbstractTransport, events.EventEmitter)

AbstractTransport.prototype.transportType = function () {
  var errorMsg = 'AbstractTransport.transportType function not implemented'
  this._log.error(errorMsg)
  this._error(errorMsg)
}

AbstractTransport.prototype.listen = function (listeningInfo, onSuccess, onFailure) {
  var errorMsg = 'AbstractTransport.listen function not implemented'
  this._log.error(errorMsg)
  this._error(errorMsg)
}

AbstractTransport.prototype.listenP = function (listeningInfo) {
  var deferred = Q.defer()
  this.listen(
    listeningInfo,
    function (connectionInfo) {
      deferred.resolve(connectionInfo)
    },
    function (error) {
      deferred.reject(error)
    }
  )
  return deferred.promise
}

AbstractTransport.prototype.connect = function (peerConnectionInfo, onSuccess, onFailure) {
  var errorMsg = 'AbstractTransport.connect function not implemented'
  this._log.error(errorMsg)
  this._error(errorMsg)
}

AbstractTransport.prototype.connectP = function (peerConnectionInfo) {
  var deferred = Q.defer()
  this.connect(
    peerConnectionInfo,
    function (stream, peerConnectionInfo) {
      stream.peerConnectionInfo = peerConnectionInfo
      deferred.resolve(stream)
    },
    function (error) {
      deferred.reject(error)
    }
  )
  return deferred.promise
}

AbstractTransport.prototype.abort = function (peerConnectionInfo, onSuccess, onFailure) {
  var errorMsg = 'AbstractTransport.abort function not implemented'
  this._log.error(errorMsg)
  this._error(errorMsg, onFailure)
}

AbstractTransport.prototype.abortP = function (peerConnectionInfo) {
  var deferred = Q.defer()
  this.abort(
    peerConnectionInfo,
    function () {
      deferred.resolve()
    },
    function (error) {
      deferred.reject(error)
    }
  )
  return deferred.promise
}

AbstractTransport.prototype.close = function (onSuccess, onFailure) {
  var errorMsg = 'AbstractTransport.close function not implemented'
  this._log.error(errorMsg)
  this._error(errorMsg)
}

AbstractTransport.prototype.closeP = function () {
  var deferred = Q.defer()
  this.close(
    function () {
      deferred.resolve()
    },
    function (error) {
      deferred.reject(error)
    }
  )
  return deferred.promise
}

AbstractTransport.prototype._fireListeningEvent = function (myConnectionInfo, callback) {
  this._log.debug('firing listening event with connectionInfo ' + JSON.stringify(myConnectionInfo))
  if (callback) {
    callback(myConnectionInfo)
    return
  }
  this.emit('listening', myConnectionInfo)
}

AbstractTransport.prototype._fireConnectEvent = function (stream, peerConnectionInfo, callback) {
  this._log.debug('firing connect event with peerConnectionInfo ' + JSON.stringify(peerConnectionInfo))
  if (callback) {
    callback(stream, peerConnectionInfo)
    return
  }
  this.emit('connect', stream, peerConnectionInfo)
}

AbstractTransport.prototype._fireConnectionEvent = function (stream, transport, peerConnectionInfo) {
  this._log.debug('firing connection event with peerConnectionInfo ' + JSON.stringify(peerConnectionInfo))
  this.emit('connection', stream, transport, peerConnectionInfo)
}

AbstractTransport.prototype._fireCloseEvent = function (callback) {
  this._log.debug('firing close event')
  if (callback) {
    callback()
    return
  }
  this.emit('close')
}

module.exports = AbstractTransport
