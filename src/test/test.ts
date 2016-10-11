import * as chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
chai.use(chaiAsPromised)
let expect = chai.expect

import * as main from '../nsqt'
let {
  fillNsqOptions,
  makePluginName,
  makeBasePattern,
  SortedArray
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
    let name = makePluginName('ID', o)
    expect(name).to.equal('nsqt..ID..t')
  })

  it('Builds plugin names with channels', () => {
    let o = fillNsqOptions({ topic: 't', chan: 'c' })
    let name = makePluginName('ID', o)
    expect(name).to.equal('nsqt..ID..t..c')
  })

  it('Makes base patterns', () => {
    let o = fillNsqOptions({ topic: 't' })
    let bp = makeBasePattern(o)
    expect(bp).to.deep.equal({role: 't'})
  })

  it('Can sort arrays', () => {
    let e = (n: number) => {
      return {n}
    }
    let a = SortedArray.comparing('n', [e(1), e(4), e(2)])
    expect(a.array).to.deep.equal([e(1), e(2), e(4)])
    a.insert(e(3))
    expect(a.array).to.deep.equal([e(1), e(2), e(3), e(4)])
    expect(a.search(e(3))).to.equal(2)
    expect(a.search(e(5))).to.equal(-1)
    expect(a.search(e(1))).to.equal(0)
    expect(a.search(e(4))).to.equal(3)
    a.removeAt(1)
    expect(a.array).to.deep.equal([e(1), e(3), e(4)])
    a.removeAt(0)
    expect(a.array).to.deep.equal([e(3), e(4)])
  })
})
