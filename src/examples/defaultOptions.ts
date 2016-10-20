import * as nsqt from '../nsqt'
let options: nsqt.NsqOptions = {
  writerNsqdHost: 'nsqd',
  writerNsqdPort: 4150,
  forwardDelay: 50,
  handleDelay: 5000,
  lookupdHTTPAddresses: ['nsqlookupd:4161'],
  maxInFlight: 10000, // 1
  heartbeatInterval: 2, // 30
  maxBackoffDuration: 32, // 128
  lookupdPollInterval: 3, // 60
  requeueDelay: 15 // 90
}

function buildOptions (topic: string, chan: string | null = null): nsqt.NsqOptionsFilled {
  return nsqt.options(options, topic, chan)
}
export default buildOptions
