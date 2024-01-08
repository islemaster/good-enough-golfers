const GENERATIONS = 30
const RANDOM_MUTATIONS = 2
const MAX_DESCENDANTS_TO_EXPLORE = 100

/**
 * 
 * @param {number} groups is the number of groups in each round (a positive integer).
 * @param {number} ofSize is the number of people in each group (a positive integer).
 * @param {number} forRounds is the number of rounds to try and solve (a positive integer).
 * @param {boolean} withFacilitators sets whether the first <groups> participants should be treated as
 *        group facilitators - they will be assigned deterministically to groups, and never grouped
 *        with one another.
 * @param {*} forbiddenPairs 
 * @param {*} discouragedGroups 
 * @param {*} onProgress 
 */
function geneticSolver(groups, ofSize, forRounds, withFacilitators, forbiddenPairs=[], discouragedGroups=[], onProgress) {
  const totalSize = groups * ofSize;

  // Weights represents the number of times this pair has been grouped before
  function score(round, weights) {
    const groupScores = round.map(group => {
      let groupCost = 0
      forEachPair(group, (a, b) => groupCost += Math.pow(weights[a][b], 2))
      return groupCost
    })
    return {
      groups: round,
      groupsScores: groupScores,
      total: groupScores.reduce((sum, next) => sum + next, 0),
    }
  }

  function generatePermutation() {
    if (withFacilitators) {
      const groupSize = ofSize - 1;
      const people = _.shuffle(_.range(groups, groups * ofSize));
      return _.range(groups).map(i => [
        i,
        ..._.range(groupSize).map(j =>
          people[i * groupSize + j]
        )
      ]);
    } else {
      const people = _.shuffle(_.range(groups * ofSize))
      return _.range(groups).map(i =>
        _.range(ofSize).map(j =>
          people[i * ofSize + j]
        )
      )
    }
  }

  function generateMutations(candidates, weights) {
    const mutations = []
    candidates.forEach(candidate => {
      const scoredGroups = candidate.groups.map((g, i) => ({group: g, score: candidate.groupsScores[i]}))
      const sortedScoredGroups = _.sortBy(scoredGroups, sg => sg.score).reverse()
      const sorted = sortedScoredGroups.map(ssg => ssg.group)

      // Always push the original candidate back onto the list
      mutations.push(candidate)

      // Add every mutation that swaps somebody out of the most expensive group
      // (The first group is the most expensive now that we've sorted them)
      for (let i = 0; i < ofSize; i++) {
        for (let j = ofSize; j < totalSize; j++) {
          mutations.push(score(swap(sorted, i, j), weights))
        }
      }

      // Add some random mutations to the search space to help break out of local peaks
      for (let i = 0; i < RANDOM_MUTATIONS; i++) {
        mutations.push(score(generatePermutation(), weights))
      }
    })
    return mutations;
  }

  function swap(groups, i, j) {
    const copy = groups.map(group => group.slice())
    copy[Math.floor(i / ofSize)][i % ofSize] = groups[Math.floor(j / ofSize)][j % ofSize]
    copy[Math.floor(j / ofSize)][j % ofSize] = groups[Math.floor(i / ofSize)][i % ofSize]
    return copy
  }

  function updateWeights(round, weights) {
    for (const group of round) {
      forEachPair(group, (a, b) => {
        weights[a][b] = weights[b][a] = (weights[a][b] + 1)
      })
    }
  }

  const weights = _.range(totalSize).map(() => _.range(totalSize).fill(0))

  // Fill some initial restrictions
  if (withFacilitators) {
    for (let i = 0; i < groups - 1; i++) {
      for (let j = i + 1; j < groups; j++) {
        weights[i][j] = weights[j][i] = Infinity;
      }
    }
  }


  forbiddenPairs.forEach(group => {
    forEachPair(group, (a, b) => {
      if (a >= totalSize || b >= totalSize) return
      weights[a][b] = weights[b][a] = Infinity
    })
  })

  discouragedGroups.forEach(group => {
    forEachPair(group, (a, b) => {
      if (a >= totalSize || b >= totalSize) return
      weights[a][b] = weights[b][a] = (weights[a][b] + 1)
    })
  })

  const rounds = []
  const roundScores = []

  for (let round = 0; round < forRounds; round++) {
    let topOptions = _.range(5).map(() => score(generatePermutation(), weights))
    let generation = 0
    while (generation < GENERATIONS && topOptions[0].total > 0) {
      const candidates = generateMutations(topOptions, weights)
      let sorted = _.sortBy(candidates, c => c.total)
      const bestScore = sorted[0].total
      // Reduce to all the options that share the best score
      topOptions = sorted.slice(0, sorted.findIndex(opt => opt.total > bestScore))
      // Shuffle those options and only explore some maximum number of them
      topOptions = _.shuffle(topOptions).slice(0, MAX_DESCENDANTS_TO_EXPLORE)
      generation++;
    }
    const bestOption  = topOptions[0]
    rounds.push(bestOption.groups)
    roundScores.push(bestOption.total)
    updateWeights(bestOption.groups, weights)

    onProgress({
      rounds,
      roundScores,
      weights,
      done: (round+1) >= forRounds,
    })
  }
}

function forEachPair(array, callback) {
  for (let i = 0; i < array.length - 1; i++) {
    for (let j = i + 1; j < array.length; j++) {
      callback(array[i], array[j])
    }
  }
}
