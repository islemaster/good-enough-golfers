const GENERATIONS = 30
const RANDOM_MUTATIONS = 2
const MAX_DESCENDANTS_TO_EXPLORE = 100

function geneticSolver(groups, ofSize, forRounds, forbiddenPairs=[], discouragedGroups=[], onProgress) {
  const totalSize = groups * ofSize;

  // Weights represents the number of times this pair has been grouped before
  function score(round, weights) {
    const groupScores = round.map(group => {
      let groupCost = 0
      // Classic social golfer problem: Minimize pairs grouped more than once
      // Updated social mixing problem: Maximize pairs grouped at least once

      // Classic: The cost of each pair is the square of the number of times they've met before
      //          To discourage matching one pair many times
      // forEachPair(group, (a, b) => groupCost += Math.pow(weights[a][b], 2))
      // Updated: The cost of each pair  is zero if they haven't met before and one if they have
      //      To maximize mixing and not worry about repeat matches.
      //      BUT still respect Infinity constraints
      // forEachPair(group, (a, b) => groupCost += weights[a][b] == Infinity ? Infinity : weights[a][b] > 0 ? 1 : 0)
      // And a hack to make matching with the first five members more important
      forEachPair(group, (a, b) => {
        if (weights[a][b] == Infinity) {
          groupCost += Infinity
        } else if ((a < 5 || b < 5) && weights[a][b] == 0) {
          // One of the players is a facilitator and they haven't met, big negative weight making it more attractive
          groupCost -= 4
        } else {
          // Don't care about overmatching, just promote mixing
          groupCost += weights[a][b] > 0 ? 1 : 0
        }
      })
      return groupCost
    })
    return {
      groups: round,
      groupsScores: groupScores,
      total: groupScores.reduce((sum, next) => sum + next, 0),
    }
  }

  function generatePermutation() {
    const people = _.shuffle(_.range(groups * ofSize))
    return _.range(groups).map(i =>
      _.range(ofSize).map(j =>
        people[i * ofSize + j]
      )
    )
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
