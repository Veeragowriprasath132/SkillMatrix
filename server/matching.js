// matching.js — scores employees against a list of required skills.
const LEVELS = ["Beginner", "Intermediate", "Advanced", "Expert"];

function levelIndex(level) {
  const i = LEVELS.indexOf(level);
  return i === -1 ? 0 : i;
}

// employeesWithSkills: [{ id, name, ..., skills: [{skill_name, level, years}] }]
// requiredSkills: [{ name, level }]
function scoreEmployees(employeesWithSkills, requiredSkills) {
  if (!requiredSkills || requiredSkills.length === 0) return [];
  return employeesWithSkills
    .map(emp => {
      let matched = 0, levelPoints = 0;
      for (const req of requiredSkills) {
        const s = emp.skills.find(sk => sk.skill_name.toLowerCase() === req.name.toLowerCase());
        if (s && levelIndex(s.level) >= levelIndex(req.level)) {
          matched++;
          levelPoints += levelIndex(s.level) + 1;
        }
      }
      const pct = Math.round((matched / requiredSkills.length) * 100);
      return { employee: emp, matched, required: requiredSkills.length, pct, levelPoints };
    })
    .filter(r => r.matched > 0)
    .sort((a, b) => b.pct - a.pct || b.levelPoints - a.levelPoints);
}

module.exports = { LEVELS, levelIndex, scoreEmployees };
