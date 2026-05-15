// lib/demo-history.js
// Owns: deterministic 90-day demo data (squat, bodyweight, wellness)
// Does NOT own: real Sheet data integration (Phase 5), auth

// Seeded PRNG so charts look identical on every request (demo reproducibility)
function seededRng(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function generateDemoHistory() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build array of last 90 ISO date strings, oldest first
  const days = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  // ── SQUAT TOP SETS ────────────────────────────────────────────
  // Train Mon / Wed / Fri; progressive overload ~2.5 kg every 2 weeks
  const sqRng = seededRng(42);
  const squatSets = [];
  days.forEach((date, idx) => {
    const dow = new Date(date).getDay(); // 0=Sun
    if (![1, 3, 5].includes(dow)) return;
    const weekNum = Math.floor(idx / 7);
    const base = 80 + Math.floor(weekNum / 2) * 2.5;
    const jitter = (sqRng() - 0.5) * 3;
    squatSets.push({ date, weight: Math.round((base + jitter) * 2) / 2 });
  });

  // ── BODYWEIGHT ────────────────────────────────────────────────
  // Slow downward recomp: 74 kg → ~71.5 kg over 90 days with weekly oscillation
  const bwRng = seededRng(77);
  const bodyweight = days.map((date, idx) => {
    const trend = idx * (2.5 / 90); // loses 2.5 kg across the block
    const weekly = Math.sin((idx / 7) * Math.PI * 2) * 0.5; // water weight cycle
    const noise = (bwRng() - 0.5) * 0.8;
    const w = Math.round((74 - trend + weekly + noise) * 10) / 10;
    return { date, weight: w };
  });

  // ── WELLNESS (last 30 days only, reduces payload) ─────────────
  const wRng = seededRng(13);
  const wellnessDays = days.slice(-30);
  const wellness = wellnessDays.map((date, idx) => {
    const dow = new Date(date).getDay();
    const isTraining = [1, 3, 5].includes(dow);
    const prevDow = new Date(date);
    prevDow.setDate(prevDow.getDate() - 1);
    const dayAfterTraining = [1, 3, 5].includes(prevDow.getDay());

    // Sleep: 7–8.5 base, drops slightly on training days
    const sleep = clamp(round1((7.8 - (isTraining ? 0.5 : 0)) + (wRng() - 0.5) * 2.5), 4, 10);
    // Energy: follows sleep with lag
    const energy = clamp(round1((7.2 - (isTraining ? 0.6 : 0)) + (wRng() - 0.5) * 2.2), 3, 10);
    // Soreness: spikes day after training
    const soreness = clamp(round1((dayAfterTraining ? 6.8 : 2.8) + (wRng() - 0.5) * 2), 1, 10);
    // Stress: slight build through training weeks, eases on rest days
    const stressBase = 4.5 + (idx > 20 ? 1 : 0) - (dow === 0 || dow === 6 ? 1 : 0);
    const stress = clamp(round1(stressBase + (wRng() - 0.5) * 2.8), 1, 10);

    return { date, sleep, energy, soreness, stress };
  });

  // ── MEASUREMENTS (weekly check-ins, last 12 weeks) ─────────────
  // Realistic slow recomp: waist shrinks, arms grow slightly
  const mRng = seededRng(99);
  const checkInDays = days.filter((_, idx) => idx % 7 === 6); // every Sunday
  const measurements = checkInDays.map((date, idx) => {
    // Slow downward trend on waist/hip/thighs, slight growth on arms
    const progress = idx / Math.max(checkInDays.length - 1, 1);
    return {
      date,
      waist:  round1(86 - progress * 4  + (mRng() - 0.5) * 1.2),
      hip:    round1(97 - progress * 2.5 + (mRng() - 0.5) * 1.0),
      chest:  round1(94 - progress * 1   + (mRng() - 0.5) * 1.0),
      larm:   round1(32 + progress * 0.8 + (mRng() - 0.5) * 0.6),
      rarm:   round1(32.5 + progress * 0.8 + (mRng() - 0.5) * 0.6),
      lthigh: round1(55 - progress * 1.5 + (mRng() - 0.5) * 0.8),
      rthigh: round1(55 - progress * 1.5 + (mRng() - 0.5) * 0.8),
    };
  });

  // Seed two fake photo check-ins for the comparison demo
  const photoCheckins = [
    {
      date: days[0],      // oldest
      photoUrl: null,     // real app: Drive webViewLink
      bodyweight: bodyweight[0].weight,
      measurements: measurements[0] || null,
    },
    {
      date: days[days.length - 1], // most recent
      photoUrl: null,
      bodyweight: bodyweight[bodyweight.length - 1].weight,
      measurements: measurements[measurements.length - 1] || null,
    },
  ];

  return { squatSets, bodyweight, wellness, measurements, photoCheckins };
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function round1(v) { return Math.round(v * 10) / 10; }

module.exports = { generateDemoHistory };
