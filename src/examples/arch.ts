process.on('SIGTERM', () => { process.exit(0) })
import * as Seneca from 'seneca'
import * as shortid from 'shortid'
import * as nsqt from '../nsqt'

import millisecondsToString from './millisecondsToString'
import defaultOptions from './defaultOptions'
let o = defaultOptions('job', 'arch')
let worker = shortid.generate().slice(-2)

let s = Seneca({ timeout: 9999 })
s.use(nsqt.handle, o)

s.ready((err) => {
  if (err) {
    console.log('Sececa ready error', err)
    process.exit(1)
  }

  console.log('Sececa ready')

  s.add({role: 'job', chan: 'arch'}, (msg, done) => {
    let now = millisecondsToString(Date.now())
    console.log(worker, 'archives', msg.time, 'from', msg.id, 'at', now)
    done()
  })
})
