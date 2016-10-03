import * as chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
chai.use(chaiAsPromised)
let expect = chai.expect

import * as main from '../main'
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
    expect(o.isHandler).to.equal(false)
  })

  it('Fills defaults keeping provided values', () => {
    let o = fillNsqOptions({ topic: 't', chan: 'c', isHandler: true })
    expect(o.lookupdHTTPAddresses).to.deep.equal(['127.0.0.1:4161'])
    expect(o.writerNsqdHost).to.equal('127.0.0.1')
    expect(o.writerNsqdPort).to.equal(4150)
    expect(o.topic).to.equal('t')
    expect(o.topicProperty).to.equal('role')
    expect(o.chan).to.equal('c')
    expect(o.isHandler).to.equal(true)
  })

  it('Builds plugin names', () => {
    let o = fillNsqOptions({ topic: 't' })
    let name = makePluginName(o)
    expect(name).to.equal('NSQ::t')
  })

  it('Builds plugin names with channels', () => {
    let o = fillNsqOptions({ topic: 't', chan: 'c' })
    let name = makePluginName(o)
    expect(name).to.equal('NSQ::t::c')
  })

  it('Makes base patterns', () => {
    let o = fillNsqOptions({ topic: 't' })
    let bp = makeBasePattern(o)
    expect(bp).to.deep.equal({role: 't'})
  })
})
