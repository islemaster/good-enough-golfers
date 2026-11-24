// Shared scheduling helpers, loaded by both the page (index.js) and the
// solver worker (lib/worker.js). No dependencies.
//
// Players are identified by their index in the name list. A "round" is an
// array of groups, and a group is an array of player indices.

// Weight given to pairs that must never be grouped. It is large enough that
// one violation outweighs any realistic number of repeat meetings, but finite,
// so two violations still score worse than one (Infinity can't tell them apart).
const FORBIDDEN_WEIGHT = 10000

function forEachPair(array, callback) {
  for (let i = 0; i < array.length - 1; i++) {
    for (let j = i + 1; j < array.length; j++) {
      callback(array[i], array[j])
    }
  }
}

/**
 * Build the starting pair-weight matrix from the user's constraints.
 * weights[a][b] counts how many times a and b have been grouped, plus any
 * artificial penalty from constraints.
 */
function initialWeights(numPlayers, groups, withGroupLeaders, forbiddenPairs, discouragedGroups) {
  const weights = []
  for (let i = 0; i < numPlayers; i++) weights.push(new Array(numPlayers).fill(0))

  if (withGroupLeaders) {
    const leaders = Math.min(groups, numPlayers)
    for (let i = 0; i < leaders - 1; i++) {
      for (let j = i + 1; j < leaders; j++) {
        weights[i][j] = weights[j][i] = FORBIDDEN_WEIGHT
      }
    }
  }

  ;(forbiddenPairs || []).forEach(group => {
    forEachPair(group, (a, b) => {
      if (a >= numPlayers || b >= numPlayers) return
      weights[a][b] = weights[b][a] = FORBIDDEN_WEIGHT
    })
  })

  ;(discouragedGroups || []).forEach(group => {
    forEachPair(group, (a, b) => {
      if (a >= numPlayers || b >= numPlayers) return
      weights[a][b] = weights[b][a] = weights[a][b] + 1
    })
  })

  return weights
}

function addRoundToWeights(round, weights) {
  for (const group of round) {
    forEachPair(group, (a, b) => {
      weights[a][b] = weights[b][a] = weights[a][b] + 1
    })
  }
}

function groupCost(group, weights) {
  let cost = 0
  forEachPair(group, (a, b) => cost += weights[a][b] * weights[a][b])
  return cost
}

function roundCost(round, weights) {
  return round.reduce((sum, group) => sum + groupCost(group, weights), 0)
}

// Cost of putting `player` in with `members` (ignoring the player itself).
function joinCost(player, members, weights) {
  let cost = 0
  for (const m of members) {
    if (m !== player) cost += weights[player][m] * weights[player][m]
  }
  return cost
}

/**
 * Sizes for `numPeople` spread over `groups` groups, differing by at most 1,
 * largest first.
 */
function balancedSizes(numPeople, groups) {
  const base = Math.floor(numPeople / groups)
  const extra = numPeople % groups
  const sizes = []
  for (let i = 0; i < groups; i++) sizes.push(i < extra ? base + 1 : base)
  return sizes
}

/**
 * Adjust one planned round for attendance, changing as little as possible.
 *
 * 1. Absent students are removed from their groups.
 * 2. Present students who aren't in a group (they were absent when this round
 *    was planned, or were sitting out) fill any free places, longest-waiting
 *    first. Anyone still left over sits out.
 * 3. The fewest students needed are moved so group sizes differ by at most 1,
 *    picking the moves that create the fewest repeat pairings.
 *
 * Everyone else stays where they were planned. The result depends only on the
 * inputs, so the same plan and absences always give the same groups.
 *
 * @returns {{groups: number[][], sittingOut: number[], moved: number[]}}
 */
function repairRound(planned, opts) {
  const {numPlayers, ofSize, weights, withGroupLeaders} = opts
  const absent = new Set(opts.absent || [])
  const sitOutCounts = opts.sitOutCounts || []
  const numGroups = planned.length
  const isLeader = p => !!withGroupLeaders && p < numGroups

  const result = planned.map(group => group.filter(p => p < numPlayers && !absent.has(p)))
  const placed = new Set([].concat(...result))
  const present = []
  for (let p = 0; p < numPlayers; p++) if (!absent.has(p)) present.push(p)

  const capacity = numGroups * ofSize
  const totalToPlace = Math.min(present.length, capacity)
  const waiting = present
    .filter(p => !placed.has(p))
    .sort((a, b) => (isLeader(b) - isLeader(a)) || ((sitOutCounts[b] || 0) - (sitOutCounts[a] || 0)) || a - b)
  const openPlaces = Math.max(0, totalToPlace - placed.size)
  const toAdd = waiting.slice(0, openPlaces)
  const sittingOut = waiting.slice(openPlaces)

  // Target sizes: the larger sizes go to groups that are already largest,
  // so we move as few people as possible.
  const sizes = balancedSizes(placed.size + toAdd.length, numGroups)
  const order = result
    .map((group, i) => ({i, size: group.length, leader: group.some(isLeader)}))
    .sort((a, b) => (b.size - a.size) || (b.leader - a.leader) || a.i - b.i)
  const target = new Array(numGroups)
  order.forEach((g, rank) => target[g.i] = sizes[rank])

  const moved = new Set()

  // Place returning / waiting students
  for (const p of toAdd) {
    let best = -1, bestCost = Infinity
    if (isLeader(p) && result[p] && result[p].length < target[p] && !result[p].some(isLeader)) {
      best = p
    } else {
      for (let g = 0; g < numGroups; g++) {
        if (result[g].length >= target[g]) continue
        const cost = joinCost(p, result[g], weights)
        if (cost < bestCost) { bestCost = cost; best = g }
      }
    }
    if (best === -1) { sittingOut.push(p); continue }
    result[best].push(p)
    moved.add(p)
  }

  // Rebalance: move one student at a time from an oversized group to an
  // undersized one, choosing the move that adds the least conflict.
  for (;;) {
    const over = [], under = []
    result.forEach((group, g) => {
      if (group.length > target[g]) over.push(g)
      else if (group.length < target[g]) under.push(g)
    })
    if (over.length === 0 || under.length === 0) break

    let best = null
    for (const from of over) {
      for (const p of result[from]) {
        if (isLeader(p)) continue
        const leaveSaving = joinCost(p, result[from], weights)
        for (const to of under) {
          const delta = joinCost(p, result[to], weights) - leaveSaving
          if (!best || delta < best.delta) best = {p, from, to, delta}
        }
      }
    }
    if (!best) break
    result[best.from] = result[best.from].filter(x => x !== best.p)
    result[best.to].push(best.p)
    moved.add(best.p)
  }

  return {groups: result, sittingOut: sittingOut.sort((a, b) => a - b), moved: [...moved]}
}

/**
 * Apply attendance to a whole planned schedule, round by round, so each round
 * is adjusted using who actually met in the rounds before it.
 *
 * @param {number[][][]} plannedRounds
 * @param {Object<number, number[]>} absences round index -> absent player indices
 * @param {object} config numPlayers, groups, ofSize, withGroupLeaders, forbiddenPairs, discouragedGroups
 * @returns {Array<{groups, sittingOut, absent, moved, score}>}
 */
function applyAttendance(plannedRounds, absences, config) {
  const {numPlayers, groups, ofSize, withGroupLeaders, forbiddenPairs, discouragedGroups} = config
  const weights = initialWeights(numPlayers, groups, withGroupLeaders, forbiddenPairs, discouragedGroups)
  const sitOutCounts = new Array(numPlayers).fill(0)

  return plannedRounds.map((planned, k) => {
    const absent = ((absences && absences[k]) || []).filter(p => p < numPlayers)
    const repaired = repairRound(planned, {numPlayers, ofSize, weights, withGroupLeaders, absent, sitOutCounts})
    const score = roundCost(repaired.groups, weights)
    addRoundToWeights(repaired.groups, weights)
    repaired.sittingOut.forEach(p => sitOutCounts[p]++)
    return Object.assign({absent: absent.slice().sort((a, b) => a - b), score}, repaired)
  })
}

if (typeof module !== 'undefined') {
  module.exports = {
    FORBIDDEN_WEIGHT, forEachPair, initialWeights, addRoundToWeights, groupCost,
    roundCost, joinCost, balancedSizes, repairRound, applyAttendance,
  }
}
