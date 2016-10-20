import * as chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
chai.use(chaiAsPromised)
let expect = chai.expect

import * as nsqt from '../nsqt'
let {
  fillNsqOptions,
  makePluginName,
  makeBasePattern,
  SortedArray
} = nsqt._

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

  describe('Shard state management', () => {
    let {
      isMaster,
      initialShardState,
      updateShardStatus,
      // refreshActiveShards,
      MAX_INACTIVE_SHARD_PERIODS,
      SETTLEMENT_SHARD_PERIODS,
      // NO_MASTER,
      shardPeriod
    } = nsqt._

    it('Adds a received shard', () => {
      let s = initialShardState('me', 't')
      let r = initialShardState('him', 't')
      let res = updateShardStatus(s, r)
      expect(res).to.equal(false)
      expect(s.seen['him'].id).to.equal('him')
    })

    it('Recognizes a received shard', () => {
      let s = initialShardState('me', 't')
      let r = initialShardState('him', 't')
      updateShardStatus(s, r)
      s.seen['him'].inactivePeriods = 1
      updateShardStatus(s, r)
      expect(s.seen['him'].id).to.equal('him')
      expect(s.seen['him'].inactivePeriods).to.equal(0)
    })

    it('Removes an unseen shard', () => {
      let s = initialShardState('me', 't')
      let r = initialShardState('him', 't')
      updateShardStatus(s, r)
      expect(s.seen['him'].id).to.equal('him')
      s.seen['him'].inactivePeriods = MAX_INACTIVE_SHARD_PERIODS
      let res = shardPeriod(s, true)
      expect(res).to.equal(false)
      expect(s.seen['him']).to.equal(undefined)
    })

    it('Keeps an unseen shard for MAX_INACTIVE_SHARD_PERIODS', () => {
      let s = initialShardState('me', 't')
      let r = initialShardState('him', 't')
      updateShardStatus(s, r)
      expect(s.seen['him'].id).to.equal('him')
      s.seen['him'].inactivePeriods = MAX_INACTIVE_SHARD_PERIODS - 1
      let res = shardPeriod(s, true)
      expect(res).to.equal(false)
      expect(s.seen['him'].id).to.equal('him')
    })

    it('Accepts another master', () => {
      let s = initialShardState('me', 't')
      let r = initialShardState('him', 't')
      s.quietPeriods = SETTLEMENT_SHARD_PERIODS + 1
      r.quietPeriods = SETTLEMENT_SHARD_PERIODS + 1
      r.masterId = r.id
      r.active = [{
        id: r.id,
        topic: 't..foo',
        topics: ['t..foo']
      }]
      expect(isMaster(r)).to.equal(true)
      let res = updateShardStatus(s, r)
      expect(res).to.equal(true)
      expect(s.seen['him'].id).to.equal('him')
      expect(s.masterId).to.equal('him')
      expect(s.active[0].id).to.equal('him')
    })

    it('Updates seen by', () => {
      let s1 = initialShardState('s1', 't')
      let s2 = initialShardState('s2', 't')
      updateShardStatus(s1, s1)
      expect(s1.seen['s1'] !== undefined)
      updateShardStatus(s2, s1)
      updateShardStatus(s1, s2)
      expect(s1.seen['s1'] !== undefined)
      expect(s1.seen['s1'].seenBy['s1']).to.equal(true)
      expect(s1.seen['s1'].seenBy['s2']).to.equal(true)
    })

    it('Becomes master after SETTLEMENT_SHARD_PERIODS', () => {
      let s1 = initialShardState('s1', 't')
      let s2 = initialShardState('s2', 't')
      updateShardStatus(s1, s1)
      updateShardStatus(s1, s2)
      s1.quietPeriods = SETTLEMENT_SHARD_PERIODS + 1
      let res = shardPeriod(s1, true)
      expect(res).to.equal(true)
      expect(isMaster(s1)).to.equal(true)
      expect(s1.active.length).to.equal(2)
      expect(s1.active[0].id).to.equal('s1')
      expect(s1.active[1].id).to.equal('s2')
    })
  })
})
