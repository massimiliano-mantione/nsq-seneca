process.on('SIGTERM', () => { process.exit(0) })
import * as Seneca from 'seneca'
import * as shortid from 'shortid'
import * as nsqt from '../nsqt'

import millisecondsToString from './millisecondsToString'
import shardedOptions from './shardedOptions'
let o = shardedOptions('areaId', 'area')

let s = Seneca({ timeout: 9999 })
s.use(nsqt.handle, o)

const UPDATE_PERIOD = 5000
const MAX_IDLE_PERIODS = 3

interface AreaUser {
  userId: string
  time: string
  idlePeriods: number
}

interface AreaUsers {
  [userId: string]: AreaUser
}

interface Area {
  areaId: string
  users: AreaUsers
}

interface Areas {
  [areaId: string]: Area
}

let worker = shortid.generate().slice(-2)

function updateUser (areas: Areas, areaId: string, userId: string, time: string): AreaUser {
  let area = areas[areaId]
  if (area === undefined) {
    area = {
      areaId,
      users: {}
    }
  }
  areas[areaId] = area

  let user = area.users[userId]
  if (user === undefined) {
    user = {
      userId,
      time,
      idlePeriods: 0
    }
  }
  area.users[userId] = user

  user.time = time
  user.idlePeriods = 0
  return user
}

function processPeriod (areas: Areas): void {
  let areaIds = Object.keys(areas)
  if (areaIds.length === 0) {
    console.log('no areas')
  }
  for (let k of areaIds) {
    let area = areas[k]

    for (let u of Object.keys(area.users)) {
      let user = area.users[u]
      user.idlePeriods += 1
      if (user.idlePeriods > MAX_IDLE_PERIODS) {
        console.log(' --- area', k, 'user', u, 'removed')
        delete area.users[u]
      }
    }

    let userIds = Object.keys(area.users)
    if (userIds.length > 0) {
      console.log(
        'area:', k,
        'users:', userIds.map((uid) => { return uid + ':' + area.users[uid].idlePeriods }).join(' '))
    } else {
      console.log(' --- area', k, 'removed')
      delete areas[k]
    }
  }
}

s.ready((err) => {
  if (err) {
    console.log('Sececa ready error', err)
    process.exit(1)
  }

  console.log('Sececa ready')

  let areas: Areas = {}

  s.add({role: 'area', chan: 'area'}, (msg, done) => {
    let {areaId, userId, time} = msg
    updateUser(areas, areaId, userId, time)
    done(undefined, {areaId, userId, time, worker, now: millisecondsToString(Date.now())})
  })

  setInterval(() => { processPeriod(areas) }, UPDATE_PERIOD)
})
