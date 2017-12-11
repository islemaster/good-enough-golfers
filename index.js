let controlsDiv, resultsDiv
let controls = {}

let groups = 0
let ofSize = 0
let forRounds = 0
let playerNames = []
let forbiddenPairs = Immutable.Set()

let lastResults
const myWorker = new Worker('lib/worker.js');

function init() {
  myWorker.addEventListener('message', onResults, false);

  controlsDiv = document.getElementById('controls')
  resultsDiv = document.getElementById('results')

  controls.groupsLabel = controlsDiv.querySelector('#groupsLabel')
  controls.groupsSlider = controlsDiv.querySelector('#groupsSlider')
  controls.ofSizeLabel = controlsDiv.querySelector('#ofSizeLabel')
  controls.ofSizeSlider = controlsDiv.querySelector('#ofSizeSlider')
  controls.forRoundsLabel = controlsDiv.querySelector('#forRoundsLabel')
  controls.forRoundsSlider = controlsDiv.querySelector('#forRoundsSlider')
  controls.playerNames = controlsDiv.querySelector('#playerNames')
  controls.forbiddenPairs = controlsDiv.querySelector('#forbiddenPairs')

  // User input controls
  controls.groupsSlider.oninput = onSliderMoved
  controls.ofSizeSlider.oninput = onSliderMoved
  controls.forRoundsSlider.oninput = onSliderMoved
  controls.groupsSlider.onchange = onParametersChanged
  controls.ofSizeSlider.onchange = onParametersChanged
  controls.forRoundsSlider.onchange = onParametersChanged
  controls.playerNames.onkeyup = onPlayerNamesKeyUp
  controls.playerNames.onchange = onPlayerNamesChanged
  controls.forbiddenPairs.onchange = onForbiddenPairsChanged

  playerNames = readPlayerNames()
  forbiddenPairs = readForbiddenPairs(playerNames)
  onSliderMoved()
  onParametersChanged()
}

function onResults(e) {
  lastResults = e.data
  renderResults()
  if (lastResults.done) {
    enableControls()
  }
}

function onSliderMoved() {
  groups = parseInt(controls.groupsSlider.value, 10)
  ofSize = parseInt(controls.ofSizeSlider.value, 10)
  forRounds = parseInt(controls.forRoundsSlider.value, 10)

  // Update labels
  controls.groupsLabel.textContent = groups
  controls.ofSizeLabel.textContent = ofSize
  controls.forRoundsLabel.textContent = forRounds
}

function disableControls() {
  controls.groupsSlider.disabled = true
  controls.ofSizeSlider.disabled = true
  controls.forRoundsSlider.disabled = true
  controls.playerNames.disabled = true
  controls.forbiddenPairs.disabled = true
}

function enableControls() {
  controls.groupsSlider.disabled = false
  controls.ofSizeSlider.disabled = false
  controls.forRoundsSlider.disabled = false
  controls.playerNames.disabled = false
  controls.forbiddenPairs.disabled = false
}

// This happens when a slider's value is changed and the slider
// is released, after onSliderMoved
function onParametersChanged() {
  lastResults = null;
  renderResults()
  disableControls()
  myWorker.postMessage({groups, ofSize, forRounds, forbiddenPairs: forbiddenPairs.toJS()})
}

function readPlayerNames() {
  return controls.playerNames.value
    .split('\n')
    .map(name => name.trim())
}

function onPlayerNamesKeyUp() {
  playerNames = readPlayerNames()
  renderResults()
}

function onPlayerNamesChanged() {
  playerNames = readPlayerNames()
  const newForbiddenPairs = readForbiddenPairs(playerNames)
  if (!forbiddenPairs.equals(newForbiddenPairs)) {
    forbiddenPairs = newForbiddenPairs
    onParametersChanged()
  } else {
    renderResults()
  }
}

function onForbiddenPairsChanged() {
  forbiddenPairs = readForbiddenPairs(playerNames)
  onParametersChanged()
}

/**
 * Given the current playerNames and the value of the forbiddenPairs input field,
 * recomputes the cached set of forbiddenPairs by index.
 * @param {Array<string>} playerNames
 * @return {Immutable.Set<Immutable.Set<number>>}
 */
function readForbiddenPairs(playerNames) {
  return controls.forbiddenPairs.value
    .split('\n')
    .map(stringPair =>
      stringPair
        .split(',')
        .map(name =>name.trim())
    )
    .filter(pair => pair.length === 2) // Drop lines that aren't pairs
    .reduce((memo, [leftName, rightName]) => {
      const leftIndices = indicesOf(leftName, playerNames)
      const rightIndices = indicesOf(rightName, playerNames)
      for (const leftIndex of leftIndices) {
        for (const rightIndex of rightIndices) {
          if (leftIndex !== rightIndex) {
            memo = memo.add(Immutable.Set([leftIndex, rightIndex]))
          }
        }
      }
      return memo
    }, Immutable.Set())
}

function indicesOf(needle, haystack) {
  const indices = []
  let nextIndex = -1
  do {
    nextIndex = haystack.indexOf(needle, nextIndex + 1)
    if (nextIndex > -1) indices.push(nextIndex)
  } while (nextIndex > -1)
  return indices
}

function renderResults() {
  if (!lastResults) {
    resultsDiv.innerHTML = 'Thinking...'
    return
  }
  resultsDiv.innerHTML = ''
  lastResults.rounds.forEach((round, roundIndex) => {
    const roundDiv = document.createElement('div')
    roundDiv.classList.add('round')

    const header = document.createElement('h1')
    header.textContent = `Round ${roundIndex+1}`
    const conflictScore = document.createElement('div')
    conflictScore.classList.add('conflictScore')
    conflictScore.textContent = `Conflict score: ${lastResults.roundScores[roundIndex]}`
    header.appendChild(conflictScore)

    const groups = document.createElement('div')
    groups.classList.add('groups')

    round.forEach((group, groupIndex) => {
      const groupDiv = document.createElement('div')
      groupDiv.classList.add('group')
      const groupName = document.createElement('h2')
      groupName.textContent = `Group ${groupIndex + 1}`
      groupDiv.appendChild(groupName)

      const members = document.createElement('ul')
      group.sort((a, b) => parseInt(a) < parseInt(b) ? -1 : 1).forEach(personNumber => {
        const member = document.createElement('li')
        member.textContent = playerNames[personNumber] ? playerNames[personNumber] : `Player ${personNumber+1}`
        members.appendChild(member)
      })
      groupDiv.appendChild(members)

      groups.appendChild(groupDiv)
    })

    roundDiv.appendChild(header)
    roundDiv.appendChild(groups)
    resultsDiv.appendChild(roundDiv)
  })
}

document.addEventListener('DOMContentLoaded', init)