const BASE_MIDI = 48;
const SPAN = 36;

export function weeksToNotes(calendar, year, secondsPerYear = 10) {
  let max = 0;
  for (const w of calendar.weeks) {
    if (w.harmonized != null && w.harmonized > max) max = w.harmonized;
  }
  const notes = [];
  for (const w of calendar.weeks) {
    if (w.year !== year) continue;
    const time = ((w.week - 1) * secondsPerYear) / 52;
    const h = w.harmonized;
    if (h == null || h <= 0 || max <= 0) {
      notes.push({ time, midi: BASE_MIDI, velocity: 0 });
      continue;
    }
    const intensity = Math.sqrt(h / max);
    notes.push({
      time,
      midi: BASE_MIDI + Math.round(SPAN * intensity),
      velocity: 0.1 + 0.9 * intensity,
    });
  }
  return notes;
}

let active = null;

export function stop() {
  if (active) active.stop();
}

export async function play(calendar, year, { secondsPerYear = 10, onWeek } = {}) {
  stop();
  const Tone = await import("tone");
  await Tone.start();
  const notes = weeksToNotes(calendar, year, secondsPerYear);
  if (!notes.length) return;

  const reverb = new Tone.Reverb({ decay: 3, wet: 0.35 }).toDestination();
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.02, decay: 0.2, sustain: 0.2, release: 0.6 },
  }).connect(reverb);
  synth.volume.value = -8;

  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel();
  const step = secondsPerYear / 52;
  const weeks = calendar.weeks.filter((w) => w.year === year);

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      transport.stop();
      transport.cancel();
      synth.dispose();
      reverb.dispose();
      active = null;
      resolve();
    };
    active = { stop: finish };
    notes.forEach((note, i) => {
      transport.schedule((t) => {
        if (note.velocity > 0) {
          synth.triggerAttackRelease(
            Tone.Frequency(note.midi, "midi").toFrequency(),
            step * 1.4,
            t,
            note.velocity,
          );
        }
        Tone.getDraw().schedule(() => {
          if (!done && onWeek) onWeek(weeks[i].week);
        }, t);
      }, note.time);
    });
    transport.schedule(finish, secondsPerYear + 0.8);
    transport.start();
  });
}
