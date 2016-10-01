// import * as nsq from 'nsqjs'
import * as Seneca from 'seneca'
type Seneca = typeof Seneca

export interface NsqOptions {
  lookupdHost?: string,
  lookupdPort?: number,
  nsqdHost?: string,
  nsqdPort?: number
}

let nsqOptionsDefaults = {
  lookupdHost: '127.0.0.1',
  lookupdPort: 4161,
  nsqdHost: '127.0.0.1',
  nsqdPort: 4150
}

function fillNsqOptions (options: NsqOptions) : NsqOptions {
  let result = {} as NsqOptions
  for (let k of Object.keys(nsqOptionsDefaults)) {
    if (typeof options[k] === typeof nsqOptionsDefaults[k]) {
      result[k] = options[k]
    } else {
      result[k] = nsqOptionsDefaults[k]
    }
  }
  return result
}

export interface NsqForwarder {
  (this: Seneca) : Seneca
}

let internal = {
  readonly fillNsqOptions
}
export {
  internal as _
}
