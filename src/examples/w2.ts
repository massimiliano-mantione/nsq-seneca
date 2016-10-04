process.on('SIGTERM', () => { process.exit(0) })
import * as Seneca from 'seneca'
import * as nsqt from '../nsqt'

import defaultOptions from './defaultOptions'
let o = defaultOptions('t')

let s = Seneca()
s.use(nsqt.handle, o)

s.ready((err) => {
  if (err) {
    console.log('Sececa ready error', err)
    process.exit(1)
  }

  console.log('Sececa ready')
  s.add({role: 't', chan: 't'}, (msg, done) => {
    console.log('w2 gets count', msg.count)
    done()
  })
})
