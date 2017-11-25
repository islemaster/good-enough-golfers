// Get geneticSolver from the document

let controlsDiv, resultsDiv
let controls = {}

let groups = 0
let ofSize = 0
let forRounds = 0
let playerNames = []
let forbiddenPairs = []

let lastResults

function init() {
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
  controls.playerNames.onkeyup = onPlayerNamesChanged
  controls.playerNames.onchange = onPlayerNamesChanged
  controls.forbiddenPairs.onchange = onForbiddenPairsChanged

  onPlayerNamesChanged()
  onForbiddenPairsChanged()
  onSliderMoved()
  onParametersChanged()
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
  controls.playerNames.disabeld = true
}

function enableControls() {
  controls.groupsSlider.disabled = false
  controls.ofSizeSlider.disabled = false
  controls.forRoundsSlider.disabled = false
  controls.playerNames.disabeld = false
}

// This happens when a slider's value is changed and the slider
// is released, after onSliderMoved
function onParametersChanged() {
  lastResults = null;
  renderResults()
  disableControls()
  setTimeout(() => {
    lastResults = geneticSolver(groups, ofSize, forRounds, forbiddenPairs)
    renderResults()
    enableControls()
  },0)
}

function onPlayerNamesChanged() {
  playerNames = controls.playerNames.value
    .split('\n')
    .map(name => name.trim())
  renderResults()
}

function onForbiddenPairsChanged() {
  forbiddenPairs = controls.forbiddenPairs.value
    .split('\n')
    .map(stringPair =>
      stringPair
        .split(',')
        .map(name =>
          playerNames.indexOf(name.trim())
        )
    )
    .filter(pair => pair.length == 2 && pair.every(index => index >= 0))
  onParametersChanged()
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