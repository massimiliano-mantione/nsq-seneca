import * as chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
chai.use(chaiAsPromised)
let expect = chai.expect

import * as main from '../nsqt'
let {
  fillNsqOptions,
  makePluginName,
  makeBasePattern
} = main._

describe('NSQ transport internals', () => {
  it('Fills defaults', () => {
    let o = fillNsqOptions({ topic: 't' })
    expect(o.lookupdHTTPAddresses).to.deep.equal(['127.0.0.1:4161'])
    expect(o.writerNsqdHost).to.equal('127.0.0.1')
    expect(o.writerNsqdPort).to.equal(4150)
    expect(o.topic).to.equal('t')
    expect(o.topicProperty).to.equal('role')
    expect(o.chan).to.equal(null)
    expect(o.forwardDelay).to.equal(0)
    expect(o.handleDelay).to.equal(0)
  })

  it('Fills defaults keeping provided values', () => {
    let o = fillNsqOptions({ topic: 't', chan: 'c', forwardDelay: 1000 })
    expect(o.lookupdHTTPAddresses).to.deep.equal(['127.0.0.1:4161'])
    expect(o.writerNsqdHost).to.equal('127.0.0.1')
    expect(o.writerNsqdPort).to.equal(4150)
    expect(o.topic).to.equal('t')
    expect(o.topicProperty).to.equal('role')
    expect(o.chan).to.equal('c')
    expect(o.forwardDelay).to.equal(1000)
    expect(o.handleDelay).to.equal(0)
  })

  it('Builds plugin names', () => {
    let o = fillNsqOptions({ topic: 't' })
    let name = makePluginName('forward', o)
    expect(name).to.equal('nsqt::forward::t')
  })

  it('Builds plugin names with channels', () => {
    let o = fillNsqOptions({ topic: 't', chan: 'c' })
    let name = makePluginName('handle', o)
    expect(name).to.equal('nsqt::handle::t::c')
  })

  it('Makes base patterns', () => {
    let o = fillNsqOptions({ topic: 't' })
    let bp = makeBasePattern(o)
    expect(bp).to.deep.equal({role: 't'})
  })
})
