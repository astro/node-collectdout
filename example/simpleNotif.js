var Collectd = require('../lib');

var client = new Collectd();

/* Send a basic notification from gandalf/sysconfig/foobar */
client.sendNotif({ 
	h: 'gandalf', /* in old docs, some servers are named gandalf */
	p: 'sysconfig', /* or whatever */
	t: 'foobar', /* maybe you have more imagination ? */
	severity: Collectd.NOTIF_OK,
	message: 'some test notif'
});

/* Send a basic notification from <hostname detected automatically>/sysconfig/foobar */
client.sendNotif({ 
	h: undefined, /* note : (h: undefined) means that h is defined. Only its value is undefied */
	p: 'sysconfig', /* don't throw good things */
	t: 'foobar', /* guess what ? */
	severity: Collectd.NOTIF_OK,
	message: 'some other test notif'
});

/* Send a a too long notification from whatever : it is too big and will be dropped. Watch your logs */
client.sendNotif({ 
	h: 'gandalf',
	p: 'sysconfig',
	t: 'toobig',
	severity: Collectd.NOTIF_OK,
	message: '1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890'
	      + '1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890'
	      + '1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890'
	      + '1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890'
	      + '1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890'
	      + '1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890'
	      + '1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890'
	      + '1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890'
	      + '1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890'
	      + '1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890'
});