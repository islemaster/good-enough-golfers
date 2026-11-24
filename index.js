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

// This variable holds the current schedule:
//   rounds      - the planned groups for each round, from the solver
//   roundScores - the solver's conflict scores for those plans
//   done        - whether the solver has finished
//   config      - the settings and name list the plan was made with. Groups
//                 store players by their position in this list, so we keep a
//                 copy; editing the name box later can't relabel the groups.
//   absences    - round index -> players marked absent that round
// What's shown on screen is the plan with attendance applied (see
// applyAttendance in lib/schedule.js).
let lastResults

// Rounds currently in "mark absent" mode
const attendanceRounds = new Set()

// The solver job we're waiting on, if any. Each job gets an id so stale
// messages from an earlier job are ignored.
let currentJob = null
let jobCounter = 0

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

  initDarkMode()

  try {
    loadStateFromLocalStorage()
  } catch (err) {
    console.info('Failed to load previous state');
  }

  playerNames = readPlayerNames()
  readConstraints(playerNames)
  onSliderLabelEdited()
  withGroupLeaders = !!controls.withGroupLeadersBox.checked
  updatePlayerCountIndicator()

  if (lastResults) {
    renderResults()
  } else {
    recomputeResults()
  }
}

function onResults(e) {
  const data = e.data
  if (!currentJob || data.jobId !== currentJob.id) return

  if (currentJob.type === 'recompute') {
    lastResults = {
      rounds: data.rounds,
      roundScores: data.roundScores,
      done: data.done,
      config: currentJob.config,
      absences: {},
    }
  } else if (currentJob.type === 'replan') {
    // Only swap in the new later rounds once they're all ready
    if (!data.done) return
    const keep = currentJob.fromRound + 1
    lastResults.rounds = lastResults.rounds.slice(0, keep).concat(data.rounds.slice(keep))
    lastResults.roundScores = lastResults.roundScores.slice(0, keep).concat(data.roundScores.slice(keep))
  }

  if (data.done) {
    currentJob = null
    saveStateToLocalStorage()
    enableControls()
  }
  renderResults()
}

function recomputeResults() {
  startTime = Date.now();
  lastResults = null;
  attendanceRounds.clear()
  const numPlayers = playerNames.length > 0 ? playerNames.length : groups * ofSize;
  const config = {
    groups, ofSize, forRounds, numPlayers,
    withGroupLeaders: !!withGroupLeaders,
    playerNames: playerNames.slice(),
    forbiddenPairs: forbiddenPairs.toJS(),
    discouragedGroups: discouragedGroups.toJS(),
  }
  currentJob = {id: ++jobCounter, type: 'recompute', config}
  renderResults()
  disableControls()
  myWorker.postMessage({
    jobId: currentJob.id,
    groups, ofSize, forRounds, numPlayers,
    withGroupLeaders: config.withGroupLeaders,
    forbiddenPairs: config.forbiddenPairs,
    discouragedGroups: config.discouragedGroups,
  })
}

// Re-solve every round after `fromRound`, treating rounds up to and including
// it as already happened (with absences applied). Later rounds then account
// for who actually met whom, and skip anyone already marked absent for them.
function replanAfter(fromRound) {
  if (currentJob || !lastResults) return
  const cfg = lastResults.config
  const displayed = getDisplayedRounds()
  startTime = Date.now()
  currentJob = {id: ++jobCounter, type: 'replan', fromRound}
  disableControls()
  renderResults()
  myWorker.postMessage({
    jobId: currentJob.id,
    groups: cfg.groups,
    ofSize: cfg.ofSize,
    forRounds: lastResults.rounds.length,
    numPlayers: cfg.numPlayers,
    withGroupLeaders: cfg.withGroupLeaders,
    forbiddenPairs: cfg.forbiddenPairs,
    discouragedGroups: cfg.discouragedGroups,
    history: displayed.slice(0, fromRound + 1).map(r => r.groups),
    absentByRound: lastResults.absences || {},
  })
}

function toggleAbsent(roundIndex, player) {
  if (currentJob || !lastResults) return
  const absences = lastResults.absences = lastResults.absences || {}
  const list = absences[roundIndex] || []
  absences[roundIndex] = list.includes(player)
    ? list.filter(p => p !== player)
    : list.concat([player])
  if (absences[roundIndex].length === 0) delete absences[roundIndex]
  saveStateToLocalStorage()
  renderResults()
}

// The schedule as it should be shown: the plan with attendance applied.
function getDisplayedRounds() {
  if (!lastResults) return []
  return applyAttendance(lastResults.rounds, lastResults.absences || {}, lastResults.config)
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
  if (lastResults && !lastResults.config) {
    // Saved by an older version: rebuild the settings it was made with.
    let numPlayers = 0
    lastResults.rounds.forEach(round => round.forEach(group => group.forEach(p => {
      numPlayers = Math.max(numPlayers, p + 1)
    })))
    lastResults.config = {
      groups: state.groups,
      ofSize: state.ofSize,
      forRounds: state.forRounds,
      numPlayers,
      withGroupLeaders: !!state.withGroupLeaders,
      playerNames: state.playerNames,
      forbiddenPairs: state.forbiddenPairs,
      discouragedGroups: state.discouragedGroups,
    }
    delete lastResults.weights
  }
  if (lastResults && !lastResults.absences) lastResults.absences = {}
}

function onSliderMoved() {
  groups = parseInt(controls.groupsSlider.value, 10)
  ofSize = parseInt(controls.ofSizeSlider.value, 10)
  forRounds = parseInt(controls.forRoundsSlider.value, 10)

  // Update labels
  controls.groupsBox.value = groups
  controls.ofSizeBox.value = ofSize
  controls.forRoundsBox.value = forRounds
  updatePlayerCountIndicator()
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
  updatePlayerCountIndicator()
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
    .filter(name => name.length > 0)
}

// Groups store players by position in the name list. If the list keeps the
// same length we treat the edit as a rename (e.g. fixing a typo) and update
// the shown names live. If names were added or removed, positions would shift
// and every group would silently show the wrong people, so we keep the old
// names and ask for a Recompute instead.
function syncNamesIntoResults() {
  if (lastResults && lastResults.config &&
      lastResults.config.playerNames.length === playerNames.length) {
    lastResults.config.playerNames = playerNames.slice()
  }
}

function onPlayerNamesKeyUp() {
  playerNames = readPlayerNames()
  syncNamesIntoResults()
  updatePlayerCountIndicator()
  renderResults()
}

function onPlayerNamesChanged() {
  playerNames = readPlayerNames()
  syncNamesIntoResults()
  updatePlayerCountIndicator()
  readConstraints(playerNames);
  renderResults()
  if (lastResults && lastResults.done) saveStateToLocalStorage()
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

// Names come from the list the schedule was made with, not the live text box.
function playerName(i) {
  const names = (lastResults && lastResults.config && lastResults.config.playerNames) || playerNames
  return (names[i] && names[i].trim()) ? names[i] : `#${i + 1}`
}

function csvCell(value) {
  const text = String(value)
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}

function downloadCsv() {
  // Pivot results into a table that's easier to work with:
  // one row per player, one column per round.
  const displayed = getDisplayedRounds()
  const roundNames = displayed.map((_, i) => `Round ${i + 1}`)
  const playerCount = lastResults.config.numPlayers

  const players = []
  for (let i = 0; i < playerCount; i++) {
    players.push([playerName(i)].concat(displayed.map(() => '')))
  }

  displayed.forEach((round, r) => {
    round.groups.forEach((group, j) => {
      group.forEach(p => players[p][r + 1] = `Group ${j + 1}`)
    })
    round.absent.forEach(p => players[p][r + 1] = 'Absent')
    round.sittingOut.forEach(p => players[p][r + 1] = 'Sitting out')
  })

  const rows = [[''].concat(roundNames)].concat(players)
  // The byte-order mark helps Excel read non-English names correctly.
  const csv = '﻿' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}))
  const link = document.createElement('a')
  link.href = url
  link.download = 'groups.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function makeButton(label, onClick, disabled) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.disabled = !!disabled
  button.onclick = onClick
  return button
}

function makeNameLine(label, players, onClick) {
  const line = document.createElement('div')
  line.classList.add('roundNote')
  const strong = document.createElement('strong')
  strong.textContent = label + ' '
  line.appendChild(strong)
  players.forEach(p => {
    const chip = document.createElement(onClick ? 'button' : 'span')
    chip.classList.add('nameChip')
    chip.textContent = playerName(p)
    if (onClick) {
      chip.type = 'button'
      chip.title = 'Mark present'
      chip.onclick = () => onClick(p)
    }
    line.appendChild(chip)
  })
  return line
}

function renderResults() {
  resultsDiv.innerHTML = ''
  document.body.style.overflow = ''
  if (!lastResults) {
    // Show skeleton loading placeholders
    renderSkeleton()
    return
  }

  const busy = !!currentJob
  const cfg = lastResults.config
  const displayed = getDisplayedRounds()
  const lastRound = lastResults.rounds.length - 1

  if (cfg.playerNames.length !== playerNames.length && playerNames.length > 0) {
    const notice = document.createElement('div')
    notice.classList.add('resultsNotice')
    notice.textContent = 'You added or removed names since these groups were made, so they still show the old list. ' +
      'Click Recompute to make groups for the new list. To handle someone missing class, ' +
      'leave their name in and use "Mark absent" on that round instead.'
    resultsDiv.appendChild(notice)
  }

  displayed.forEach((round, roundIndex) => {
    const inAttendance = attendanceRounds.has(roundIndex)
    const moved = new Set(round.moved)

    const roundDiv = document.createElement('div')
    roundDiv.classList.add('round')
    if (inAttendance) roundDiv.classList.add('attendance-mode')

    const header = document.createElement('h1')
    header.textContent = `Round ${roundIndex+1}`
    const conflictScore = document.createElement('div')
    conflictScore.classList.add('conflictScore')
    conflictScore.textContent = `Conflict score: ${round.score}`
    header.appendChild(conflictScore)

    const actions = document.createElement('div')
    actions.classList.add('roundActions')
    if (lastResults.done || busy) {
      actions.appendChild(makeButton(inAttendance ? 'Done' : 'Mark absent', () => {
        if (inAttendance) attendanceRounds.delete(roundIndex)
        else attendanceRounds.add(roundIndex)
        renderResults()
      }, busy))
      if (round.absent.length > 0 && roundIndex < lastRound) {
        const replanning = busy && currentJob.type === 'replan' && currentJob.fromRound === roundIndex
        const replan = makeButton(replanning ? 'Replanning…' : 'Replan later rounds', () => replanAfter(roundIndex), busy)
        replan.title = 'Re-make the rounds after this one, based on who actually met whom'
        actions.appendChild(replan)
      }
    }

    const groupsDiv = document.createElement('div')
    groupsDiv.classList.add('groups')

    round.groups.forEach((group, groupIndex) => {
      const groupDiv = document.createElement('div')
      groupDiv.classList.add('group')

      const groupName = document.createElement('h2')
      groupName.textContent = `Group ${groupIndex + 1}`
      groupDiv.appendChild(groupName)

      const members = document.createElement('ul')
      group.slice().sort((a, b) => a - b).forEach(personNumber => {
        const member = document.createElement('li')
        member.textContent = playerName(personNumber)
        member.setAttribute('data-player', personNumber)
        if (moved.has(personNumber)) {
          member.classList.add('moved')
          member.title = 'Moved to this group because of absences'
        }
        if (inAttendance) {
          member.title = 'Mark absent'
          member.addEventListener('click', e => {
            e.stopPropagation()
            toggleAbsent(roundIndex, personNumber)
          })
        }
        // Hover-to-highlight across all rounds
        member.addEventListener('mouseenter', function() {
          document.querySelectorAll('[data-player="' + personNumber + '"]').forEach(function(el) {
            el.classList.add('player-highlight')
          })
        })
        member.addEventListener('mouseleave', function() {
          document.querySelectorAll('.player-highlight').forEach(function(el) {
            el.classList.remove('player-highlight')
          })
        })
        members.appendChild(member)
      })
      groupDiv.appendChild(members)

      groupsDiv.appendChild(groupDiv)
    })

    roundDiv.appendChild(header)
    if (actions.childNodes.length) roundDiv.appendChild(actions)
    if (inAttendance) {
      const hint = document.createElement('div')
      hint.classList.add('roundNote')
      hint.textContent = 'Click a name to mark them absent. Groups rebalance automatically, moving as few people as possible.'
      roundDiv.appendChild(hint)
    }
    roundDiv.appendChild(groupsDiv)
    if (round.absent.length > 0) {
      roundDiv.appendChild(makeNameLine('Absent:', round.absent,
        inAttendance ? p => toggleAbsent(roundIndex, p) : null))
    }
    if (round.sittingOut.length > 0) {
      roundDiv.appendChild(makeNameLine('Sitting out:', round.sittingOut, null))
    }

    // Click toggles fullscreen, except while marking absences
    roundDiv.addEventListener('click', function(e) {
      if (e.target.closest('button') || this.classList.contains('attendance-mode')) return;

      this.classList.toggle('fullscreen');

      // Prevent body scroll when fullscreen is active
      if (this.classList.contains('fullscreen')) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    });

    resultsDiv.appendChild(roundDiv)
  })

  if (lastResults.done) {
    // Summary div - total time and CSV download
    const summaryDiv = document.createElement('div')
    summaryDiv.classList.add('resultsSummary');

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
    summaryDiv.appendChild(makeButton('Download CSV', downloadCsv, busy))
    summaryDiv.appendChild(makeButton('Print Results', () => window.print(), busy))
    resultsDiv.appendChild(summaryDiv)
  } else {
    resultsDiv.appendChild(document.createTextNode('Thinking...'));
  }

  // Set up scroll-driven entrance for rounds
  setupScrollObserver()
}

// Dark mode toggle
function initDarkMode() {
  const toggle = document.getElementById('darkModeToggle')
  if (!toggle) return

  const saved = localStorage.getItem('darkMode')
  if (saved === 'true' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.body.classList.add('dark-mode')
    toggle.textContent = '\u2600' // sun
  } else {
    toggle.textContent = '\u263E' // moon
  }

  toggle.addEventListener('click', function(e) {
    e.stopPropagation()
    document.body.classList.toggle('dark-mode')
    const isDark = document.body.classList.contains('dark-mode')
    toggle.textContent = isDark ? '\u2600' : '\u263E'
    localStorage.setItem('darkMode', isDark)
  })
}

// Live player count indicator
function updatePlayerCountIndicator() {
  const indicator = document.getElementById('playerCountIndicator')
  if (!indicator) return

  const numPlayers = playerNames.length
  if (numPlayers === 0 || !groups || !ofSize) {
    indicator.textContent = ''
    return
  }

  const totalSlots = groups * ofSize
  const actualPlayers = Math.min(numPlayers, totalSlots)
  const baseSize = Math.floor(actualPlayers / groups)
  const remainder = actualPlayers % groups

  let breakdown
  if (groups === 1) {
    breakdown = '1 group of ' + actualPlayers
  } else if (remainder === 0) {
    breakdown = groups + ' groups of ' + baseSize
  } else {
    breakdown = remainder + '\u00D7' + (baseSize + 1) + ', ' + (groups - remainder) + '\u00D7' + baseSize
  }

  let text = actualPlayers + ' players \u2192 ' + breakdown
  if (numPlayers > totalSlots) {
    text += ' (' + (numPlayers - totalSlots) + ' sit out each round, taking turns)'
  }
  indicator.textContent = text
}

// Scroll-driven entrance animation via IntersectionObserver
function setupScrollObserver() {
  const observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible')
        observer.unobserve(entry.target)
      }
    })
  }, { threshold: 0.08 })

  document.querySelectorAll('#results .round, #results .resultsSummary').forEach(function(el) {
    observer.observe(el)
  })
}

// Skeleton loading placeholders
function renderSkeleton() {
  var numSkeletonRounds = Math.min(forRounds || 3, 3)
  var numSkeletonGroups = groups || 5
  var numSkeletonPlayers = ofSize || 4

  for (var r = 0; r < numSkeletonRounds; r++) {
    var roundDiv = document.createElement('div')
    roundDiv.classList.add('round', 'skeleton')

    var header = document.createElement('div')
    header.classList.add('skeleton-header')
    roundDiv.appendChild(header)

    var groupsDiv = document.createElement('div')
    groupsDiv.classList.add('groups')

    for (var g = 0; g < numSkeletonGroups; g++) {
      var groupDiv = document.createElement('div')
      groupDiv.classList.add('group', 'skeleton-group')

      var title = document.createElement('div')
      title.classList.add('skeleton-line', 'skeleton-title')
      groupDiv.appendChild(title)

      for (var p = 0; p < numSkeletonPlayers; p++) {
        var line = document.createElement('div')
        line.classList.add('skeleton-line')
        line.style.width = (50 + Math.random() * 40) + '%'
        line.style.animationDelay = (p * 0.1) + 's'
        groupDiv.appendChild(line)
      }

      groupsDiv.appendChild(groupDiv)
    }

    roundDiv.appendChild(groupsDiv)
    resultsDiv.appendChild(roundDiv)
  }
}

document.addEventListener('DOMContentLoaded', init)