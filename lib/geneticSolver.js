// Requires lodash and lib/schedule.js to be loaded first.
const GENERATIONS = 30
const RANDOM_MUTATIONS = 2
const MAX_DESCENDANTS_TO_EXPLORE = 100

/**
 * Attempt to quickly approach a solution for the social golfer problem in the given
 * configuration.
 *
 * @param {number} groups how many groups per round
 * @param {number} ofSize how many players per group (target/max size)
 * @param {number} forRounds how many rounds the full schedule has
 * @param {boolean} withGroupLeaders gives the first <groups> players a special role.
 *        It will never match any pair of them, and keeps each in their own group.
 * @param {number[][]} forbiddenPairs gives pairs of players that should never be grouped.
 * @param {number[][]} discouragedGroups gives groups of players that should be discouraged,
 *        by default; each pairs is seeded with weight 1.
 * @param {function} onProgress is a callback for reporting partial or full results.
 * @param {number} [numPlayers] actual number of players. Groups are balanced so sizes
 *        differ by at most 1. If there are more players than places, players take
 *        turns sitting out.
 * @param {object} [options]
 * @param {number[][][]} [options.history] rounds that already happened, as they
 *        actually happened. They are kept as-is and count towards who has met whom.
 *        Only rounds after them are solved.
 * @param {Object<number, number[]>} [options.absentByRound] round index -> players
 *        who are absent that round. They are left out of that round.
 */
function geneticSolver(
  groups, ofSize, forRounds, withGroupLeaders,
  forbiddenPairs=[], discouragedGroups=[], onProgress, numPlayers, options={}
  ) {
  const totalSize = (numPlayers != null && numPlayers > 0) ? numPlayers : groups * ofSize
  const capacity = groups * ofSize
  const history = options.history || []
  const absentByRound = options.absentByRound || {}

  const isLeader = p => withGroupLeaders && p < groups

  function score(round, weights) {
    const groupScores = round.map(group => groupCost(group, weights))
    return {
      groups: round,
      groupsScores: groupScores,
      total: groupScores.reduce((sum, next) => sum + next, 0),
    }
  }

  /**
   * Decide group sizes for this round. Sizes differ by at most 1. When there
   * are group leaders, groups whose leader is here get the larger sizes first,
   * so a leader never lands in a group with no room (e.g. fewer players than groups).
   */
  function sizesFor(players) {
    const sizes = balancedSizes(players.length, groups)
    const presentLeaders = new Set(players.filter(isLeader))
    const order = _.range(groups).sort((a, b) => presentLeaders.has(b) - presentLeaders.has(a) || a - b)
    const groupSizes = new Array(groups)
    order.forEach((g, rank) => groupSizes[g] = sizes[rank])
    return groupSizes
  }

  /**
   * Create a shuffled players-in-groups configuration for the given players.
   * Leaders who are here always start in their own group.
   */
  function generatePermutation(players, groupSizes) {
    const result = _.range(groups).map(() => [])
    players.filter(isLeader).forEach(p => result[p].push(p))
    const others = _.shuffle(players.filter(p => !isLeader(p)))
    let offset = 0
    return result.map((group, i) => {
      const toAdd = groupSizes[i] - group.length
      group.push(...others.slice(offset, offset + toAdd))
      offset += toAdd
      return group
    })
  }

  function swapMembers(groupsArr, g1, p1, g2, p2) {
    const copy = groupsArr.map(group => group.slice())
    copy[g1][p1] = groupsArr[g2][p2]
    copy[g2][p2] = groupsArr[g1][p1]
    return copy
  }

  function generateMutations(candidates, weights, players, groupSizes) {
    const mutations = []
    candidates.forEach(candidate => {
      const scoredGroups = candidate.groups.map((g, i) => ({group: g, score: candidate.groupsScores[i]}))
      const sorted = _.sortBy(scoredGroups, sg => sg.score).reverse().map(ssg => ssg.group)

      // Always push the original candidate back onto the list
      mutations.push(candidate)

      // Add every mutation that swaps somebody out of the most expensive group.
      // Leaders never move.
      const expensiveGroup = sorted[0]
      for (let i = 0; i < expensiveGroup.length; i++) {
        if (isLeader(expensiveGroup[i])) continue
        for (let g = 1; g < sorted.length; g++) {
          for (let j = 0; j < sorted[g].length; j++) {
            if (isLeader(sorted[g][j])) continue
            mutations.push(score(swapMembers(sorted, 0, i, g, j), weights))
          }
        }
      }

      // Add some random mutations to the search space to help break out of local peaks
      for (let i = 0; i < RANDOM_MUTATIONS; i++) {
        mutations.push(score(generatePermutation(players, groupSizes), weights))
      }
    })
    return mutations
  }

  // With leaders, put each leader's group back at the leader's index so
  // "Group 3" is always led by leader 3. Leaderless groups fill the gaps.
  function orderGroups(round) {
    if (!withGroupLeaders) return round
    const ordered = new Array(groups)
    const rest = []
    round.forEach(group => {
      const leader = group.find(isLeader)
      if (leader !== undefined) ordered[leader] = group
      else rest.push(group)
    })
    for (let i = 0; i < groups; i++) if (!ordered[i]) ordered[i] = rest.shift()
    return ordered
  }

  const weights = initialWeights(totalSize, groups, withGroupLeaders, forbiddenPairs, discouragedGroups)
  const sitOutCounts = new Array(totalSize).fill(0)

  const rounds = []
  const roundScores = []

  function presentIn(k) {
    const absent = new Set(absentByRound[k] || [])
    return _.range(totalSize).filter(p => !absent.has(p))
  }

  function recordRound(k, round, roundScore) {
    rounds.push(round)
    roundScores.push(roundScore)
    const placed = new Set(_.flatten(round))
    presentIn(k).forEach(p => { if (!placed.has(p)) sitOutCounts[p]++ })
    addRoundToWeights(round, weights)
  }

  // Rounds that already happened are fixed; they only inform the weights.
  history.forEach((round, k) => recordRound(k, round, roundCost(round, weights)))

  if (history.length >= forRounds) {
    onProgress({rounds, roundScores, done: true})
    return
  }

  for (let round = history.length; round < forRounds; round++) {
    // Who plays this round. If there are more players than places, leaders
    // always play and everyone else takes turns: whoever has sat out most
    // plays first, with ties broken randomly.
    let players = presentIn(round)
    if (players.length > capacity) {
      const leaders = players.filter(isLeader)
      const others = _.sortBy(_.shuffle(players.filter(p => !isLeader(p))), p => -sitOutCounts[p])
      players = leaders.concat(others.slice(0, Math.max(0, capacity - leaders.length)))
    }
    const groupSizes = sizesFor(players)

    let topOptions = _.range(5).map(() => score(generatePermutation(players, groupSizes), weights))
    let generation = 0
    while (generation < GENERATIONS && topOptions[0].total > 0) {
      const candidates = generateMutations(topOptions, weights, players, groupSizes)
      const sorted = _.sortBy(candidates, c => c.total)
      const bestScore = sorted[0].total
      // Reduce to all the options that share the best score
      const cut = sorted.findIndex(opt => opt.total > bestScore)
      topOptions = cut === -1 ? sorted : sorted.slice(0, cut)
      // Shuffle those options and only explore some maximum number of them
      topOptions = _.shuffle(topOptions).slice(0, MAX_DESCENDANTS_TO_EXPLORE)
      generation++
    }
    const bestOption = topOptions[0]
    recordRound(round, orderGroups(bestOption.groups), bestOption.total)

    onProgress({
      rounds,
      roundScores,
      done: (round + 1) >= forRounds,
    })
  }
}
