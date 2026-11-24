# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Good-Enough Golfers is a near-solver for the Social Golfer Problem and Kirkman's Schoolgirl Problem. It schedules `g × p` players into `g` groups of size `p` for `w` weeks such that no two players meet more than once. The application uses a genetic algorithm to generate approximate solutions that are fast and often good enough for real-world purposes like organizing students into discussion groups.

## Development Commands

Start the local development server:
```sh
npm install
npm start
```

Then open `http://127.0.0.1:8080/` in your browser.

## Architecture

### Core Algorithm (lib/geneticSolver.js)

The genetic algorithm is the heart of the application:

- **Scoring System**: Evaluates candidate groupings by calculating a conflict score. For each pair of players, the cost is the square of the number of times they've been grouped together before (0→0, 1→1, 2→4, 3→9, etc.). This exponential growth ensures even distribution of conflicts rather than repeatedly grouping the same pairs.

- **Mutation Strategy**: Each generation explores mutations by:
  1. Swapping players out of the most expensive (highest conflict) group
  2. Adding random permutations to escape local optimization peaks
  3. Running for 30 generations or until a zero-conflict solution is found

- **Constraints Handling**:
  - `forbiddenPairs`: Pairs seeded with `FORBIDDEN_WEIGHT` (10000, finite so two violations score worse than one)
  - `discouragedGroups`: Pairs seeded with weight 1 (grouped together less preferentially)
  - `withGroupLeaders`: First N players deterministically assigned to their respective groups

- **History and attendance** (`options.history`, `options.absentByRound`): rounds that already happened are kept as-is and only seed the weights; absent players are left out of a round. If there are more players than places, players take turns sitting out (whoever has sat out most plays first).

### Attendance (lib/schedule.js)

Shared, dependency-free helpers loaded by both the page and the worker: weight setup, scoring, and `repairRound` / `applyAttendance`. `lastResults.rounds` is the solver's plan; what's displayed is the plan with `lastResults.absences` applied by `applyAttendance`, which removes absent players and rebalances with the fewest moves. "Replan later rounds" re-runs the solver with the displayed rounds so far as history. Results store a `config` snapshot (including `playerNames`) because groups reference players by list position.

### Application Flow

1. **index.js**: Main entry point and UI controller
   - Manages DOM controls and state
   - Persists solutions to localStorage for teacher convenience
   - Spawns Web Worker for background computation

2. **lib/worker.js**: Web Worker that runs the solver
   - Keeps UI responsive during computation
   - Imports lodash and geneticSolver.js
   - Sends progressive results back to main thread

3. **lib/seatingChart.js**: Alternative solver (appears unused in production)
   - Uses exhaustive search approach with Immutable.js
   - Explores state tree with cost-based prioritization
   - More accurate but significantly slower than genetic approach

### Data Flow

- User adjusts parameters (groups, size, rounds) → Main thread
- Click "Recompute" → Worker receives parameters
- Worker runs genetic algorithm → Progressive results sent to main thread
- Main thread renders results → Updates DOM
- Solution saved to localStorage for next visit

### Key Implementation Details

- Player names are converted to indices internally for algorithm efficiency
- Duplicate player names apply constraints to all matching indices
- Results can be exported to CSV in a pivoted format (players × rounds)
- Privacy: All computation happens client-side; no data sent to servers

## External Dependencies

- **Immutable.js** (CDN): Used in index.html for constraint management (Set operations)
- **Lodash** (CDN): Used in Web Worker for array utilities (shuffle, sortBy, range)
- **http-server**: Dev dependency for local serving
