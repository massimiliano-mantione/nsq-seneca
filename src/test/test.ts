import * as chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
chai.use(chaiAsPromised)
let expect = chai.expect

describe('System', () => {
  it('Works', () => {
    expect(2 + 2).to.equal(4)
  })
})
