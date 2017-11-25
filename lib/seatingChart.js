const _ = require('lodash')
const {Record, List, Set, Stack} = require('immutable')

const State = Record({
  finishedRounds: List(),
  // Array of tables, where each table is an array of indices of students seated so far.
  groups: List(),
  nextPlayer: 0,
  totalCost: 0,
  weights: null,
})

function printState(state) {
  return JSON.stringify(state.groups.toJS()) + ', cost ' + state.totalCost
}

function printWeights(weights) {
  return weights.toJS().map(row => row.join('  ')).join('\n')
}

module.exports = function seatingChart({
  studentNames, // Array.<string>
  totalGroups, // int
  seatsPerGroup, // int
  rounds, // int
}) {
  const playerCount = studentNames.length

  function exploreState(state) {
    // console.log('Exploring ' + printState(state))
    // console.log(printWeights(state.weights))

    const {weights, nextPlayer} = state;

    if (nextPlayer >= playerCount) {
      return [
        state.merge({
          finishedRounds: state.finishedRounds.push(state),
          groups: List(),
          nextPlayer: 0,
        })
      ]
    }

    // Check existing tables for possible placements
    const childStates = []
    for (let i = 0; i < state.groups.size; i++) {
      const group = state.groups.get(i)
      if (group.size < seatsPerGroup) {
        // console.log(`Group ${i}: ${group}`)
        const cost = group.reduce((cost, player) => {
          // console.log(`return ${cost} + weights.getIn([${player}, ${nextPlayer}])`)
          return cost + weights.getIn([player, nextPlayer])
        }, 0)
        // console.log(`Cost to add ${nextPlayer} to group ${i}: ${cost}`)
        let newWeights = state.weights
        group.forEach(member => {
          newWeights = newWeights
            .setIn([nextPlayer, member], 1)
            .setIn([member, nextPlayer], 1)
        })
        childStates.push(state.merge({
          groups: state.groups.set(i, group.add(nextPlayer)),
          nextPlayer: nextPlayer + 1,
          totalCost: state.totalCost + cost,
          weights: newWeights
        }))
      }
    }

    // Add possibility of placing at a new table if there are any left
    if (state.groups.size < totalGroups) {
      childStates.push(state.merge({
        groups: state.groups.push(Set.of(state.nextPlayer)),
        nextPlayer: state.nextPlayer + 1,
        weights: weights
      }))
    }

    // console.log('Child States:\n  ' + childStates.map(printState).join('\n  '))
    return childStates
  }

  const initialState = new State({
    weights: List(_.range(playerCount).map(() => List(_.range(playerCount).fill(0))))
  })
  let unexploredStates = Stack()

  let currentState = initialState;
  do {
    unexploredStates = unexploredStates.unshiftAll(exploreState(currentState))
    unexploredStates = unexploredStates.sort((a, b) => a.totalCost > b.totalCost ? 1 : a.totalCost === b.totalCost ? 0 : -1)
    currentState = unexploredStates.first()
    unexploredStates = unexploredStates.shift()

    // console.log(`currentState.finishedRounds.size ${currentState.finishedRounds.size} < rounds ${rounds}`)
  } while (currentState.finishedRounds.size < rounds)

  console.log(`Final State:`)
  currentState.finishedRounds.forEach(round => {
    console.log(printState(round));
  })
  console.log(printWeights(currentState.weights))
  return {
    conflicts: currentState.totalCost,
    rounds: [
      currentState.groups.toJS().map(group => group.map(playerIndex => studentNames[playerIndex]))
    ]
  }
}


