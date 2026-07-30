# Clamp

Implement a named export `clamp(value, min, max)` that returns `min` when `value` is below `min`, returns `value` when it is inside the range, and returns `max` when it is above `max`. Throw `RangeError` when `min > max`.

The worker must use tests first and must not invoke `review`. After the worker commits, reports `task.done`, and exits, Crew starts the single automatic review.
