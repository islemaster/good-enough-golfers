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