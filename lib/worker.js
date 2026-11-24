self.importScripts('https://cdn.jsdelivr.net/npm/lodash@4.17.4/lodash.min.js')
self.importScripts('schedule.js')
self.importScripts('geneticSolver.js')

self.addEventListener('message', function(e) {
  // Any message from the host page starts a new computation
  const {jobId, groups, ofSize, forRounds, withGroupLeaders, forbiddenPairs, discouragedGroups, numPlayers, history, absentByRound} = e.data
  // Compute results and send them back to the host page
  geneticSolver(groups, ofSize, forRounds, withGroupLeaders, forbiddenPairs, discouragedGroups, (results) => {
    self.postMessage(Object.assign({jobId}, results))
  }, numPlayers, {history, absentByRound})
}, false)
