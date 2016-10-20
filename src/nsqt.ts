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

const EPHEMERAL = '#ephemeral'

export interface ShardingOptions {
  shardProperty: string
}

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

function fillNsqOptions (options: NsqOptions): NsqOptionsFilled {
  let result = {} as NsqOptions
  if (typeof options.topic === 'string') {
    result.topic = options.topic
  }
  for (let k of Object.keys(nsqOptionsDefaults)) {
    if (typeof options[k] !== 'undefined') {
      result[k] = options[k]
    } else {
      result[k] = nsqOptionsDefaults[k]
    }
  }
  return result as NsqOptionsFilled
}

function options (o: NsqOptions, topic: string, chan: string | null = null): NsqOptionsFilled {
  let result = fillNsqOptions(o)
  result.topic = topic
  result.chan = chan
  return result
}

function makePluginName (id: string, options: NsqOptionsFilled): string {
  let result = 'nsqt..' + id + '..' + options.topic
  if (typeof options.chan === 'string') {
    result += '..' + options.chan
  }
  return result
}

function makeBasePattern (options: NsqOptionsFilled): Object {
  let result = {}
  result[options.topicProperty] = options.topic
  return result
}

// Copied from npm module string-hash
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

function defaultComparer<T> (a: T, b: T): number {
  if (a === b) {
    return 0
  } else {
    return a < b ? -1 : 1
  }
}
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

interface PendingJob {
  replyBy: number
  done: (err: undefined | Error, msg?: any) => void
}

const SHARD_PERIOD_MILLISECONDS = 1000
const MAX_INACTIVE_SHARD_PERIODS = 3
const SETTLEMENT_SHARD_PERIODS = 5
const NO_MASTER = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'

export interface SeenShard {
  id: string
  inactivePeriods: number
  seenBy: {[id: string]: boolean}
}

export interface ActiveShard {
  id: string
  topic: string
  topics: Array<string>
}

export interface ShardStatus {
  id: string
  masterId: string
  generation: number
  quietPeriods: number
  topic: string
  seen: {
    [id: string]: SeenShard
  }
  active: Array<ActiveShard>
}

function isMaster (status: ShardStatus): boolean {
  return status.id === status.masterId
}

function isQuiet (status: ShardStatus): boolean {
  return status.quietPeriods > SETTLEMENT_SHARD_PERIODS
}

function getActiveShards(to: ShardStatus, from: ShardStatus): void {
  to.active.length = 0
  for (let activeShard of from.active) {
    to.active.push(activeShard)
  }
}

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

function makeShardTopic (topic: string, index: number) {
  return topic + '..' + index
}

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
function refreshActiveShards (status: ShardStatus): boolean {
  // Recompute active shards
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

  // Check if they are different
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

function getLastNow (lastNow: number): number {
  let now = Date.now()
  if (now > lastNow) {
    return now
  } else {
    return lastNow + 1
  }
}

const DONE = (err: undefined | Error, msg?: any): void => { return undefined }

function connect (this: Seneca.Instance, isHandler: boolean, options: NsqOptions): string {
  let s = this as SenecaInstance
  let o = fillNsqOptions(options)
  let id = shortid.generate()
  let pending = SortedArray.comparing<PendingJob>('replyBy', [])
  let replyTopic = o.topic + '..' + id + EPHEMERAL
  let channel = (typeof o.chan === 'string') ? o.chan : o.topic
  let canReply = channel === o.topic
  let shardsTopic = o.topic + '..' + 'SHARDS' + EPHEMERAL
  let shardStatus = initialShardState(id, o.topic)
  let shardReaders = [] as Array<nsq.Reader>
  let lastNow = 0
  let pluginName = makePluginName(id, o)
  let bp = makeBasePattern(o)
  s.log.info('INIT', pluginName)

  s.add({init: pluginName}, (args, done) => {
    let writerReady = false
    let writer = new nsq.Writer(o.writerNsqdHost, o.writerNsqdPort, {})
    setTimeout(() => { writer.connect() }, o.forwardDelay)
    writer.on(nsq.Writer.READY, () => {
      s.log.debug('NSQ writer READY:', pluginName)
      writerReady = true
      ready()
    })
    writer.on(nsq.Writer.CLOSED, () => {
      s.log.debug('NSQ writer CLOSED, reopening', pluginName)
      writer.connect()
    })
    writer.on(nsq.Writer.ERROR, (err) => {
      s.log.error('NSQ writer ERROR', err)
    })

    let replyReader = new nsq.Reader(replyTopic, id + EPHEMERAL, options)
    setTimeout(() => { replyReader.connect() }, o.handleDelay * 2)
    replyReader.on(nsq.Reader.MESSAGE, (msg) => {
      try {
        let m = msg.json()
        let replyBy = m[o.replyByProperty]
        let jobIndex = pending.search({replyBy, done: DONE})
        if (jobIndex > 0) {
          let job = pending.array[jobIndex]
          job.done(undefined, m)
          pending.removeAt(jobIndex)
        } else {
          s.log.warn('Reply job not found, replyBy ' + replyBy + ', topic ' + replyTopic)
        }
        msg.finish()
      } catch (e) {
        s.log.error(e)
        msg.requeue()
      }
    })
    replyReader.on(nsq.Reader.ERROR, (err) => { s.log.error(err) })

    function processMessage (m: Object, finish: () => void): void {
      if (canReply && m[o.replyToProperty]) {
        s.act(m, (error?: Error, result?: any): void => {
          if (error) {
            s.log.error(error)
            return
          }
          if (result) {
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
        s.act(m)
        // TODO: Do not mark the message as processed immediately, but after `act` is done.
        finish()
      }
    }

    function messageHandler (msg: nsq.Message): void {
      try {
        let m = msg.json()
        let shouldProcessMessage = true

        if (o.sharding !== undefined) {
          let shardsCount = shardStatus.active.length
          if (shardsCount > 0) {
            let shardHash = stringHash('' + m[o.sharding.shardProperty])
            let shardIndex = shardHash % shardsCount
            if (shardStatus.active[shardIndex].id !== id) {
              shouldProcessMessage = false
              msg.finish()
              writer.publish(shardStatus.active[shardIndex].topic, m)
            }
          } else {
            shouldProcessMessage = false
            msg.requeue()
          }
        }

        if (shouldProcessMessage) {
          m['chan'] = channel
          m['nsq$'] = {
            time: msg.timestamp,
            id: msg.id
          }
          processMessage(m, () => { msg.finish() })
        }
      } catch (e) {
        s.log.error(e)
        msg.requeue()
      }
    }

    function makeReader (topic: string, delay: boolean = false): nsq.Reader {
      let reader = new nsq.Reader(topic, channel, options)
      if (delay) {
        setTimeout(() => { reader.connect() }, o.handleDelay)
      } else {
        reader.connect()
      }
      reader.on(nsq.Reader.MESSAGE, messageHandler)
      reader.on(nsq.Reader.ERROR, (err) => { s.log.error(err) })
      return reader
    }

    function refreshShardReaders () {
      while (shardReaders.length > 0) {
        let reader = shardReaders.pop() as nsq.Reader
        reader.close()
      }
      for (let active of shardStatus.active) {
        if (active.id === id) {
          for (let topic of active.topics) {
            shardReaders.push(makeReader(topic))
          }
        }
      }
    }

    if (o.sharding !== undefined) {
      let shardsReader = new nsq.Reader(shardsTopic, id + EPHEMERAL, options)
      setTimeout(() => { shardsReader.connect() }, o.handleDelay * 2)
      shardsReader.on(nsq.Reader.MESSAGE, (msg) => {
        msg.finish()
        try {
          let m = msg.json() as ShardStatus
          let changed = updateShardStatus(shardStatus, m)
          if (changed && isHandler) {
            refreshShardReaders()
          }
        } catch (e) {
          s.log.error(e)
        }
      })
      shardsReader.on(nsq.Reader.ERROR, (err) => { s.log.error(err) })
    }

    if (isHandler) {
      makeReader(o.topic, true)
    }

    function handleShardPeriod () {
      let changed = shardPeriod(shardStatus, isHandler)
      if (isHandler) {
        if (changed) {
          refreshShardReaders()
        }
        writer.publish(shardsTopic, shardStatus)
      }
    }

    let initialized = false
    function ready () {
      if (writerReady && !initialized) {
        initialized = true
        setInterval(cleanupPending, 5000)

        if (o.sharding !== undefined) {
          setInterval(handleShardPeriod, SHARD_PERIOD_MILLISECONDS)
        }

        s.add(bp, (arg, reply) => {
          let msg = Object.assign({}, arg)
          let finished = false
          let finish = (err, response?) => {
            if (!finished) {
              finished = true
              reply(err, response)
            }
          }
          if (msg.chan === undefined) {
            let topic = o.topic
            let shardsCount = shardStatus.active.length
            if (o.sharding !== undefined && shardsCount > 0) {
              let shardHash = stringHash('' + msg[o.sharding.shardProperty])
              let shardIndex = shardHash % shardsCount
              topic = shardStatus.active[shardIndex].topic
            }

            if (o.reply || msg[o.replyToProperty] !== undefined) {
              let by = msg[o.replyByProperty]
              if (typeof by !== 'number') {
                by = o.replyBy
              }
              lastNow = getLastNow(lastNow)
              by += lastNow
              msg[o.replyByProperty] = by
              msg[o.replyToProperty] = replyTopic
              let job = {
                replyBy: by,
                done: finish
              }
              pending.insert(job)
              writer.publish(topic, msg, (err) => {
                if (err) {
                  finish(err)
                }
              })
            } else {
              writer.publish(topic, msg, (err) => { finish(err) })
            }
          } else {
            done(new Error('Cannot handle channel ' + msg.chan + ' in plugin ' + pluginName))
          }
        })
        done()
      }
    }

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

function forward (this: Seneca.Instance, options: NsqOptions): string {
  return connect.call(this, false, options)
}

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
  handle,
  internal as _
}
