const CATEGORY_WEIGHTS = {
  governance: 10,
  operations: 10,
  technology: 10,
  marketing: 10,
  sales: 10,
  customer_experience: 10,
  finance: 10,
  security: 10,
  resilience: 10,
  knowledge: 5,
  learning: 5,
};

export function scoreEntity(signals) {
  const categories = {
    governance: signals.level_2_count > 0 ? 100 : 0,
    operations: signals.level_1_count > 0 ? 100 : 0,
    technology: signals.has_cicd ? 100 : 0,
    marketing: 0,
    sales: 0,
    customer_experience: 0,
    finance: 0,
    security: signals.has_security_ci_check ? 100 : 0,
    resilience: signals.has_cushion_dimension ? 100 : 0,
    knowledge: signals.verified_infrastructure_pass ? 100 : 0,
    learning: 0,
  };

  let total = 0;
  for (const [category, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    total += (categories[category] / 100) * weight;
  }

  return { categories, total: Math.round(total * 10) / 10 };
}

export function averageScore(totals) {
  if (totals.length === 0) return 0;
  const sum = totals.reduce((acc, n) => acc + n, 0);
  return Math.round((sum / totals.length) * 10) / 10;
}

export { CATEGORY_WEIGHTS };
