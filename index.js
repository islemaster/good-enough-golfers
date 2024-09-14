// Good Enough Golfers
// Brad Buchanan, 2017
// MIT License (see ./LICENSE)
//
// Good-Enough Golfers is a near-solver for a class of scheduling
// problems including the [Social Golfer Problem][1] and
// [Kirkman's Schoolgirl Problem][2]. The goal is to schedule g x p
// players into g groups of size p for w weeks such that no two
// players meet more than once.
//
// [1]: http://mathworld.wolfram.com/SocialGolferProblem.html
// [2]: http://mathworld.wolfram.com/KirkmansSchoolgirlProblem.html
//
// Real solutions to these problems can be extremely slow, but
// approximations are fast and often good enough for real-world
// purposes.  Good-Enough Golfers uses a genetic algorithm to
// generate near-solutions to this class of problems, and has the
// ability to consider additional weighted constriants, making it
// useful for real-world situations such as assigning students to
// discussion groups.
//
// Besides index.html itself, this file is the entry point for the
// application and is a good place to start to understand the flow
// of control. However, it does not contain the actual solver. See
// lib/geneticSolver.js if you want to jump to the actual algorithm.
//
// We begin by declaring and initializing some page-global variables.
//
// These are references to the inputs column and the outputs column,
// and an object to organize references to individual controls, so
// that working with the DOM is more readable later.
let controlsDiv, resultsDiv
let controls = {}
// Also references for the help text
let helpDivs, showHelpLink, hideHelpLink

// These variables hold the state of the input controls, which are
// also the parameters we will pass into the solver.
let groups = 0
let ofSize = 0
let forRounds = 0
let withGroupLeaders = false
let playerNames = []
let forbiddenPairs = Immutable.Set()
let discouragedGroups = Immutable.Set()

// Each time we kick off the solver we will mark the time, so that
// we can eaily report the time required to compute the solution.
let startTime

// This variable holds the last result returned by the solver,
let lastResults

// Next we launch a web worker which is responsible for the slow job
// of actually computing a solution.
//
// Web workers are a simple way to do work in a background thread.
// This gets the solver work out of the UI thread (this one) and
// keeps the interface feeling responsive while a solution is being
// computed.
//
// See https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
const myWorker = new Worker('lib/worker.js');

// The init() function is called after the DOM is loaded. It prepares
// the application by setting up event handlers and an initial state
// and calling for an initial solution.
function init() {
  myWorker.addEventListener('message', onResults, false);

  controlsDiv = document.getElementById('controls')
  resultsDiv = document.getElementById('results')
  helpDivs = document.querySelectorAll('.help-text')

  showHelpLink = document.getElementById("show-help-link")
  hideHelpLink = document.getElementById("hide-help-link")

  controls.recomputeButton = controlsDiv.querySelector('#recomputeButton')
  controls.groupsBox = controlsDiv.querySelector('#groupsBox')
  controls.groupsSlider = controlsDiv.querySelector('#groupsSlider')
  controls.ofSizeBox = controlsDiv.querySelector('#ofSizeBox')
  controls.ofSizeSlider = controlsDiv.querySelector('#ofSizeSlider')
  controls.forRoundsBox = controlsDiv.querySelector('#forRoundsBox')
  controls.forRoundsSlider = controlsDiv.querySelector('#forRoundsSlider')
  controls.withGroupLeadersBox = controlsDiv.querySelector('#withGroupLeadersBox')
  controls.playerNames = controlsDiv.querySelector('#playerNames')
  controls.forbiddenPairs = controlsDiv.querySelector('#forbiddenPairs')
  controls.discouragedGroups = controlsDiv.querySelector('#discouragedGroups')

  // User input controls
  controls.recomputeButton.onclick = recomputeResults;
  controls.groupsSlider.oninput = onSliderMoved
  controls.ofSizeSlider.oninput = onSliderMoved
  controls.forRoundsSlider.oninput = onSliderMoved
  controls.withGroupLeadersBox.onchange = onWithGroupLeadersChanged
  controls.groupsBox.oninput = onSliderLabelEdited
  controls.ofSizeBox.oninput = onSliderLabelEdited
  controls.forRoundsBox.oninput = onSliderLabelEdited
  controls.playerNames.onkeyup = onPlayerNamesKeyUp
  controls.playerNames.onchange = onPlayerNamesChanged
  controls.forbiddenPairs.onchange = onForbiddenPairsChanged
  controls.discouragedGroups.onchange = onDiscouragedGroupsChanged

  try {
    loadStateFromLocalStorage()
  } catch (err) {
    console.info('Failed to load previous state');
  }

  playerNames = readPlayerNames()
  readConstraints(playerNames)
  onSliderLabelEdited()
  withGroupLeaders = !!controls.withGroupLeadersBox.checked

  if (lastResults) {
    renderResults()
  } else {
    recomputeResults()
  }
}

function onResults(e) {
  lastResults = e.data
  renderResults()
  if (lastResults.done) {
    saveStateToLocalStorage()
    enableControls()
  }
}

function recomputeResults() {
  startTime = Date.now();
  lastResults = null;
  renderResults()
  disableControls()
  myWorker.postMessage({groups, ofSize, forRounds, withGroupLeaders, forbiddenPairs: forbiddenPairs.toJS(), discouragedGroups: discouragedGroups.toJS()})
}

// Every time we finish computing results we save the solution and and the
// input parameters that produced it to local storage. Whenever the user
// returns to the page we restore the latest solution. This would be helpful
// to teachers that need an updated configuration for the same class.
function saveStateToLocalStorage() {
  localStorage.setItem('appState', JSON.stringify({
    groups,
    ofSize,
    forRounds,
    withGroupLeaders: !!withGroupLeaders,
    playerNames,
    forbiddenPairs: forbiddenPairs.toJS(),
    discouragedGroups: discouragedGroups.toJS(),
    lastResults
  }))
}

// When we load state on page load, we pull state from local storage and
// (mostly) write the state directly to the page controls. Then the normal
// initialization process will pick up the state from the controls.
// The one exception is that we load lastResults directly into the relevant
// variable, because it doesn't have a corresponding control on the page.
// This method will throw if a past state is not found in local storage or
// if we fail to deserialize it for some reason.
function loadStateFromLocalStorage() {
  const state = JSON.parse(localStorage.getItem('appState'))
  if (!state) throw new Error('Failed to load stored state')

  controls.groupsBox.value = state.groups
  controls.ofSizeBox.value = state.ofSize
  controls.forRoundsBox.value = state.forRounds
  controls.withGroupLeadersBox.checked = !!state.withGroupLeaders
  controls.playerNames.value = state.playerNames.join("\n")
  controls.forbiddenPairs.value = state.forbiddenPairs.map(x => x.map(i => state.playerNames[i]).join(",")).join("\n")
  controls.discouragedGroups.value = state.discouragedGroups.map(x => x.map(i => state.playerNames[i]).join(",")).join("\n")
  lastResults = state.lastResults
}

function onSliderMoved() {
  groups = parseInt(controls.groupsSlider.value, 10)
  ofSize = parseInt(controls.ofSizeSlider.value, 10)
  forRounds = parseInt(controls.forRoundsSlider.value, 10)

  // Update labels
  controls.groupsBox.value = groups
  controls.ofSizeBox.value = ofSize
  controls.forRoundsBox.value = forRounds
}

function onSliderLabelEdited() {
  groups = Math.min(999, Math.abs(parseInt(controls.groupsBox.value, 10)));
  ofSize = Math.min(999, Math.abs(parseInt(controls.ofSizeBox.value, 10)));
  forRounds = Math.min(999, Math.abs(parseInt(controls.forRoundsBox.value, 10)));

  controls.groupsSlider.max = Math.max(groups, controls.groupsSlider.max);
  controls.ofSizeSlider.max = Math.max(ofSize, controls.ofSizeSlider.max);
  controls.forRoundsSlider.max = Math.max(forRounds, controls.forRoundsSlider.max);
  
  controls.groupsSlider.value = groups
  controls.ofSizeSlider.value = Math.min(controls.ofSizeSlider.max, ofSize);
  controls.forRoundsSlider.value = Math.min(controls.forRoundsSlider.max, forRounds);
}

function onWithGroupLeadersChanged() {
  withGroupLeaders = controls.withGroupLeadersBox.checked
}

function disableControls() {
  controls.recomputeButton.disabled = true
  controls.groupsSlider.disabled = true
  controls.ofSizeSlider.disabled = true
  controls.forRoundsSlider.disabled = true
  controls.withGroupLeadersBox.disabled = true;
  controls.playerNames.disabled = true
  controls.forbiddenPairs.disabled = true
  controls.discouragedGroups.disabled = true
  
  // Show spinner
  controls.recomputeButton.innerHTML = '&nbsp;<span class="spinner"></span>'
}

function enableControls() {
  controls.recomputeButton.disabled = false
  controls.groupsSlider.disabled = false
  controls.ofSizeSlider.disabled = false
  controls.forRoundsSlider.disabled = false
  controls.withGroupLeadersBox.disabled = false
  controls.playerNames.disabled = false
  controls.forbiddenPairs.disabled = false
  controls.discouragedGroups.disabled = false
  
  // Hide spinner
  controls.recomputeButton.innerHTML = 'Recompute!'
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
  readConstraints(playerNames);
  renderResults()
}

function onForbiddenPairsChanged() {
  forbiddenPairs = readGroupConstraintFromControl(controls.forbiddenPairs, playerNames)
}

function onDiscouragedGroupsChanged() {
  discouragedGroups = readGroupConstraintFromControl(controls.discouragedGroups, playerNames)
}

function showHelp() {
  resultsDiv.style.opacity = "0.4"
  showHelpLink.style.display = "none"
  hideHelpLink.style.display = "inline"
  for (const div of helpDivs) {
    div.style.display = 'block'
  }
}

function hideHelp() {
  resultsDiv.style.opacity = "1"
  showHelpLink.style.display = "inline"
  hideHelpLink.style.display = "none"
  for (const div of helpDivs) {
    div.style.display = 'none'
  }
}

// This function reads the forbidden groups and discouraged groups
// from the DOM and writes the global state variables accordingly,
// using playerIndices instead of names.
function readConstraints(playerNames) {
  forbiddenPairs = readGroupConstraintFromControl(controls.forbiddenPairs, playerNames)
  discouragedGroups = readGroupConstraintFromControl(controls.discouragedGroups, playerNames)
}

/**
 * Given a textarea containing multiple comma-separated lists of player names,
 * where the lists are separated by newlines, returns a set of sets of player
 * ids suitable for passing as a contstraint to the solver.
 * Names not found in the provided playerNames list are ignored.
 * @param {HTMLTextAreaElement} control
 * @param {Array<string>} playerNames 
 * @returns {Immutable.Set<Immutable.Set<number>>}
 */
function readGroupConstraintFromControl(control, playerNames) {
  return control.value
    .split('\n')
    .map(playerNameList =>
      playerNameList
        .split(',')
        .map(name => name.trim()))
    // Drop lines that aren't groups
    .filter(group => group.length >= 2)
    // Convert player names to indices
    .reduce((memo, group) => {
      let groupSet = Immutable.Set()
      for (const playerName of group) {
        for (const index of indicesOf(playerName, playerNames)) {
          groupSet = groupSet.add(index)
        }
      }
      // Ignore single-member groups, since they don't make useful constraints.
      return groupSet.size >= 2 ? memo.add(groupSet) : memo;
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

function playerName(i) {
  return playerNames[i] ? playerNames[i] : `Player ${i+1}`
}

function downloadCsv() {
  // Pivot results into a table that's easier to work with
  const roundNames = lastResults.rounds.map((_, i) => `Round ${i + 1}`)
  const playerCount = lastResults.rounds[0].length * lastResults.rounds[0][0].length
  
  // Stub out a row for each player
  const players = []
  for (let i = 0; i < playerCount; i++) {
    players.push([playerName(i)])
  }
  
  // Fill in assigned groups
  lastResults.rounds.forEach((round) => {
    round.forEach((group, j) => {
      group.forEach(playerIndex => {
        players[playerIndex].push(`Group ${j + 1}`)
      })
    })
  })
  
  // Build table
  const rows = [
    ['', ...roundNames],
    ...players
  ]
  // For debugging: console.table(rows);
  
  let csvContent = "data:text/csv;charset=utf-8," 
    + rows.map(e => e.join(",")).join("\n");
  
  const encodedUri = encodeURI(csvContent)
  const link = document.createElement("a")
  link.setAttribute("href", encodedUri)
  link.setAttribute("download", "golfer_solution.csv")
  document.body.appendChild(link)
  link.click()
}

function renderResults() {
  resultsDiv.innerHTML = ''
  if (lastResults) {
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
          member.textContent = playerName(personNumber)
          members.appendChild(member)
        })
        groupDiv.appendChild(members)
  
        groups.appendChild(groupDiv)
      })
  
      roundDiv.appendChild(header)
      roundDiv.appendChild(groups)
      resultsDiv.appendChild(roundDiv)
    })
    
    if (lastResults.done) {
      // Summary div - total time and CSV download
      const summaryDiv = document.createElement('div')
      summaryDiv.classList.add('resultsSummary');
      summaryDiv.style.borderTop = 'solid #aaaaaa thin'
      summaryDiv.style.padding = '7px 0'

      const csvButton = document.createElement('button')
      csvButton.type = 'button'
      csvButton.appendChild(document.createTextNode('Download CSV'))
      csvButton.onclick = downloadCsv

      const printButton = document.createElement('button')
      printButton.type = 'button'
      printButton.appendChild(document.createTextNode('Print Results'))
      printButton.onclick = () => window.print()
      
      const elapsedTime = document.createElement('span')
      elapsedTime.style.fontStyle = 'italic'
      elapsedTime.style.fontSize = 'smaller'
      if (startTime) {
        const elapsedSecs = Math.round((Date.now() - startTime) / 100) / 10
        elapsedTime.textContent = `Computed in ${elapsedSecs} seconds.`
      } else {
        elapsedTime.textContent = `Loaded from local storage.`
      }
      
      summaryDiv.appendChild(elapsedTime)
      summaryDiv.appendChild(csvButton)
      summaryDiv.appendChild(printButton)
      resultsDiv.appendChild(summaryDiv)
    } else {
      resultsDiv.appendChild(document.createTextNode('Thinking...'));
    }
  }
}

document.addEventListener('DOMContentLoaded', init)