var dgram = require('dgram');
var net = require('net');
var os = require('os');

/**
 * Generic helper because all Collectd plugins and PluginInstance
 * counters & gauges are organized as double-nested objects.
 */
function doubleHashUpdate(dh, key1, key2, cb) {
    var val1;
    if (dh.hasOwnProperty(key1)) {
	val1 = dh[key1];
    } else {
	val1 = {};
	dh[key1] = val1;
    }

    var val2 = val1[key2];
    val2 = cb(val2);
    val1[key2] = val2;
    return val2;
}

function doubleHashForEach(dh, cb) {
    for(var key1 in dh)
	if (dh.hasOwnProperty(key1)) {
	    for(var key2 in dh[key1])
		if (dh[key1].hasOwnProperty(key2)) {
		    cb(key1, key2, dh[key1][key2]);
		}
	}
}

/**
 * Your entry hook to set values
 */
function PluginInstance(plugin, instance) {
    this.plugin = plugin;
    this.instance = instance;

    /* Collectd.prototype.send() depends on these structures: */
    this.counters = {};
    this.gauges = {};
    /* TODO: derive & absolute */
};

PluginInstance.prototype = {
    addCounter: function(name, instance, increment) {
	doubleHashUpdate(this.counters, name, instance, function(counter) {
	    return (counter || 0) + increment;
	});
    },
    setCounter: function(name, instance, value) {
	doubleHashUpdate(this.counters, name, instance, function() {
	    return value;
	});
    },
    setGauge: function(name, instance, value) {
	doubleHashUpdate(this.gauges, name, instance, function() {
	    return value;
	});
    },

    /* Called by Collectd.prototype.send() */
    forgetGauges: function() {
	this.gauges = {};
    }
};

/**
 * Your context for a client periodically sending to 1 server. Use 
 */
function Collectd(interval, host, port) {
    this.interval = interval || 10000;
    this.host = host || "ff18::efc0:4a42";
    this.port = port || 25826;
    this.plugins = {};

    this.sock = dgram.createSocket(net.isIPv6(this.host) ? 'udp6' : 'udp4');
    this.sock.on('error', function(e) {
	console.error(e.stack || e.message || e);
    });

    setInterval(this.send.bind(this), interval);
};
module.exports = Collectd;

/**
 * Get or create a plugin instance
 */
Collectd.prototype.plugin = function(name, instance) {
    return doubleHashUpdate(this.plugins, name, instance, function(pluginInstance) {
	return pluginInstance || new PluginInstance(name, instance);
    });
};

/**
 * Called by interval set up by constructor
 */
Collectd.prototype.send = function() {
    var prevHost, prevPlugin, prevInstance, prevType, prevTypeInstance, prevTime, prevInterval;

    var pkt = new Packet(this.write.bind(this));
    var host = os.hostname();
    var time = Math.floor(new Date().getTime() / 1000);
    doubleHashForEach(this.plugins, function(plugin, instance, p) {
	function addPrelude(type, typeInstance) {
	    if (prevHost !== host) {
		prevHost = host;
		pkt.addStringPart(0, host);
	    }
	    if (prevTime !== time) {
		prevTime = time;
		pkt.addNumericPart(1, time);
	    }
	    if (prevInterval !== this.interval) {
		prevInterval = this.interval;
		pkt.addNumericPart(7, Math.ceil(this.interval / 1000));
	    }
	    if (prevPlugin !== plugin) {
		prevPlugin = plugin;
		pkt.addStringPart(2, plugin);
	    }
	    if (prevInstance !== instance) {
		prevInstance = instance;
		pkt.addStringPart(3, instance);
	    }
	    if (prevType !== type) {
		prevType = type;
		pkt.addStringPart(4, type);
	    }
	    if (prevTypeInstance !== typeInstance) {
		prevTypeInstance = typeInstance;
		pkt.addStringPart(5, typeInstance);
	    }
	}
	function resetState() {
	    prevHost = undefined;
	    prevPlugin = undefined;
	    prevInstance = undefined;
	    prevType = undefined;
	    prevTypeInstance = undefined;
	    prevTime = undefined;
	    prevInterval = undefined;
	}

	doubleHashForEach(p.counters, function(type, typeInstance, value) {
	    pkt.catchOverflow(function() {
		addPrelude(type, typeInstance);
		pkt.addValuesPart('counter', [value]);
	    }, resetState);
	});
	doubleHashForEach(p.gauges, function(type, typeInstance, value) {
	    pkt.catchOverflow(function() {
		addPrelude(type, typeInstance);
		pkt.addValuesPart('gauge', [value]);
	    }, resetState);
	});
	/* Send last if neccessary */
	pkt.send();
    });
};

Collectd.prototype.write = function(buf) {
    console.log(">>", buf);
    this.sock.send(buf, 0, buf.length, this.port, this.host);
};


function Packet(sendCb) {
    this.sendCb = sendCb;
    this.buf = new Buffer(1024);
    this.pos = 0;
}

Packet.prototype = {
    send: function() {
	if (this.pos > 0)
	    this.sendCb(this.buf.slice(0, this.pos));
    },

    addStringPart: function(id, str) {
	if (!Buffer.isBuffer(str))
	    str = new Buffer(str);
	var len = 5 + str.length;
	if (this.pos + len > this.buf.length)
	    throw new PacketOverflow();

	this.buf.writeUInt16BE(id, this.pos);
	this.pos += 2;
	this.buf.writeUInt16BE(len, this.pos);
	this.pos += 2;
	str.copy(this.buf, this.pos);
	this.pos += str.length;
	this.buf[this.pos++] = 0;
    },

    addNumericPart: function(id, num) {
	var len = 12;
	if (this.pos + len > this.buf.length)
	    throw new PacketOverflow();
	this.buf.writeUInt16BE(id, this.pos);
	this.pos += 2;
	this.buf.writeUInt16BE(len, this.pos);
	this.pos += 2;
	this.buf.writeUInt32BE(Math.floor(num / Math.pow(2, 32)), this.pos);
	this.pos += 4;
	this.buf.writeUInt32BE(num & 0xffffffff, this.pos);
	this.pos += 4;
    },

    addValuesPart: function(dataType, values) {
	var id = 6;
	var len = 6 + 9 * values.length;
	if (this.pos + len > this.buf.length)
	    throw new PacketOverflow();
	this.buf.writeUInt16BE(id, this.pos);
	this.pos += 2;
	this.buf.writeUInt16BE(len, this.pos);
	this.pos += 2;
	this.buf.writeUInt16BE(values.length, this.pos);
	this.pos += 2;
	for(var i = 0; i < values.length; i++) {
	    switch(dataType) {
		case 'counter':
			this.buf[this.pos++] = 0;
			this.buf.writeUInt32BE(Math.floor(values[i] / Math.pow(2, 32)), this.pos);
			this.pos += 4;
			this.buf.writeUInt32BE(values[i] & 0xffffffff, this.pos);
			this.pos += 4;
			break;
		case 'gauge':
			this.buf[this.pos++] = 0;
			this.buf.writeDoubleLE(values[i], this.pos);
			this.pos += 8;
			break;
		default:
			throw "Invalid data type";
	    }
	}
    },

    /* Tries to make it fit in 1024 bytes or starts a new packet */
    catchOverflow: function(cb, resetCb) {
return cb();
	var tries = 2;
	while(tries > 0) {
	    tries--;

	    var oldPos = this.pos;
	    try {
		/* On success return */
		return cb();
	    } catch (e) {
console.error(e.stack || e.message || e);
		if (e.constructor === PacketOverflow) {
		    /* Flush packet so far */
		    this.pos = oldPos;
		    this.send();
		    /* Clear state */
		    resetCb();
		    /* And retry... */
		} else
		    throw e;
	    }
	}
    }
};

function PacketOverflow() {
    this.message = "Packet size overflow";
}
