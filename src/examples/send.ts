process.on('SIGTERM', () => { process.exit(0) })
import * as Seneca from 'seneca'
import * as shortid from 'shortid'
import * as nsqt from '../nsqt'

import millisecondsToString from './millisecondsToString'
import defaultOptions from './defaultOptions'
let o = defaultOptions('job')
let worker = shortid.generate().slice(-2)

let s = Seneca({ timeout: 9999 })
s.use(nsqt.forward, o)

s.ready((err) => {
  if (err) {
    console.log('Sececa ready error', err)
    process.exit(1)
  }

  console.log('Sececa ready')
  let action = () => {
    let now = millisecondsToString(Date.now())
    console.log(worker, now, '->')
    s.act({role: 'job', 'rt$': null, time: now, id: worker}, (err, rsp) => {
      if (err) {
        console.log('ERROR', err)
      } else {
        console.log(worker, rsp.was, '<-', '(', rsp.time, rsp.id, ')')
      }
    })
  }
  setInterval(action, 1000)
})
