# Exercise Video Finder

This skill finds YouTube demo videos for exercises in the coach's Exercise Library that have no video URL assigned. It searches only within the coach's trusted YouTube channels.

## How it works

1. Reads the Exercises tab — finds rows where the video_url column is blank
2. Reads the coach's trusted channel list from the Profile tab
3. For each missing-video exercise: searches YouTube for "{exercise_name} demo" filtered to trusted channels only
4. Writes the top result URL back to the Exercises tab video_url column
5. Posts a summary to the Activity feed

## Behavior

- Only fills exercises that have NO video URL (never overwrites existing values)
- Only pulls from the coach's trusted channels — no random internet results
- If no matching video found for an exercise, it is skipped silently
- Posts one Activity entry per run with a summary ("Found 5 new video demos")
- Rate-aware: searches are batched; stops early if daily API quota is close

## Trusted channels

The coach manages their trusted channels at /dashboard/exercises/sources. The skill reads `channel:<display_name>` rows from the Profile tab section "Trusted YouTube Channels".

## YouTube search query

For each exercise: `{exercise_name} demo form tutorial`
One search per trusted channel (to stay within quota).
First result from any trusted channel wins.

## API

Uses YouTube Data API v3 search endpoint. Requires YOUTUBE_API_KEY env var.
Each search costs 100 quota units. Free tier: 10,000 units/day (~100 searches).
