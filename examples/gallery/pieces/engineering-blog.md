# How We Cut Our CI Time From 40 Minutes to 6

*Fernway Engineering · Priya Raman, Staff Engineer*

In today's fast-paced software landscape, every minute matters. At Fernway, we pride ourselves on shipping quickly, but last spring our continuous integration pipeline had quietly become our biggest bottleneck. A full run on the main repository took forty minutes. On a busy afternoon, with the queue backed up, it could take over an hour before an engineer learned whether their change was safe to merge.

This is the story of how we got it down to six minutes, and what we learned along the way. Let's dive in.

## The Problem Wasn't the Tests

When we first started looking at the problem, everyone assumed the test suite was the culprit. It wasn't just the tests, it was everything around them. When we instrumented a typical run, the actual tests accounted for about eleven minutes. The rest was setup: cloning, installing dependencies, building Docker images, warming caches that were never warm, and waiting for runners.

It's worth noting that this is a common pattern. Experts agree that most CI time is spent outside the tests themselves. Our numbers simply confirmed what the industry already knows.

## Step One: Measure Everything

Before changing anything, we added timing to every step and exported it to our metrics dashboard. This gave us a clear, comprehensive, and actionable picture of where time was going. Three things stood out:

- **Dependency installation** took nine minutes, because every job started from a clean environment.
- **Docker builds** took eight minutes, rebuilding layers that hadn't changed in weeks.
- **Queue time** averaged seven minutes during working hours, because we had too few runners and they were all the same size.

## Step Two: Caching That Actually Works

We had caching enabled already. It just wasn't working. Our cache keys included the commit hash, which meant every commit got a fresh, empty cache. Once we keyed the dependency cache on the lockfile instead, installation dropped from nine minutes to under one.

The Docker fix was similar. We restructured our Dockerfiles so the layers that change rarely, like system packages and language runtimes, come first, and the application code comes last. We also started pushing intermediate layers to our registry so other runners could pull them. Builds went from eight minutes to about ninety seconds.

## Step Three: Split the Suite

With setup under control, the tests themselves were the next target. We split the suite into shards based on historical timing data, so each shard takes roughly the same amount of time. Twelve shards running in parallel turned eleven minutes of tests into about two.

This required some cleanup. A handful of tests depended on running in a particular order, which we had never noticed because they had always run in that order. Finding and fixing them took a week, and it was genuinely unpleasant, but the suite is better for it.

## Step Four: Right-Size the Runners

Finally, we stopped treating every job the same. Linting doesn't need a sixteen-core machine. Integration tests do. We created three runner sizes and assigned each job to the smallest one that could handle it, which freed up capacity and brought queue time down to under a minute.

## The Results

Today, a typical run on main takes six minutes from push to green check. More importantly, engineers have stopped batching changes to avoid the wait. Pull requests are smaller, reviews are faster, and fewer bugs make it to production. It's a powerful reminder that developer experience isn't a luxury, it's a fundamental driver of quality, velocity, and team morale.

## What We'd Tell Other Teams

If your CI is slow, start by measuring. You will almost certainly find that the slow part is not where you think it is. Fix your cache keys. Order your Docker layers. Shard by timing, not by file count. And don't be afraid to spend money on the right runners, because engineer time is far more expensive than compute.

At the end of the day, fast CI is about more than speed. It's about creating an environment where engineers can do their best work, iterate with confidence, and focus on what truly matters: building great products for our customers.

*We're hiring. If this kind of work excites you, check out our careers page.*
