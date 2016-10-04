process.on('SIGTERM', () => { process.exit(0) })
import * as Seneca from 'seneca'
import * as nsqt from '../nsqt'

import defaultOptions from './defaultOptions'
let o = defaultOptions('t')

let s = Seneca()
s.use(nsqt.forward, o)

s.ready((err) => {
  if (err) {
    console.log('Sececa ready error', err)
    process.exit(1)
  }

  console.log('Sececa ready')
  let count = 1
  let action = () => {
    console.log('w1 sends count', count)
    s.act({role: 't', count: count})
    count++
  }
  setInterval(action, 1000)
})
