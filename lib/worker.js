self.importScripts('https://cdn.jsdelivr.net/npm/lodash@4.17.4/lodash.min.js')
self.importScripts('geneticSolver.js')

self.addEventListener('message', function(e) {
  // Any message from the host page starts a new computation
  const {groups, ofSize, forRounds, withFacilitators, forbiddenPairs, discouragedGroups} = e.data
  // Compute results and send them back to the host page
  geneticSolver(groups, ofSize, forRounds, withFacilitators, forbiddenPairs, discouragedGroups, (results) => {
    self.postMessage(results)
  })
}, false)
