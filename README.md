# Good-Enough Golfers

_Good-Enough Golfers_ is a near-solver for a class of scheduling problems including the
[Social Golfer Problem](http://mathworld.wolfram.com/SocialGolferProblem.html) and
[Kirkman's Schoolgirl Problem](http://mathworld.wolfram.com/KirkmansSchoolgirlProblem.html).
The goal is to schedule `g x p` players into `g` groups of size `p` for `w` weeks such that no two players meet more
than once.

Real solutions to these problems can be extremely slow, but approximations are fast and often good enough for real-world purposes.

## History

I originally threw this together over a Thanksgiving weekend because my Dad (a professor) posed the following problem:

> I have 28 students that I want to organize into discussion groups of 4.  I want them to rotate into new groups
> every 15 minutes, but never be in a group with the same person twice.   Also, I've got several students that all
> brought the same article to class - they shouldn't be grouped together, if possible.

I pointed out that this sounded like a [combinatorics](https://en.wikipedia.org/wiki/Combinatorics) problem, and while
we quickly found matching problems online there weren't very many tools for solving them, much less with the additional
constraints we needed.

## FAQ

**What does the conflict score indicate?**

The conflict score is a made-up internal score used to compare candidate solutions while running the genetic algorithm.  I've been meaning to replace it with a human-friendly "conflict count" in the UI.  Here's how the score is currently calculated:

For every possible pairing of people in the group, the algorithm tracks the total number of times they've been placed in a group together. (This typically starts at zero for every pair.)  After each round is locked it [updates these counts](https://github.com/islemaster/good-enough-golfers/blob/bc9204267a9ed6b1ac96cbcfc0759d20f952cd64/lib/geneticSolver.js#L63-L69). Then, while evaluating possible solutions for the next round, the "cost" of each pair is the [square of the number of times they've been in a group together before](https://github.com/islemaster/good-enough-golfers/blob/bc9204267a9ed6b1ac96cbcfc0759d20f952cd64/lib/geneticSolver.js#L11). In other words, the cost of a pair that's golfed together once is 1, but if they've golfed together twice the cost of putting them together again jumps to 4, subsequently 9, and so on. The conflict score for a round is the [sum of the cost of every pairwise relationship in every group for that round](https://github.com/islemaster/good-enough-golfers/blob/bc9204267a9ed6b1ac96cbcfc0759d20f952cd64/lib/geneticSolver.js#L8-L19).

So, for low values, it represents the number of pairs that have been grouped together before.  At higher values it's hard to give a useful unit of measurement.

The key advantage of the exponential behavior is that makes an even distribution of conflicts among players more favorable than putting one pair together over many rounds, which is especially useful in unsolvable situations.  You can check this on a small scale with two groups of three players over four rounds - this heuristic nearly guarantees that no pair golfs together more than twice, even though conflicts are inevitable.

Pairs entered in the "Never allow these pairs" box begin with a cost of Infinity, outweighing any cost computed by the algorithm.
