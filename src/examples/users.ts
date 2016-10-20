process.on('SIGTERM', () => { process.exit(0) })
import * as Seneca from 'seneca'
import * as shortid from 'shortid'
import * as nsqt from '../nsqt'

import millisecondsToString from './millisecondsToString'
import shardedOptions from './shardedOptions'
let o = shardedOptions('areaId', 'area')

let s = Seneca({ timeout: 9999 })
s.use(nsqt.forward, o)

const AREAS = 5
const INTERVAL = 4000

let userId = 'user-' + shortid.generate().slice(-2)
let areaId = 'area-' + (Math.floor(Math.random() * AREAS) + 1)

s.ready((err) => {
  if (err) {
    console.log('Sececa ready error', err)
    process.exit(1)
  }

  console.log('Sececa ready')
  let action = () => {
    let now = millisecondsToString(Date.now())
    console.log(userId, '->', areaId, now)
    s.act({role: 'area', 'rt$': null, userId, areaId, time: now}, (err, rsp) => {
      if (err) {
        // console.log('ERROR', err)
      } else {
        console.log(rsp.userId, '<-', rsp.areaId, rsp.time, rsp.worker, rsp.users)
      }
    })
  }
  setInterval(action, INTERVAL)
})
