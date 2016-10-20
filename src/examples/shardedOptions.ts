import * as nsqt from '../nsqt'
import defaultOptions from './defaultOptions'

function buildOptions (shardProperty: string, topic: string, chan: string | null = null): nsqt.NsqOptionsFilled {
  let options = defaultOptions(topic, chan)
  options.sharding = {
    shardProperty
  }
  return options
}
export default buildOptions
