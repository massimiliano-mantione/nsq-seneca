process.on('SIGTERM', () => { process.exit(0) })
import * as Seneca from 'seneca'
import * as nsqt from '../nsqt'

import millisecondsToString from './millisecondsToString'
import shardedOptions from './shardedOptions'
let o = shardedOptions('areaId', 'area')

let s = Seneca()
s.use(nsqt.forward, o)

const AREAS = 3
const USERS = 5
const INTERVAL = 5000

function areaFromUser (user: number): number {
  let area = AREAS
  while (user % area !== 0) {
    area -= 1
  }
  return area
}

s.ready((err) => {
  if (err) {
    console.log('Sececa ready error', err)
    process.exit(1)
  }

  console.log('Sececa ready')
  let action = () => {
    let now = millisecondsToString(Date.now())
    for (let user = 1; user <= USERS; user++) {
      let userId = 'user-' + user
      let areaId = 'area-' + areaFromUser(user)
      console.log(' -> SEND', userId, areaId, now)
      s.act({role: 'area', 'rt$': null, userId, areaId, time: now}, (err, rsp) => {
        if (err) {
          // console.log('ERROR', err)
        } else {
          console.log(' <- RECV', rsp.userId, rsp.areaId, rsp.time, rsp.worker, rsp.now)
        }
      })

    }
  }
  setInterval(action, INTERVAL)
})
