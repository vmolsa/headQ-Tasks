var _ = require('lodash');
var $q = require('headq');

function Tasks() {
  var self = this;
  
  self.events = {};
  self.request = {};
  self.ontransmit = null;
}

Tasks._ = _;

Tasks.JSON = {
  parse: function(data) {
    return new $q(function(resolve, reject) {
      if (_.isObject(data)) {
        return resolve(data);
      }
      
      resolve(JSON.parse(data));
    });
  },
  stringify: function(data) {
    return new $q(function(resolve, reject) {
      if (_.isString(data)) {
        return resolve(data);
      }
      
      resolve(JSON.stringify(data));
    });
  },
};

/**
 * Generates a GUID string.
 * @returns {String} The generated GUID.
 * @example af8a8416-6e18-a307-bd9c-f2c947bbb3aa
 * @author Slavik Meltser (slavik@meltser.info).
 * @link http://slavik.meltser.info/?p=142
 */

Tasks.uuid = function() {
  function _p8(s) {
    var p = (Math.random().toString(16)+"000000000").substr(2,8);
    return s ? "-" + p.substr(0,4) + "-" + p.substr(4,4) : p ;
  }
  
  return _p8() + _p8(true) + _p8(true) + _p8();
}

Tasks.prototype.on = function(event, callback) {
  var self = this;
  
  if (_.isString(event) && _.isFunction(callback)) {
	  self.events[event] = callback;
  }
};

Tasks.prototype.off = function(event) {
  var self = this;
  
  if (_.isString(event) && _.isFunction(self.events[event])) {
    delete self.events[event];
  }
};

Tasks.prototype.end = function() {
  var self = this;
  var tasks = [];
  
  _.forEach(self.request, function(value, key) {
    value.reject(410);
    tasks.push(value);
  });

  return $q.all(tasks);
};

Tasks.prototype.rawPacket = function(packet) {
  var self = this;
  
  if (_.isFunction(self.ontransmit)) {
    return new $q(function(resolve, reject) { 
      Tasks.JSON.stringify(packet).then(function(out) {
        var res = self.ontransmit.call(self, out);
        
        if (!_.isFunction(res.then)) {
          return reject(503);
        }
        
        res.then(function() {
          resolve();
        }).catch(function(error) {
          reject(error);
        });
      }).catch(function(error) {
        reject(error);
      });
    });
  }
  
  return $q.reject(503);
};

Tasks.prototype.transmit = function(packet) {
  var self = this;
  
  return new $q(function(resolve, reject) {
    Tasks.JSON.parse(packet).then(function(result) {
      var notify = result.notify;
      var reply = result.reply;
      var request = result.request;
      var event = result.event;
      var data = result.data;
      var status = result.status || 400;
      
      if (reply) {
        if (self.request[reply]) {
          if (status >= 200 && status < 400) {
            self.request[reply].resolve(data || status);
          } else {
            self.request[reply].reject(data || status);
          }
          
          return resolve(200);
        }
        
        reject(404);
      } else if (request) {
        if (self.events[event]) {         
          var req = new $q.defer();
                  
          req.then(function(reply) {
            self.rawPacket({ reply: request, status: 200, data: reply }).catch(function(error) {
              self.end();
            });
          }, function(error) {
            if (_.isNumber(error) && error >= 100 && error < 600) {
              return self.rawPacket({ reply: request, status: error }).catch(function(error) {
                self.end();
              });
            } else if (_.isError(error)) {
              return self.rawPacket({ reply: request, status: 500, data: error.message }).catch(function(error) {
                self.end();
              });
            }
            
            self.rawPacket({ reply: request, status: 400, data: error }).catch(function(error) {
              self.end();
            });
          }, function(info) {
            self.rawPacket({ notify: request, status: 200, data: info }).catch(function(error) {
              self.end();
            });
          });
          
          self.events[event].call(self, req, data);
          
          return resolve(200);
        } else {
          self.rawPacket({ reply: request, status: 404 }).then(function() {
            reject(404);
          }).catch(function(error) {
            reject(error);
          });
        }
      } else if (notify) {
        if (self.request[notify]) {
          self.request[notify].notify(data || status);
        }
        
        resolve(200);
      } else {
        reject(400);
      }
    }).catch(function(error) {
      reject(400);
    });
  });
};

Tasks.prototype.send = function(event, data, timeout) {
  var self = this;
  
  if (!_.isString(event)) {
    return $q.reject(400);
  }
  
  function genId() {
    var id = Tasks.uuid();
      
    if (self.request[id]) {
      return genId();
    }
    
    return id;
  }
    
  var id = genId();
  var req = $q.defer();
  var timer = null;

  self.request[id] = req;
  
  req.finally(function() {
    clearTimeout(timer);
    delete self.request[id];
  });
  
  self.rawPacket({ request: id, event: event, data: data }).catch(function(error) {
    req.reject(error);
  });
  
  if (timeout) {
    timer = setTimeout(function() {
      req.reject(408);
    }, timeout);
  }
  
  return req;
};

module.exports = Tasks;
