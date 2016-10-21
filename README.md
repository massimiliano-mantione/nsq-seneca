# nsq-seneca

Use [NSQ](http://nsq.io) to connect [Seneca](http://senecajs.org) services.

This is in principle similar to a [Seneca transport](https://github.com/senecajs/seneca-transport), but with a different API, not really idiomatic Seneca.
The biggest reason why this is not *"idiomatic Seneca"*  is that message routing is based on explicit topics (NSQ topics) and not arbitrarily complex patterns.

## Why nsq-seneca?

Normal Seneca transports try to be network transparent.
They try to make so that your code works the same way whether the "remote" service is physically remote or not.

The problem I have with them is that most of the time this abstraction is leaky, and service discovery gets in the way.
When I started working on this [seneca-balance-client](https://github.com/senecajs/seneca-balance-client) and [seneca-mesh](https://github.com/senecajs/seneca-mesh) were not ready, and I decided that NSQ was a good solution.

Over time I started liking the NSQ approach to building distributed systems more and more, and I wanted to connect my Seneca services using NSQ.
The existing [Seneca NSQ transport](https://www.npmjs.com/package/seneca-nsq-transport) does not really support channels, and it generates topic names that are based on Seneca patterns and are not very friendly to services not implemented in Seneca.
In the end I decided to go in a different direction, and build a Seneca plugin that would allow me to connect Seneca services in an *NSQ idiomatic* way.

This project is this plugin.

## Base API

Require the module and obtain a Seneca instance:

```
var nsqt = require('seneca-nsq')
var Seneca = require('seneca)
var s = Seneca()
```

The module provides two main functions as entry point: `handle` (aliased as `listen`) and `forward` (aliased as `client`).
Both of them can be used as Seneca plugins:

* `handle` provides the "server" functionality (like `listen` in Seneca transports), it is called like this because when it is used the Seneca instance will *handle* those messages, listening to an NSQ topic.
* `forward` is the "client" (like `client` in Seneca transports), it is called like this because when it is used the Seneca instance will *forward* those messages, publishing to an NSQ topic.

Both of them accept an options object, which can contain every option that can be passed to the `Reader` constructor from [nsqjs](https://github.com/dudleycarr/nsqjs) plus the following ones:

* `topic: string`: the NSQ topic used by this "service" (no default, this option is mandatory)
* `topicProperty: string`: the property of the message that will contain the topic, used to build the Seneca pattern handled by this plugin instance (default: `'role'`)
* `chan: null | string`: the NSQ channel (default is `null`, used for "forward" instances because they only publish, and for the "main" handler instance, see about request-reply below)
* `lookupdHTTPAddresses: Array<string>`: the array of nsqlookupd addresses (default `['127.0.0.1:4161']`)
* `writerNsqdHost: string`: the address of the nsqd used for publishing (default `'127.0.0.1'`)
* `writerNsqdPort: number`: the port of the nsqd used for publishing (default `4150`)
* `reply: boolean`: whether this topic supports the request-reply pattern (see below, default `false`)
* `replyBy: number`: the timeout for replies in milliseconds (default `20000`)
* `replyToProperty: string`: the message property used to carry the "reply to" NSQ topic (default `rt$`)
* `replyByProperty: string`: the message property used to carry the "reply by" value, which is also the request id (default `rb$`)
* `sharding: ShardingOptions | undefined`: description of how the topic is sharded (see below, default `undefined` for no sharding)
* `forwardDelay: number`: delay in milliseconds for NSQ writer connection (default `0`)
* `handleDelay: number`: delay in milliseconds for NSQ readers connection (default `0`)

From experience, the NSQ options you will want to set are:

* `maxInFlight` (the default of `1` makes no sense at all for throughput)
* `lookupdPollInterval` (too speed up service discovery)

`nsq-seneca` can be used like this:

```
// Send all actions matching {role: 'jobs'} to the NSQ topic 'jobs'
s.use(nsqt.forward, {topic: 'jobs'})

// This will go to NSQ topic 'jobs':
s.act({role: 'jobs', data: 'something to do...'})

// Listen to NSQ topic 'news' with role 'log'
// and "act" all those messages on the local seneca instance
s.use(nsqt.handle, {topic: 'news', chan: 'log'})

// Invoke `callback` for every message received on topic 'news' by channel 'log':
s.add({role: 'news', chan: 'log'}, callback)
```

This plugin can be used any number of times because it always returns a different name to Seneca.
Consider those functions like factories that create client and server plugin instances at will.


## A server is always also a client

Note that a Seneca instance that is acting as a handler for a particular topic will *always* publish messages to the NSQ topic first, and will handle them after having received them from NSQ.

More concretely, after a statement like `s.use(nsqt.handle, {topic: 'news', chan: 'log'})`, invoking `s.act({role: 'news', data: 'something to say'})` on the same Seneca instance will *not* act the message immediately on the local Seneca.
The message will be published remotely first.
This is necessary because otherwise other listeners to the same topic on different channels would not have a chance to consume it.
The NSQ semantics mandates this behavior, and this is one way in which `nsq-seneca` in *idiomatic NSQ* more than *idiomatic Seneca*.

When the message will be received, it will be acted on the local Seneca with a `'chan'` property that matches the channel that the handler was listening to.
In this way it is possible to "host" handlers for different channels on the same Seneca instance, and they will not interfere with each other because each of them can pick its own "version" of the message by channel.
What matters is that the `'add'` statements specify patterns that include the channel (like in the example above).

`nsq-seneca` prefers to be explicit about topics and channels instead of trying to be "network transparent" and hide the underlying NSQ.
It tries to make the most out of NSQ and its strengths (particularly its broadcast semantics to different channels), but this means that the programmer must be aware of the underlying NSQ.


## Request-reply pattern

NSQ does not support replies to messages, but Seneca does, and it can be useful.

`nsq-seneca` creates a unique, ephemeral *reply topic* for every plugin instance, and implements all the machinery needed so that Seneca handlers can reply in a Seneca idiomatic way (passing an error or a value to the callback) and everything will just work.

However, there's a catch: NSQ supports broadcasts to channels, but in practice Seneca expects a single reply for every "published" message.
By convention, we decided that *only* a single handler, that is listening on a channel that has the same name as the topic, can send a reply.
We call it the "main" handler, and it can be created implicitly by passing a `'null'` channel (which is the default, and is internally converted to having the same name as the topic anyway).

The internal implementation cleans up the timed out requests every 5 seconds for efficiency (so that we don't create a timer for every request), and the system is designed to scale to handle a lot of them.
Note that "every 5 seconds" does not mean that the timeout is 5 seconds: it is just the *granularity* of the timeout (TODO: make this granularity configurable).
In practice this builds a request-reply pattern on top of NSQ.


## Sharding 

All the above works perfectly for stateless services.
`nsq-seneca` also implements a form of sharding for *stateful* services.

TODO: document this :-)


## Development

`nsq-seneca` is implemented in Typescript.

The implementation for now is in a single file.
The build output is not checked into git but a `.npmignore` file takes care of including in the published package only the deeded files.

To do development a simple `npm install && typings install` will set everything up.
After that `npm run tsc` does a build, `npm run lint` runs the linter and `npm test` runs the tests (they don't need a build step).
