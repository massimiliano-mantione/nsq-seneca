import * as chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
chai.use(chaiAsPromised)
let expect = chai.expect

import * as main from '../main'
let {fillNsqOptions} = main._

describe('NSQ options', () => {
  it('Fills defaults', () => {
    let defaults = fillNsqOptions({})
    expect(defaults.lookupdHost).to.equal('127.0.0.1')
    expect(defaults.lookupdPort).to.equal(4161)
    expect(defaults.nsqdHost).to.equal('127.0.0.1')
    expect(defaults.nsqdPort).to.equal(4150)
  })
})
