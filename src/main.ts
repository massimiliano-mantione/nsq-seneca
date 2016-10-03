import * as nsq from 'nsqjs'

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

export interface NsqOptions extends nsq.ReaderOptions {
  writerNsqdHost?: string,
  writerNsqdPort?: number,
  topic: string,
  topicProperty?: string,
  chan?: null | string,
  isHandler?: boolean
}
interface NsqOptionsFilled extends nsq.ReaderOptions {
  writerNsqdHost: string,
  writerNsqdPort: number,
  topic: string,
  topicProperty: string,
  chan: null | string,
  isHandler?: boolean
}

let nsqOptionsDefaults = {
  lookupdHTTPAddresses: ['127.0.0.1:4161'],
  writerNsqdHost: '127.0.0.1',
  writerNsqdPort: 4150,
  topicProperty: 'role',
  chan: null,
  isHandler: false
}

function fillNsqOptions (options: NsqOptions): NsqOptionsFilled {
  let result = { topic: options.topic } as NsqOptions
  for (let k of Object.keys(nsqOptionsDefaults)) {
    if (typeof options[k] !== 'undefined') {
      result[k] = options[k]
    } else {
      result[k] = nsqOptionsDefaults[k]
    }
  }
  return result as NsqOptionsFilled
}

function makePluginName (options: NsqOptionsFilled): string {
  let result = 'NSQ::' + options.topic
  if (options.chan) {
    result += '::' + options.chan
  }
  return result
}

function makeBasePattern (options: NsqOptionsFilled): Object {
  let result = {}
  result[options.topicProperty] = options.topic
  return result
}

function forward (this: Seneca.Instance, options: NsqOptions): Seneca.Instance {
  let s = this as SenecaInstance
  let o = fillNsqOptions(options)

  let pluginName = makePluginName(o)
  let bp = makeBasePattern(o)

  s.add({ init: pluginName}, (args, done) => {
    let writer = new nsq.Writer(o.writerNsqdHost, o.writerNsqdPort, {})
    writer.connect()
    writer.on(nsq.Writer.READY, () => {
      s.log.debug('NSQ writer READY:', pluginName)
      s.add(bp, (arg, done) => {
        if (arg.chan === undefined) {
          writer.publish(o.topic, arg, (err) => { done(err) })
        } else {
          done(new Error('Cannot handle channel ' + arg.chan + ' in plugin ' + pluginName))
        }
      })
      done()
    })
    writer.on(nsq.Writer.CLOSED, () => {
      s.log.debug('NSQ writer CLOSED, reopening')
      writer.connect()
    })
    writer.on(nsq.Writer.ERROR, (err) => {
      s.log.error('NSQ writer ERROR', err)
    })
  })
  return this
}

function handle (this: Seneca.Instance, options: NsqOptions): Seneca.Instance {
  let s = this as SenecaInstance
  let o = fillNsqOptions(options)

  let pluginName = makePluginName(o)
  let channel = (typeof o.chan === 'string') ? o.chan : o.topic

  s.add({ init: pluginName}, (args, done) => {
    let reader = new nsq.Reader(o.topic, channel, options)
    reader.connect()
    reader.on(nsq.Reader.MESSAGE, (msg) => {
      try {
        let m = msg.json()
        m['chan'] = channel
        m['nsq$'] = {
          time: msg.timestamp,
          id: msg.id
        }
        // TODO: For now, ignore async errors
        // s.do(m).then(() => {
        //   msg.finish()
        // }).catch((err) => {
        //   s.log.error(err)
        //   msg.requeue()
        // })
        s.act(m)
        msg.finish()
      } catch (e) {
        s.log.error(e)
        msg.requeue()
      }
    })
    reader.on(nsq.Reader.ERROR, (err) => { s.log.error(err) })
  })
  return this
}


let internal = {
  readonly fillNsqOptions,
  readonly makePluginName,
  readonly makeBasePattern
}
export {
  forward,
  handle,
  internal as _
}
