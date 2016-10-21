import * as nsq from 'nsqjs'
import * as shortid from 'shortid'

import * as Seneca from 'seneca'
interface Logger {
  (msg: any, ...params: any[]): void
}
interface SenecaInstance extends Seneca.Instance {
  log: {
    debug: Logger;
    info: Logger;
    warn: Logger;
    error: Logger;
    fatal: Logger;
  }
}

// Suffix for NSQ ephemeral topics and channels
const EPHEMERAL = '#ephemeral'

// Used to control sharding of a topic
export interface ShardingOptions {
  // The message property used to pick the shard
  shardProperty: string
}

// Options for the connector
export interface NsqOptions extends nsq.ReaderOptions {
  lookupdHTTPAddresses?: Array<string>,
  writerNsqdHost?: string,
  writerNsqdPort?: number,
  topic?: string,
  topicProperty?: string,
  chan?: null | string,
  reply?: boolean,
  replyBy?: number,
  replyToProperty?: string,
  replyByProperty?: string,
  sharding?: ShardingOptions,
  forwardDelay?: number,
  handleDelay?: number
}

// Options for the connector after defaults have been applied
export interface NsqOptionsFilled extends nsq.ReaderOptions {
  lookupdHTTPAddresses: Array<string>,
  writerNsqdHost: string,
  writerNsqdPort: number,
  topic: string,
  topicProperty: string,
  chan: null | string,
  reply: boolean,
  replyBy: number,
  replyToProperty: string,
  replyByProperty: string,
  sharding: ShardingOptions | undefined,
  forwardDelay: number,
  handleDelay: number
}

// Default values for options
let nsqOptionsDefaults = {
  lookupdHTTPAddresses: ['127.0.0.1:4161'],
  writerNsqdHost: '127.0.0.1',
  writerNsqdPort: 4150,
  topicProperty: 'role',
  chan: null,
  reply: false,
  replyBy: 20000,
  replyToProperty: 'rt$',
  replyByProperty: 'rb$',
  sharding: undefined,
  forwardDelay: 0,
  handleDelay: 0
}

// Apply default values
function fillNsqOptions (options: NsqOptions): NsqOptionsFilled {
  let result = Object.assign({}, options) as NsqOptions
  if (typeof options.topic === 'string') {
    result.topic = options.topic
  }
  for (let k of Object.keys(nsqOptionsDefaults)) {
    if (typeof options[k] === 'undefined') {
      result[k] = nsqOptionsDefaults[k]
    }
  }
  return result as NsqOptionsFilled
}

// Utility to build options for a specific topic and channel
// (it is likely common to share options between services)
function options (o: NsqOptions, topic: string, chan: string | null = null): NsqOptionsFilled {
  let result = fillNsqOptions(o)
  result.topic = topic
  result.chan = chan
  return result
}

// Generate a name for the Seneca plugin
function makePluginName (id: string, options: NsqOptionsFilled): string {
  let result = 'nsqt..' + id + '..' + options.topic
  if (typeof options.chan === 'string') {
    result += '..' + options.chan
  }
  return result
}

// Generate the Seneca pattern for this connector
// (the connector will handle actions matching this pattern)
function makeBasePattern (options: NsqOptionsFilled): Object {
  let result = {}
  result[options.topicProperty] = options.topic
  return result
}

// Copied from npm module string-hash
// (used when picking shards from property values)
function stringHash (str: string): number {
  let hash = 5381
  let i = str.length

  while (i) {
    hash = (hash * 33) ^ str.charCodeAt(--i)
  }

  /* JavaScript does bitwise operations (like XOR, above) on 32-bit signed
   * integers. Since we want the results to be always positive, convert the
   * signed int to an unsigned by doing an unsigned bitshift. */
  return hash >>> 0
}

// Comparer that works for strings and numbers
function defaultComparer<T> (a: T, b: T): number {
  if (a === b) {
    return 0
  } else {
    return a < b ? -1 : 1
  }
}

// Used for the table of pending jobs (actions waiting for a reply)
// Keeping the table sorted allows us to find jobs by binary search
class SortedArray<T> {
  array: Array<T>
  compare: (a: T, b: T) => number

  constructor (array?: Array<T>, compare?: (a: T, b: T) => number) {
    this.array = []
    this.compare = compare || defaultComparer
    if (array) {
      for (let e of array) {
        this.insert(e)
      }
    }
  }

  // Returns a SortedArray that sorts objects on a given property
  // (starts filled with the elements of the provided array)
  static comparing<T>(property: string, array: Array<T>) {
    let comparer = (a: T, b: T): number => {
      let pa = a[property]
      let pb = b[property]
      if (pa === pb) {
        return 0
      } else {
        return pa < pb ? -1 : 1
      }
    }
    return new SortedArray(array, comparer)
  }

  insert(element) {
    let array   = this.array
    let compare = this.compare
    let index   = array.length
    array.push(element)
    while (index > 0) {
      let i = index
      index--
      let j = index
      if (compare(array[i], array[j]) < 0) {
        let temp = array[i]
        array[i] = array[j]
        array[j] = temp
      }
    }
  }

  removeAt(index: number) {
    this.array.splice(index, 1)
  }

  search(element: T): number {
    let array = this.array
    let compare = this.compare
    let high = array.length
    let low = 0

    while (high > low) {
      let index = (high + low) / 2 >>> 0
      let ordering = compare(array[index], element)
      if (ordering < 0) {
        low  = index + 1
      } else if (ordering > 0) {
        high = index
      } else {
        return index
      }
    }

    return -1
  }
}

// An action waiting for a reply
interface PendingJob {
  // The time by which the reply is due (milliseconds comparable with Date.now())
  replyBy: number
  // The callback to invoke when we get the reply (or to signal a timeout)
  done: (err: undefined | Error, msg?: any) => void
}

// These constants could be moved into ShardingOptions
// Time interval for shard announcement
const SHARD_PERIOD_MILLISECONDS = 1000
// Inactivity periods after which a shard is considered dead
const MAX_INACTIVE_SHARD_PERIODS = 3
// Periods to wait before officially changing the active shards
// (during these periods no shard must appear or disappear)
// (used to avoid repeated quick changes when shards come and go)
const SETTLEMENT_SHARD_PERIODS = 5
// Bogus shard id to say we have no master
const NO_MASTER = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'

// A shard, as received on the broadcast channel
export interface SeenShard {
  id: string
  inactivePeriods: number
  seenBy: {[id: string]: boolean}
}

// A shard that is accepting messages (nominated by the master)
export interface ActiveShard {
  id: string
  topic: string
  topics: Array<string>
}

// The main table of all known shards
export interface ShardStatus {
  // The id of "this" shard or worker
  id: string
  // The id of the master
  masterId: string
  // The number of times that this master has changed the active shards
  generation: number
  // The periods elapsed with no changes in the seen shards
  quietPeriods: number
  // The topic of this shard set
  topic: string
  // The table of known shards
  seen: {
    [id: string]: SeenShard
  }
  // The table of active shards (by shard index)
  active: Array<ActiveShard>
}

// Returns true if we are the master
function isMaster (status: ShardStatus): boolean {
  return status.id === status.masterId
}

// Returns true if we had enough quiet periods
function isQuiet (status: ShardStatus): boolean {
  return status.quietPeriods > SETTLEMENT_SHARD_PERIODS
}

// Get the active shards from a received shard status
// (typically because the received one is the master)
function getActiveShards(to: ShardStatus, from: ShardStatus): void {
  to.active.length = 0
  for (let activeShard of from.active) {
    to.active.push(activeShard)
  }
}

// Build the initial state
function initialShardState (id: string, topic: string): ShardStatus {
  return {
    id: id,
    masterId: NO_MASTER,
    generation: 1,
    quietPeriods: 0,
    topic: topic,
    seen: {},
    active: []
  }
}

// Returns true if the active shards have changed
function updateShardStatus (status: ShardStatus, received: ShardStatus): boolean {
  let result = false
  let receivedId = received.id

  // State that we see the sender
  let seenShard = status.seen[receivedId]
  if (seenShard === undefined) {
    seenShard = {
      id: receivedId,
      inactivePeriods: 0,
      seenBy: {}
    }
    // TODO: This is true, but should be useless
    // seenSender.seenBy[status.id] = true
    status.seen[receivedId] = seenShard
    // We added a new shard: the period is not quiet
    received.quietPeriods = 0
  } else {
    // We have seen the shard, so it is active
    seenShard.inactivePeriods = 0
  }

  // If the seen shard is not quiet, join it in waiting for settlement
  if (received.quietPeriods > 1 && received.quietPeriods < status.quietPeriods) {
    status.quietPeriods = received.quietPeriods - 1
  }

  // Track who is seen by the received shard 
  for (let id of Object.keys(received.seen)) {
    let shard = status.seen[id]
    if (shard !== undefined) {
      shard.seenBy[receivedId] = true
    }
  }

  // Track who is not seen by the received shard 
  for (let id of Object.keys(status.seen)) {
    let shard = status.seen[id]
    if (shard.seenBy[receivedId] && ! received.seen[id]) {
      delete shard.seenBy[receivedId]
    }
  }

  // Check if we should not be the master anymore
  if (isMaster(status) &&
      received.masterId < status.id &&
      status.seen[received.masterId] &&
      isQuiet(status)) {
    // Give up master status
    status.masterId = received.masterId
    // Immediately update the active shards
    getActiveShards(status, received)
    result = true
  }

  // If we are not the master...
  if (! isMaster(status)) {
    // ...check if we must update the active shards
    if (status.masterId !== received.masterId || status.generation !== received.generation) {
      status.masterId = received.masterId
      status.generation = received.generation
      getActiveShards(status, received)
      result = true
    }
  }

  return result
}

// Build a topic name for a given shard index
function makeShardTopic (topic: string, index: number) {
  return topic + '..' + index
}

// Compare two active shards
// (used to pick the master: the lower one will be master)
function activeShardComparer (a: ActiveShard, b: ActiveShard): number {
  if (a.id > b.id) {
    return 1
  } else if (a.id < b.id) {
    return -1
  } else {
    return 0
  }
}

// Returns true if the active shards have changed
// (invoked only by the master)
function refreshActiveShards (status: ShardStatus): boolean {
  // Recompute active shards (out of the seen ones)
  let newActive = [] as Array<ActiveShard>
  for (let id of Object.keys(status.seen)) {
    newActive.push({
      id: id,
      topic: '',
      topics: []
    })
  }
  newActive.sort(activeShardComparer)
  let shardsCount = newActive.length
  for (let shardIndex = 0; shardIndex < shardsCount; shardIndex ++) {
    let shard = newActive[shardIndex]
    shard.topic = makeShardTopic(status.topic, shardIndex)
    shard.topics.push(shard.topic)
    shard.topics.push(makeShardTopic(status.topic, shardIndex + shardsCount))
    shard.topics.push(makeShardTopic(status.topic, shardIndex + (shardsCount + 2)))
  }

  // Check if they are different (from the current active ones)
  let newIsDifferent = status.active.length !== newActive.length
  if (! newIsDifferent) {
    for (let i = 0; i < newActive.length; i++) {
      if (status.active[i].id !== newActive[i].id) {
        newIsDifferent = true
        break
      }
    }
  }

  // If they are different, perform the change
  if (newIsDifferent) {
    status.generation += 1
    status.active = newActive
  }

  return newIsDifferent
}

// Returns true if the active shards have changed
// (should be invoked every SHARD_PERIOD_MILLISECONDS)
function shardPeriod (status: ShardStatus, isHandler: boolean): boolean {
  let result = false

  // Increment quiet periods
  status.quietPeriods += 1

  // Check if there are shards that we don't see anymore
  for (let id of Object.keys(status.seen)) {
    let shard = status.seen[id]
    shard.inactivePeriods += 1
    if (shard.inactivePeriods > MAX_INACTIVE_SHARD_PERIODS) {
      delete status.seen[id]
      // We removed a shard: the period is not quiet
      status.quietPeriods = 0
    }
  }

  // Check if we should become the master
  if (isHandler && isQuiet(status) && ! isMaster(status) && status.seen[status.id] !== undefined) {
    if (status.active.length === 0 || status.active[0].id > status.id) {
      // Become master
      status.masterId = status.id
      status.generation = 0
      refreshActiveShards(status)
      result = true
    }
  }

  // If we are the master and something changed recently, eventually refresh the active shards
  if (isMaster(status) && ! isQuiet(status)) {
    result = refreshActiveShards(status)
  }

  return result
}

// Returns a unique timestamp to use as id for jobs needing a reply
function getLastNow (lastNow: number): number {
  let now = Date.now()
  if (now > lastNow) {
    return now
  } else {
    return lastNow + 1
  }
}

// Dummy "done" function
const DONE = (err: undefined | Error, msg?: any): void => { return undefined }

// This function implements a valid Seneca plugin
// (therefore it returns the plugin name)
function connect (this: Seneca.Instance, isHandler: boolean, options: NsqOptions): string {
  // Seneca instance
  let s = this as SenecaInstance
  // Options (with applied defaults)
  let o = fillNsqOptions(options)
  // Unique id for this server (and eventually shard)
  let id = shortid.generate()
  // Table of actions waiting for a reply
  let pending = SortedArray.comparing<PendingJob>('replyBy', [])
  // NSQ topic where replies must be sent
  let replyTopic = o.topic + '..' + id + EPHEMERAL
  // NSQ channel for this message handler
  let channel = (typeof o.chan === 'string') ? o.chan : o.topic
  // Only the "main" channel can send replies
  let canReply = channel === o.topic
  // Topic for shard status broadcast
  let shardsTopic = o.topic + '..' + 'SHARDS' + EPHEMERAL
  // Shards status
  let shardStatus = initialShardState(id, o.topic)
  // Readers for our shard, and eventual "upper" shards
  // (shards with index over the last current one might need to be "drained")
  let shardReaders = [] as Array<nsq.Reader>
  // Last used id (timestamp) for actions waiting for a reply
  let lastNow = 0
  // The Seneca plugin name
  let pluginName = makePluginName(id, o)
  // The pattern handled by this connector
  let bp = makeBasePattern(o)
  s.log.info('INIT', pluginName)

  s.add({init: pluginName}, (args, done) => {
    // Create an NSQ writer
    let writerReady = false
    let writer = new nsq.Writer(o.writerNsqdHost, o.writerNsqdPort, {})
    setTimeout(() => { writer.connect() }, o.forwardDelay)
    writer.on(nsq.Writer.READY, () => {
      s.log.debug('NSQ writer READY:', pluginName)
      writerReady = true
      // The plugin will be initialized when the writer is ready
      // (before sending messages would be impossible)
      ready()
    })
    writer.on(nsq.Writer.CLOSED, () => {
      s.log.debug('NSQ writer CLOSED, reopening', pluginName)
      writer.connect()
    })
    writer.on(nsq.Writer.ERROR, (err) => {
      s.log.error('NSQ writer ERROR', err)
    })

    // NSQ reader for action replies
    let replyReader = new nsq.Reader(replyTopic, id + EPHEMERAL, options)
    setTimeout(() => { replyReader.connect() }, o.handleDelay * 2)
    replyReader.on(nsq.Reader.MESSAGE, (msg) => {
      try {
        let m = msg.json()
        let replyBy = m[o.replyByProperty]
        // Look for a matching pending job
        let jobIndex = pending.search({replyBy, done: DONE})
        if (jobIndex > 0) {
          let job = pending.array[jobIndex]
          // Resolve the action
          job.done(undefined, m)
          pending.removeAt(jobIndex)
        } else {
          s.log.warn('Reply job not found, replyBy ' + replyBy + ', topic ' + replyTopic)
        }
        // This NSQ message has been processed
        msg.finish()
      } catch (e) {
        s.log.error(e)
        msg.requeue()
      }
    })
    replyReader.on(nsq.Reader.ERROR, (err) => { s.log.error(err) })

    // Process an incoming message
    function processMessage (m: Object, finish: () => void): void {
      // Check if we can reply, and the message expects a reply
      // (it has a property with the topic where the reply must be sent)
      if (canReply && m[o.replyToProperty]) {
        // Invoke the action
        s.act(m, (error?: Error, result?: any): void => {
          if (error) {
            s.log.error(error)
            return
          }
          if (result) {
            // Send the reply back to the reply topic
            result[o.replyByProperty] = m[o.replyByProperty]
            writer.publish(m[o.replyToProperty], result, (err) => {
              if (err) {
                s.log.error('Error publishing reply: ' + err)
              }
            })
            finish()
          } else {
            s.log.warn('Empty reply, reply to: ', m[o.replyToProperty], 'reply by: ', m[o.replyByProperty])
          }
        })
      } else {
        // No reply to handle, just invoke the action
        s.act(m)
        // TODO: Do not mark the message as processed immediately, but after `act` is done.
        finish()
      }
    }

    // Handle an incoming NSQ message
    function messageHandler (msg: nsq.Message): void {
      try {
        let m = msg.json()
        // By default we should process the message
        let shouldProcessMessage = true

        // Check if we are handling a shard
        if (o.sharding !== undefined) {
          // Get the number of active shards
          let shardsCount = shardStatus.active.length
          if (shardsCount > 0) {
            // Find the shard index for this message
            let shardHash = stringHash('' + m[o.sharding.shardProperty])
            let shardIndex = shardHash % shardsCount
            // Check that it is our own shard
            if (shardStatus.active[shardIndex].id !== id) {
              // If it is not, republish the message on the right shard topic
              shouldProcessMessage = false
              msg.finish()
              writer.publish(shardStatus.active[shardIndex].topic, m)
            }
          } else {
            // No shard active, refuse the message
            // (hopefully there will be active shards in the future)
            shouldProcessMessage = false
            msg.requeue()
          }
        }

        if (shouldProcessMessage) {
          // Add channel so that "user" patterns will match
          m['chan'] = channel
          // Add some NSQ metadata
          m['nsq$'] = {
            time: msg.timestamp,
            id: msg.id
          }
          // Perform the processing
          processMessage(m, () => { msg.finish() })
        }
      } catch (e) {
        s.log.error(e)
        msg.requeue()
      }
    }

    // Create a reader that handles messages on a given topic
    function makeReader (topic: string, delay: boolean = false): nsq.Reader {
      let reader = new nsq.Reader(topic, channel, options)
      if (delay) {
        // Wait so that it is more likely thta the topic will be already there 
        setTimeout(() => { reader.connect() }, o.handleDelay)
      } else {
        reader.connect()
      }
      reader.on(nsq.Reader.MESSAGE, messageHandler)
      reader.on(nsq.Reader.ERROR, (err) => { s.log.error(err) })
      return reader
    }

    // Recreate all readers processing our shard
    // (and the "upper" inactive ones for draining)
    function refreshShardReaders () {
      // Close all current shard readers
      while (shardReaders.length > 0) {
        let reader = shardReaders.pop() as nsq.Reader
        reader.close()
      }
      // Create the new ones
      for (let active of shardStatus.active) {
        if (active.id === id) {
          for (let topic of active.topics) {
            shardReaders.push(makeReader(topic))
          }
        }
      }
    }

    // If we are sharding
    if (o.sharding !== undefined) {
      // Create the reader for the status broadcast (and master "election")
      let shardsReader = new nsq.Reader(shardsTopic, id + EPHEMERAL, options)
      setTimeout(() => { shardsReader.connect() }, o.handleDelay * 2)
      shardsReader.on(nsq.Reader.MESSAGE, (msg) => {
        msg.finish()
        try {
          let m = msg.json() as ShardStatus
          // Update status according to the received one
          let changed = updateShardStatus(shardStatus, m)
          if (changed && isHandler) {
            // Eventually recreate shard readers
            refreshShardReaders()
          }
        } catch (e) {
          s.log.error(e)
        }
      })
      shardsReader.on(nsq.Reader.ERROR, (err) => { s.log.error(err) })
    }

    if (isHandler) {
      // Alwais listen to the "proper" topic, even if we are a shard
      // (messages will then be routed to the right shard anyway)
      makeReader(o.topic, true)
    }

    // Periodically (every SHARD_PERIOD_MILLISECONDS)
    function handleShardPeriod () {
      let changed = shardPeriod(shardStatus, isHandler)
      if (isHandler) {
        if (changed) {
          refreshShardReaders()
        }
        // Broadcast our status
        writer.publish(shardsTopic, shardStatus)
      }
    }

    // Actually initialize Seneca the plugin
    let initialized = false
    function ready () {
      if (writerReady && !initialized) {
        initialized = true
        // Periodically cleanup jobs waiting for a reply
        setInterval(cleanupPending, 5000)

        // Handle sharding
        if (o.sharding !== undefined) {
          setInterval(handleShardPeriod, SHARD_PERIOD_MILLISECONDS)
        }

        // Register the pattern on Seneca
        s.add(bp, (arg, reply) => {
          let msg = Object.assign({}, arg)
          let finished = false
          let finish = (err, response?) => {
            if (!finished) {
              finished = true
              reply(err, response)
            }
          }

          // Messages are created without channel
          // (it is NSQ that broadcasts to channels, not Seneca)
          if (msg.chan === undefined) {
            let topic = o.topic
            let shardsCount = shardStatus.active.length
            if (o.sharding !== undefined && shardsCount > 0) {
              let shardHash = stringHash('' + msg[o.sharding.shardProperty])
              let shardIndex = shardHash % shardsCount
              topic = shardStatus.active[shardIndex].topic
            }

            // Handle actions waiting for a reply
            if (o.reply || msg[o.replyToProperty] !== undefined) {
              // Determine reply timeout
              let by = msg[o.replyByProperty]
              if (typeof by !== 'number') {
                by = o.replyBy
              }
              // Determine reply by time (used as job id)
              lastNow = getLastNow(lastNow)
              by += lastNow
              // Set job id and reply topic on message
              msg[o.replyByProperty] = by
              msg[o.replyToProperty] = replyTopic
              // Put job in the pending jobs table
              let job = {
                replyBy: by,
                done: finish
              }
              pending.insert(job)
              // Send the message
              writer.publish(topic, msg, (err) => {
                if (err) {
                  finish(err)
                }
              })
            } else {
              // No reply needed, just send the message
              writer.publish(topic, msg, (err) => { finish(err) })
            }
          } else {
            done(new Error('Cannot handle channel ' + msg.chan + ' in plugin ' + pluginName))
          }
        })
        done()
      }
    }

    // Remove jobs for which the "replyBy" has passed
    // (and raise a time out error)
    function cleanupPending () {
      let now = Date.now()
      let array = pending.array
      while (array.length > 0 && array[0].replyBy < now) {
        let job = array.shift() as PendingJob
        job.done(new Error('Message timed out, replyBy ' + job.replyBy + ', topic ' + replyTopic))
      }
    }

  })

  return pluginName
}

// Utility function: create a plugin that does not handle messages
// (it just sends them to the proper topic)
// (like a "client" for a Seneca transport)
function forward (this: Seneca.Instance, options: NsqOptions): string {
  return connect.call(this, false, options)
}

// Utility function: create a plugin that actually handles messages
// (like a "listen" for a Seneca transport)
function handle (this: Seneca.Instance, options: NsqOptions): string {
  return connect.call(this, true, options)
}

let internal = {
  readonly fillNsqOptions,
  readonly makePluginName,
  readonly makeBasePattern,
  readonly initialShardState,
  readonly isMaster,
  readonly updateShardStatus,
  readonly refreshActiveShards,
  readonly shardPeriod,
  readonly SortedArray,
  readonly MAX_INACTIVE_SHARD_PERIODS,
  readonly SETTLEMENT_SHARD_PERIODS,
  readonly NO_MASTER
}
export {
  connect,
  options,
  forward,
  forward as client,
  handle,
  handle as listen,
  internal as _
}
