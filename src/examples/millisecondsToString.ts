function millisecondsToString (milliseconds: number): string {
  let ms = ('00' + (milliseconds % 1000)).slice(-3)
  let seconds = Math.floor(milliseconds / 1000)
  let h = ('0' + Math.floor(seconds / 3600) % 24).slice(-2)
  let m = ('0' + Math.floor(seconds / 60) % 60).slice(-2)
  let s = ('0' + seconds % 60).slice(-2)
  return [h, m, s, ms].join(':')
}

export default millisecondsToString
