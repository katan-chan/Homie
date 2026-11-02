// Location tests read a Vietnam day and send points up to 90 minutes old; run just after midnight, those points would
// fall on two days. This stops the clock (Date only, timers still run) at now, or at 23:00 the day before when now is
// within two hours of Vietnam midnight. Measure durations with performance.now() while it is on.
import { mock } from 'node:test';

const HOUR = 3600000;

export function steadyClock() {
  const real = Date.now();
  const sinceMidnight = (real + 7 * HOUR) % (24 * HOUR);
  const now = sinceMidnight < 2 * HOUR ? real - sinceMidnight - HOUR : real;
  mock.timers.enable({ apis: ['Date'], now });
  return now;
}
