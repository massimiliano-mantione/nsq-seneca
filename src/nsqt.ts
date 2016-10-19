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

export interface NsqOptions extends nsq.ReaderOptions {
  writerNsqdHost?: string,
  writerNsqdPort?: number,
  topic?: string,
  topicProperty?: string,
  chan?: null | string,
  reply?: boolean,
  replyBy?: number,
  replyToProperty?: string,
  replyByProperty?: string,
  forwardDelay?: number,
  handleDelay?: number
}
export interface NsqOptionsFilled extends nsq.ReaderOptions {
  writerNsqdHost: string,
  writerNsqdPort: number,
  topic: string,
  topicProperty: string,
  chan: null | string,
  reply: boolean,
  replyBy: number,
  replyToProperty: string,
  replyByProperty: string,
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

// const SHARD_PERIOD_MILLISECONDS = 1000
const MAX_INACTIVE_SHARD_PERIODS = 3
const SETTLEMENT_SHARD_PERIODS = 5
const NO_MASTER = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'

export interface SeenShard {
  id: string
  inactivePeriods: number
  seenBy: {[id: string]: boolean}
}

export interface ShardStatus {
  id: string
  masterId: string
  generation: number
  quietPeriods: number
  seen: {
    [id: string]: SeenShard
  }
  active: Array<string>
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

function initialShardState (id: string): ShardStatus {
  return {
    id: id,
    masterId: NO_MASTER,
    generation: 1,
    quietPeriods: 0,
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
    if (status.masterId !== received.masterId) {
      status.masterId = received.masterId
      status.generation = received.generation
      getActiveShards(status, received)
      result = true
    }
  }

  return result
}

// Returns true if the active shards have changed
function refreshActiveShards (status: ShardStatus): boolean {
  // Recompute active shards
  let newActive = [] as Array<string>
  for (let id of Object.keys(status.seen)) {
    newActive.push(id)
  }
  newActive.sort()

  // Check if they are different
  let newIsDifferent = status.active.length !== newActive.length
  if (! newIsDifferent) {
    for (let i = 0; i < newActive.length; i++) {
      if (status.active[i] !== newActive[i]) {
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
function shardPeriod (status: ShardStatus): boolean {
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
  if (isQuiet(status) && ! isMaster(status) && status.seen[status.id] !== undefined) {
    if (status.active.length === 0 || status.active[0] > status.id) {
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
    setTimeout(() => { replyReader.connect() }, o.handleDelay)
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

    if (isHandler) {
      let reader = new nsq.Reader(o.topic, channel, options)
      setTimeout(() => { reader.connect() }, o.handleDelay)
      reader.on(nsq.Reader.MESSAGE, (msg) => {
        try {
          let m = msg.json()
          m['chan'] = channel
          m['nsq$'] = {
            time: msg.timestamp,
            id: msg.id
          }
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
                msg.finish()
              } else {
                s.log.warn('Empty reply, reply to: ', m[o.replyToProperty], 'reply by: ', m[o.replyByProperty])
              }
            })
          } else {
            s.act(m)
            // TODO: Do not mark the message as processed immediately, but after `act` is done.
            msg.finish()
          }
        } catch (e) {
          s.log.error(e)
          msg.requeue()
        }
      })
      reader.on(nsq.Reader.ERROR, (err) => { s.log.error(err) })
    }

    let initialized = false
    function ready () {
      if (writerReady && !initialized) {
        initialized = true
        setTimeout(cleanupPending, 5000)

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
              writer.publish(o.topic, msg, (err) => {
                if (err) {
                  finish(err)
                }
              })
            } else {
              writer.publish(o.topic, msg, (err) => { finish(err) })
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
