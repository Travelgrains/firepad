/**
 * Created by larry on 2017/6/11.
 */

!function (factory) {
  if (typeof require === 'function' && typeof module !== 'undefined') {
    // CommonJS loader
    var fb = require('firebase');
    if (!fb) {
      throw new Error('firebase-channel.js requires firebase client');
    }
    factory(fb);
  } else if (typeof define === 'function' && define.amd) {
    // AMD loader
    define('firebase-eventbus', ['firebase'], factory);
  } else {
    // plain old include
    if (typeof this.firebase === 'undefined') {
      throw new Error('firebase-channel.js requires firebase client');
    }

    Bus = factory(this.firebase);
  }
}(function (fb) {
  /**
   * Bus
   *
   * @param options
   * @constructor
   */
  var Bus = function (options) {
    var self = this;

    database = fb.database();
    options = options || {};
    this.serverKey = options['serverKey'];
    this.targetClients = [];

    database.ref('.info/connected').on('value', function (connectedSnap) {
      if (connectedSnap.val() === true) {
        self.onopen && self.onopen();
      } else {
        self.onclose && self.onclose(e);
      }
    });
  };

  /**
   * Send a message
   *
   * @param {String} topic
   * @param {Object} payload
   * @param {Object} [options]
   * @param {Function} [callback]
   */
  Bus.prototype.send = function (topic, payload, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = null;
    }
    var clientId = this.targetClients[0];
    if (typeof clientId !== 'string') {
      throw new Error("请先设置 bus.targetClients");
    }
    var msg = {
      'topic': topic,
      'options': options,
      'payload': payload
    };

    var ref = database.ref('bus/queue').child(clientId).push();
    ref.child('send').set(msg, function () {
      ref.child('reply').on('value', function (snap) {
        var replyMsg = snap.val();
        if (replyMsg === null) {
          return;
        }
        snap.ref.off();

        var historyRef = database.ref('bus/history').push();
        function doTransaction() {
          var topicsRef = database.ref('bus/topics').child(msg.topic);
          topicsRef.orderByKey().limitToLast(1).once('value', function (snap) {
            var revision = 0;
            if (snap.exists()) {
              revision = revisionFromId(Object.keys(snap.val())[0]) + 1;
            }
            topicsRef.child(revisionToId(revision)).transaction(function (current) {
              if (current === null) {
                return {id: historyRef.key};
              } else {
                doTransaction();
              }
            }, function (error, committed, snapshot) {
              if (error) {
                if (error.message === 'disconnect') {
                  doTransaction();
                } else {
                  console.log('Transaction failure!', error);
                  throw error;
                }
                return;
              }
              historyRef.set({
                send: msg,
                reply: replyMsg,
                client: clientId,
                time: firebase.database.ServerValue.TIMESTAMP
              });
            });
          });
        }
        doTransaction();

        if (callback) {
          callback({result: replyMsg});
        }
      });
    });
  };

  Bus.prototype.publish = function (topic, payload, options) {
    if (typeof this.serverKey !== 'string') {
      throw new Error("请先设置 bus.serverKey");
    }
    var contentAvailable = true;
    if (typeof options === 'object' && 'content_available' in options) {
      contentAvailable = options['content_available'];
    }
    var body = {
      'to': null,
      'content_available': contentAvailable,
      'data': {
        'gdc': {
          'topic': topic,
          'payload': payload,
          'options': options
        }
      }
    };
    for (var i in this.targetClients) {
      var client = this.targetClients[i];
      if (!client.startsWith('/topics/')) {
        continue;
      }
      body['to'] = client;
      fetch('https://fcm.googleapis.com/fcm/send', {
        'method': 'POST',
        'headers': {
          'Authorization': 'key=' + this.serverKey,
          'Content-Type': 'application/json'
        },
        'body': JSON.stringify(body)
      }).then(function (response) {
        console.log(response);
      }).catch(function (error) {
        console.error(error);
      });
    }
  };

  // Based off ideas from http://www.zanopha.com/docs/elen.pdf
  var characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

  function revisionToId(revision) {
    if (revision === 0) {
      return 'A0';
    }

    var str = '';
    while (revision > 0) {
      var digit = (revision % characters.length);
      str = characters[digit] + str;
      revision -= digit;
      revision /= characters.length;
    }

    // Prefix with length (starting at 'A' for length 1) to ensure the id's sort lexicographically.
    var prefix = characters[str.length + 9];
    return prefix + str;
  }

  function revisionFromId(revisionId) {
    if (!(revisionId.length > 0 && revisionId[0] === characters[revisionId.length + 8])) {
      throw new Error("assertion error, revisionId:" + revisionId);
    }
    var revision = 0;
    for (var i = 1; i < revisionId.length; i++) {
      revision *= characters.length;
      revision += characters.indexOf(revisionId[i]);
    }
    return revision;
  }

  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = Bus;
    } else {
      exports.Bus = Bus;
    }
  } else {
    return Bus;
  }
});